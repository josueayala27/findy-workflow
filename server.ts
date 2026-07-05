import { Hono } from "hono";
import { ApifyError, runApifyScraper } from "./src/apify";
import {
  getPlaceNames,
  getPlaceWithMentions,
  getSqlClient,
  listPlacesWithScores,
  upsertPlaceMentions,
  type ResolvedPlaceMention,
} from "./src/db";
import { analyzeVideo } from "./src/gemini";
import { geocodeLocation } from "./src/geocode";
import { resolveLocations } from "./src/location";
import { canonicalizePlaces, computeScores } from "./src/places";
import { upsertSearchDoc } from "./src/search";
import type { LocationMention, ScrapeInput, VideoAnalysis } from "./src/types";
import { serve, type WorkflowBindings } from "@upstash/workflow/hono";

interface Bindings extends WorkflowBindings {
  APIFY_TOKEN: string;
  GEMINI_API_KEY: string;
  DATABASE_URL: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post(
  "/workflow",
  serve<Partial<ScrapeInput>, Bindings>(async (context) => {
    const body = context.requestPayload;
    if (!body?.query || !body?.category) {
      throw new Error("query and category are required");
    }

    const input: ScrapeInput = {
      query: body.query,
      category: body.category,
      location: body.location,
      resultsLimit: body.resultsLimit,
    };

    const result = await context.run("scrape-tiktok", async () => {
      const token = context.env.APIFY_TOKEN;
      if (!token) {
        throw new Error("APIFY_TOKEN is not configured");
      }

      try {
        const items = await runApifyScraper(input, { token });
        return { count: items.length, items };
      } catch (error) {
        if (error instanceof ApifyError) {
          throw new Error(error.message);
        }
        throw new Error("Unexpected error running Apify scraper");
      }
    });

    const analyses: VideoAnalysis[] = [];
    for (const item of result.items) {
      if (!item.id || !item.video?.url) {
        continue;
      }

      const analysis = await context.run(`process-video-${item.id}`, async () => {
        const apiKey = context.env.GEMINI_API_KEY;
        const databaseUrl = context.env.DATABASE_URL;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY is not configured");
        }
        if (!databaseUrl) {
          throw new Error("DATABASE_URL is not configured");
        }

        const videoAnalysis = await analyzeVideo(item, { apiKey });

        if (videoAnalysis.locations.length === 0) {
          return videoAnalysis;
        }

        const resolvedNames = await resolveLocations(
          videoAnalysis.locations.map((location) => location.name),
          { apiKey },
        );

        const resolved = videoAnalysis.locations
          .map((location, index) => ({ name: resolvedNames[index], coordinates: location.coordinates }))
          .filter((location): location is LocationMention => location.name !== null);

        if (resolved.length === 0) {
          videoAnalysis.locations = [];
          return videoAnalysis;
        }

        const geocoded: LocationMention[] = [];
        for (const location of resolved) {
          const coordinates = await geocodeLocation(location.name);
          geocoded.push({ name: location.name, coordinates });
        }
        videoAnalysis.locations = geocoded;

        const sql = getSqlClient(databaseUrl);
        const existingPlaces = await getPlaceNames(sql);
        const canonicalNames = await canonicalizePlaces(geocoded, videoAnalysis.summary, existingPlaces, {
          apiKey,
        });

        const deduped = new Map<string, ResolvedPlaceMention>();
        geocoded.forEach((location, index) => {
          const canonicalName = canonicalNames[index];
          if (!deduped.has(canonicalName)) {
            deduped.set(canonicalName, {
              canonicalName,
              locationText: location.name,
              coordinates: location.coordinates,
            });
          }
        });

        const touchedPlaceIds = await upsertPlaceMentions(sql, {
          category: input.category,
          item,
          analysis: videoAnalysis,
          places: Array.from(deduped.values()),
        });

        for (const placeId of touchedPlaceIds) {
          const place = await getPlaceWithMentions(sql, placeId);
          if (!place) {
            continue;
          }

          await upsertSearchDoc({
            id: place.id,
            content: {
              name: place.canonicalName,
              locationText: place.locationText,
              category: place.category,
              summaries: place.summaries,
            },
            metadata: {
              coordinates: place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null,
              mentionCount: place.mentionCount,
              engagement: {
                likes: place.totalLikes,
                comments: place.totalComments,
                shares: place.totalShares,
                bookmarks: place.totalBookmarks,
              },
              sentiments: place.sentiments,
              videoIds: place.sentiments.map((sentiment) => sentiment.videoId),
              suspicious: place.suspicious,
            },
          });
        }

        return videoAnalysis;
      });

      analyses.push(analysis);
    }

    return { count: result.count, analyses };
  }),
);

app.get("/places", async (c) => {
  const databaseUrl = c.env.DATABASE_URL;
  if (!databaseUrl) {
    return c.json({ error: "DATABASE_URL is not configured" }, 500);
  }

  const sql = getSqlClient(databaseUrl);
  const rows = await listPlacesWithScores(sql);
  return c.json(computeScores(rows));
});

export default app;
