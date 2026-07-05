import { Hono } from "hono";
import { ApifyError, runApifyScraper } from "./src/apify";
<<<<<<< HEAD
import { getSqlClient, listPlacesWithScores } from "./src/db";
import { processApifyItem } from "./src/ingest";
import { computeScores } from "./src/places";
import type { ScrapeInput, VideoAnalysis } from "./src/types";
=======
import {
  countDistinctSources,
  findPlaceByCanonicalName,
  findPlaceByGoogleId,
  getPlaceWithMentions,
  getProcessedWebUrls,
  getPlaceNames,
  getSqlClient,
  listAllPlaceIds,
  listPlacesWithScores,
  markWebSourceStatus,
  registerWebSource,
  type ResolvedPlaceMention,
} from "./src/db";
import { discoverUrls, extractDomain } from "./src/exa";
import { extractPlaces } from "./src/firecrawl";
import { analyzeVideo } from "./src/gemini";
import { resolveCoordinates } from "./src/geocode";
import { findPlaceByText } from "./src/google-places";
import { resolveLocations } from "./src/location";
import { canonicalizePlaces, computeScores } from "./src/places";
import { buildWebMention, persistAndIndexPlace } from "./src/persist";
import { buildSearchDoc, upsertSearchDoc } from "./src/search";
import type { LocationMention, ScrapeInput, VideoAnalysis, WebWorkflowInput } from "./src/types";
import { verifyPlace } from "./src/verify";
>>>>>>> origin/feature/web-reinforcement-verification
import { serve, type WorkflowBindings } from "@upstash/workflow/hono";

interface Bindings extends WorkflowBindings {
  APIFY_TOKEN: string;
  GEMINI_API_KEY: string;
  DATABASE_URL: string;
  GOOGLE_PLACES_API_KEY: string;
  FIRECRAWL_API_KEY: string;
  EXA_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings }>();

function hashKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

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
        const googleApiKey = context.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY is not configured");
        }
        if (!databaseUrl) {
          throw new Error("DATABASE_URL is not configured");
        }

<<<<<<< HEAD
        const sql = getSqlClient(databaseUrl);
        return processApifyItem(sql, item, { category: input.category, apiKey });
      });

      analyses.push(analysis);
    }

    return { count: result.count, analyses };
=======
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
          const geocode = await resolveCoordinates({
            name: location.name,
            googleApiKey,
          });
          geocoded.push({
            name: location.name,
            coordinates: geocode?.coordinates ?? null,
          });
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

        const likes = Math.round((item.likes ?? 0) / deduped.size);
        const comments = Math.round((item.comments ?? 0) / deduped.size);
        const shares = Math.round((item.shares ?? 0) / deduped.size);
        const bookmarks = Math.round((item.bookmarks ?? 0) / deduped.size);

        for (const place of deduped.values()) {
          const geocode = await resolveCoordinates({
            name: place.canonicalName,
            locationText: place.locationText,
            googleApiKey,
          });

          const googlePlace = googleApiKey
            ? await findPlaceByText(place.canonicalName, place.locationText, googleApiKey)
            : null;

          const existingByGoogle = googlePlace
            ? await findPlaceByGoogleId(sql, googlePlace.placeId)
            : null;
          const existingByName = existingByGoogle
            ? null
            : await findPlaceByCanonicalName(sql, place.canonicalName);
          const existingPlaceId = existingByGoogle?.id ?? existingByName?.id;
          const existingSourceCount = existingPlaceId
            ? await countDistinctSources(sql, existingPlaceId)
            : 0;

          const verifyResult = verifyPlace({
            name: place.canonicalName,
            locationText: place.locationText,
            category: input.category,
            coordinates: geocode?.coordinates ?? place.coordinates,
            googlePlace,
            existingSourceCount,
            incomingSource: "tiktok",
          });

          await persistAndIndexPlace(sql, {
            canonicalName: place.canonicalName,
            locationText: place.locationText,
            category: input.category,
            coordinates: geocode?.coordinates ?? place.coordinates,
            geocode,
            googlePlace,
            verifyResult,
            mention: {
              source: "tiktok",
              videoId: videoAnalysis.videoId,
              sourceUrl: item.video?.url ?? item.postPage ?? null,
              sentiment: videoAnalysis.sentiment,
              sentimentScore: videoAnalysis.sentimentScore,
              likes,
              comments,
              shares,
              bookmarks,
              summary: videoAnalysis.summary,
              locationText: place.locationText,
              transcript: videoAnalysis.transcription,
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

app.post(
  "/workflow/web",
  serve<Partial<WebWorkflowInput>, Bindings>(async (context) => {
    const body = context.requestPayload;
    if (!body?.query || !body?.category) {
      throw new Error("query and category are required");
    }

    const input: WebWorkflowInput = {
      query: body.query,
      category: body.category,
      maxUrls: body.maxUrls ?? 10,
    };

    const discovered = await context.run("discover-urls", async () => {
      const exaKey = context.env.EXA_API_KEY;
      const databaseUrl = context.env.DATABASE_URL;
      if (!exaKey) {
        throw new Error("EXA_API_KEY is not configured");
      }
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is not configured");
      }

      const sql = getSqlClient(databaseUrl);
      const excludeUrls = await getProcessedWebUrls(sql);
      const urls = await discoverUrls(
        { query: input.query, category: input.category, maxUrls: input.maxUrls ?? 10 },
        { apiKey: exaKey, excludeUrls },
      );

      for (const result of urls) {
        await registerWebSource(sql, result.url, extractDomain(result.url), input.category);
      }

      return urls;
    });

    let placesProcessed = 0;

    for (const urlResult of discovered) {
      const extracted = await context.run(`extract-${hashKey(urlResult.url)}`, async () => {
        const firecrawlKey = context.env.FIRECRAWL_API_KEY;
        if (!firecrawlKey) {
          throw new Error("FIRECRAWL_API_KEY is not configured");
        }
        return extractPlaces(urlResult.url, { apiKey: firecrawlKey });
      });

      for (const webPlace of extracted) {
        await context.run(`process-web-place-${hashKey(urlResult.url + webPlace.name)}`, async () => {
          const databaseUrl = context.env.DATABASE_URL;
          const googleApiKey = context.env.GOOGLE_PLACES_API_KEY;
          if (!databaseUrl) {
            throw new Error("DATABASE_URL is not configured");
          }

          const sql = getSqlClient(databaseUrl);
          const locationText = webPlace.locationText;
          const geocode = await resolveCoordinates({
            name: webPlace.name,
            locationText,
            googleApiKey,
          });

          const googlePlace = googleApiKey
            ? await findPlaceByText(webPlace.name, locationText, googleApiKey)
            : null;

          const existingByGoogle = googlePlace
            ? await findPlaceByGoogleId(sql, googlePlace.placeId)
            : null;
          const existingByName = existingByGoogle
            ? null
            : await findPlaceByCanonicalName(sql, webPlace.name);
          const existingPlaceId = existingByGoogle?.id ?? existingByName?.id;
          const existingSourceCount = existingPlaceId
            ? await countDistinctSources(sql, existingPlaceId)
            : 0;

          const verifyResult = verifyPlace({
            name: webPlace.name,
            locationText,
            category: webPlace.category || input.category,
            coordinates: geocode?.coordinates ?? null,
            googlePlace,
            existingSourceCount,
            incomingSource: "web",
          });

          await persistAndIndexPlace(sql, {
            canonicalName: webPlace.name,
            locationText,
            category: webPlace.category || input.category,
            coordinates: geocode?.coordinates ?? null,
            geocode: geocode
              ? {
                  ...geocode,
                  department: geocode.department ?? webPlace.department,
                  municipality: geocode.municipality ?? webPlace.municipality,
                }
              : null,
            googlePlace,
            verifyResult,
            mention: buildWebMention(
              urlResult.url,
              webPlace.name,
              webPlace.description,
              locationText,
              webPlace.evidence,
            ),
          });

          placesProcessed += 1;
        });
      }

      await context.run(`mark-processed-${hashKey(urlResult.url)}`, async () => {
        const sql = getSqlClient(context.env.DATABASE_URL);
        await markWebSourceStatus(sql, urlResult.url, "processed");
      });
    }

    return { urlsDiscovered: discovered.length, placesProcessed };
  }),
);

app.post(
  "/workflow/reindex",
  serve<Record<string, never>, Bindings>(async (context) => {
    const reindexed = await context.run("reindex-all", async () => {
      const databaseUrl = context.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is not configured");
      }

      const sql = getSqlClient(databaseUrl);
      const placeIds = await listAllPlaceIds(sql);
      let count = 0;

      for (const placeId of placeIds) {
        const place = await getPlaceWithMentions(sql, placeId);
        if (!place || place.verificationStatus === "rejected") {
          continue;
        }
        await upsertSearchDoc(buildSearchDoc(place));
        count += 1;
      }

      return count;
    });

    return { reindexed };
>>>>>>> origin/feature/web-reinforcement-verification
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
