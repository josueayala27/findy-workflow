import { Hono } from "hono";
import { ApifyError, runApifyScraper } from "./src/apify";
import type { ScrapeInput } from "./src/types";

interface Env {
  APIFY_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.text("Hello, Hono with Nitro!");
});

app.post("/scrape/apify", async (c) => {
  const token = c.env?.APIFY_TOKEN ?? process.env.APIFY_TOKEN;
  if (!token) {
    return c.json({ error: "APIFY_TOKEN is not configured" }, 500);
  }

  const body = await c.req.json<Partial<ScrapeInput>>().catch(() => null);
  if (!body?.query || !body?.category) {
    return c.json({ error: "query and category are required" }, 400);
  }

  const input: ScrapeInput = {
    query: body.query,
    category: body.category,
    location: body.location,
    resultsLimit: body.resultsLimit,
  };

  try {
    const items = await runApifyScraper(input, { token });
    return c.json({ count: items.length, items });
  } catch (error) {
    if (error instanceof ApifyError) {
      return c.json({ error: error.message }, 502);
    }
    return c.json({ error: "Unexpected error running Apify scraper" }, 500);
  }
});

export default app;
