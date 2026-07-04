# PRD — Scraping & Preprocessing Pipeline (Place Ingestion)

**Project:** El Salvador "best things to do" app (hackathon) **Component:** Data ingestion pipeline — TikTok/IG scraping → place extraction **Status:** Implemented as a working prototype, ready for integration **Owner (this stage):** Saul (scraping config) — handoff target: Josue/Memo (embeddings), Bea (search/UI)

---

## 1. Context

We're building a Yelp-style discovery app for El Salvador, but instead of a Google-Places backbone, the seed data comes from **what's actually going viral on TikTok/Instagram** for a given category (Restaurants, Beach, Tourist spots, Shopping, Nightlife, Active Life). The differentiator vs. Google Maps is surfacing trending places, not "best-rated" places.

This PRD covers **only the ingestion stage**: turning raw scraped videos into a clean, deduplicable list of `Place` objects that the embeddings/search team can consume. It does not cover embedding generation, vector storage, or the frontend.

## 2. Goal

Given a search query like `"mejores playas de El Salvador"` for a category (`Beach`), produce a list of distinct real-world places, each with:

- Name and location
- A short description
- Aggregated trending signal (likes/views)
- A sentiment summary of what commenters are saying
- Source video thumbnails (for use as a place's cover image before falling back to AI generation)

This output is the **input contract** for the next stage (geocoding + embeddings), so its shape matters more than its internals.

## 3. Pipeline (as built)

```
Apify scraping ──► Normalize (local) ──► GPT-mini extraction ──► Parse ──► (image fallback) ──► Persist

```

Implemented as an **Upstash Workflow** (durable, auto-retried, resumable steps). Two framework versions exist:


| File                     | Framework                                     | Includes image-gen fallback? |
| ------------------------ | --------------------------------------------- | ---------------------------- |
| `scrape-places.route.ts` | Next.js (`@upstash/workflow/nextjs`)          | Yes                          |
| `scrape-places.hono.ts`  | Hono, Node runtime (`@upstash/workflow/hono`) | No — scrape + GPT only       |


### Step 1 — Apify scraping

- Calls `POST /v2/acts/{actor}/run-sync-get-dataset-items` (synchronous, **300s hard cap** from Apify's side).
- Actor: placeholder `clockworks~tiktok-scraper` — **needs to be swapped for whatever actor Saul actually configures** for TikTok/IG search-by-category+location.
- Input shape (`searchQueries`, `resultsPerPage`, `shouldDownloadCovers`) is a guess and **must be aligned to the real actor's input schema** before this runs against production data.
- ⚠️ If a category's scrape regularly exceeds 300s, swap in the start-and-poll variant (start run → poll `GET /v2/actor-runs/{runId}` every 15s → fetch `defaultDatasetId` items) instead of the sync endpoint. Code for this swap exists in conversation history with the same author, ask if needed.

### Step 2 — Normalize (local, no external call)

Trims each scraped video down to: `url, caption, likes, views, comments (max 15), coverUrl, author`. Keeps the GPT prompt small and cheap. Runs inside `context.run` so it's cached/replayed, not recomputed on workflow retries.

### Step 3 — GPT-mini extraction ("Extraccion de informacion")

Single call to `gpt-4o-mini` (`response_format: json_object`) that:

- **Clusters** videos referring to the same real place into one record (this is the core value-add — 1000 videos → ~200 places, per the dedup target already agreed for the wider pipeline).
- **Sums** trending signal (likes/views) across a place's videos.
- **Summarizes sentiment** from comments into one sentence + a `-1..1` score.
- Returns `sourceCoverUrls` (real video thumbnails) per place.

Output schema (strict JSON, enforced by prompt):

```json
{
  "places": [
    {
      "name": "Playa El Tunco",
      "location": "La Libertad, El Salvador",
      "shortDescription": "...",
      "trending": { "likes": 0, "views": 0 },
      "sentiment": "...",
      "sentimentScore": 0.0,
      "sourceCoverUrls": ["https://..."]
    }
  ]
}

```

### Step 4 — Parse

Local JSON.parse of the GPT response with a fallback to `{ places: [] }` on malformed output. Adds `placeId: null` to every record.

**Important — explicit non-goal:** GPT does **not** invent `placeId`. Place ID must come from a **separate Google Geocoding step** (name + location → `place_id`, `lat/lng`), run *after* this pipeline, because `place_id` is the agreed dedup key for the Mongo upsert. This keeps GPT's hallucination risk out of the primary key.

### Step 5 — Image (Next.js version only, not yet in Hono version)

- Prefers the **real cover thumbnail** from step 3 (`sourceCoverUrls[0]`) — free, authentic, instant.
- Falls back to `gpt-image-1` generation **only** when a place has no usable cover. ElevenLabs was originally diagrammed here but **is voice synthesis, not image generation** — it does not fit this step (it's used elsewhere, for the TikTok/IG growth-feature slideshows).
- `gpt-image-1` returns base64, not a URL — must be uploaded to a bucket (S3/Cloudinary/UploadThing) *inside* the step; do not carry raw base64 through workflow state.

### Step 6 — Persist (stubbed, not implemented)

Placeholder for the Mongo upsert. **Next agent's job:**

- Geocode each place (name + location → Google Geocoding API → `place_id`, `lat/lng`).
- Upsert on `place_id` as primary key, with fuzzy name+geo-proximity fallback for match misses.
- This must run **before** embedding generation (per agreed pipeline: dedup happens before embed).

## 4. Tech stack for this component

- **Runtime:** Upstash Workflow (`@upstash/workflow`) — durable steps, auto-retry, QStash-backed so long HTTP waits (Apify, OpenAI) don't burn compute.
- **Framework:** Hono (Node, via `@hono/node-server`) — chosen as a standalone deployable, separate process from the Fastify backend (Hono and Fastify don't share a process model; Fastify should call into this via `client.trigger`, not import it directly).
- **External APIs:** Apify (`api.apify.com/v2`), OpenAI (`api.openai.com/v1`, model `gpt-4o-mini`).

### Environment variables required

```
QSTASH_TOKEN=
APIFY_TOKEN=
OPENAI_API_KEY=

```

### Trigger contract

```ts
POST https://<workflow-host>/workflow/scrape-places
{
  "query": "mejores playas de El Salvador",
  "category": "Beach",
  "location": "El Salvador",     // optional, defaults to "El Salvador"
  "resultsLimit": 80             // optional, defaults to 80
}

```

Triggered via `@upstash/workflow` `Client.trigger()`, not a plain fetch — this is what gives retries/durability.

## 5. Open decisions for the next agent

1. **Actor input schema** — confirm real Apify actor + its exact input fields; current `searchQueries`/`resultsPerPage`/`shouldDownloadCovers` are placeholders.
2. **Geocoding step** — not yet built. Needs Google Geocoding API call per place, budget-aware (~10k free geocodes/month, billing required, TOS restricts caching + non-Google map display — keep this in mind for how results get shown on the map).
3. **Mongo upsert** — not yet built. Dedup key = `place_id`, fallback = fuzzy name + geo-proximity.
4. **Deployment target** — standalone service (Railway/Fly/Worker) that the rest of the stack calls via `client.trigger`. Not decided yet where it actually lives.
5. **300s Apify cap** — fine for hackathon-scale queries; swap to async start-and-poll if any category's scrape runs long.

## 6. Non-goals (explicitly out of scope for this component)

- Embedding generation (OpenAI embeddings → Upstash Vector) — Josue/Memo's stage, consumes this output.
- Search/ranking (`0.5*similarity + 0.3*trending + 0.2*sentiment`) — Bea's stage.
- Frontend rendering, maps, UI/UX.
- n8n email recommendations (Minero's stage).
- TikTok/IG auto-posting growth feature (separate, later).

## 7. Success criteria

- Given a real category + location query, the workflow returns a JSON array of distinct places (not raw videos) within a few minutes.
- Each place has enough structured data (name, location, description, trending, sentiment) for the embeddings stage to consume without further cleanup.
- No duplicate places from the same underlying location within one run (clustering handles this before geocoding-based dedup even applies).

