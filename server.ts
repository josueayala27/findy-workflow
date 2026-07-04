import { Hono } from "hono";
import { ApifyError, runApifyScraper } from "./src/apify";
import { analyzeVideo } from "./src/gemini";
import type { ScrapeInput, VideoAnalysis } from "./src/types";
import { serve, type WorkflowBindings } from "@upstash/workflow/hono";

interface Bindings extends WorkflowBindings {
  APIFY_TOKEN: string;
  GEMINI_API_KEY: string;
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

      analyses.push(analysis);
    }

    return { count: result.count, analyses };
  }),
);

export default app;
