import { Hono } from "hono";
import { ApifyError, runApifyScraper } from "./src/apify";
import { getPlaceNames, getSqlClient, listPlacesWithScores, upsertPlaceMention } from "./src/db";
import { analyzeVideo } from "./src/gemini";
import { geocodeLocation } from "./src/geocode";
import { resolveLocation } from "./src/location";
import { canonicalizePlace, computeScores } from "./src/places";
import type { ScrapeInput, VideoAnalysis } from "./src/types";
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
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY is not configured");
        }
        return analyzeVideo(item, { apiKey });
      });

      if (analysis.location) {
        const resolvedLocation = await context.run(`resolve-location-${item.id}`, () => {
          const apiKey = context.env.GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured");
          }
          return resolveLocation(analysis.location!, { apiKey });
        });

        if (resolvedLocation) {
          analysis.location = resolvedLocation;
          analysis.coordinates = await context.run(`geocode-${item.id}`, () =>
            geocodeLocation(resolvedLocation),
          );

          await context.run(`persist-place-${item.id}`, async () => {
            const databaseUrl = context.env.DATABASE_URL;
            const apiKey = context.env.GEMINI_API_KEY;
            if (!databaseUrl) {
              throw new Error("DATABASE_URL is not configured");
            }
            if (!apiKey) {
              throw new Error("GEMINI_API_KEY is not configured");
            }

            const sql = getSqlClient(databaseUrl);
            const existingPlaces = await getPlaceNames(sql);
            const canonicalName = await canonicalizePlace(analysis, existingPlaces, { apiKey });
            await upsertPlaceMention(sql, { canonicalName, category: input.category, item, analysis });
          });
        } else {
          analysis.location = null;
        }
      }

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
