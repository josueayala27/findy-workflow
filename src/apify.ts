import type { ApifyActorInput, RawApifyItem, ScrapeInput } from "./types";

const APIFY_BASE = "https://api.apify.com/v2";

const DEFAULT_ACTOR = "apidojo/tiktok-scraper";
const DEFAULT_LOCATION = "SV";
const DEFAULT_RESULTS_LIMIT = 50;
const IDENTITY_MAP_FUNCTION = "(object) => { return {...object} }";

export interface ApifyScrapeOptions {
  token: string;
  actor?: string;
}

export class ApifyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

function buildActorInput(input: ScrapeInput): ApifyActorInput {
  return {
    customMapFunction: IDENTITY_MAP_FUNCTION,
    dateRange: "LAST_SIX_MONTHS",
    includeSearchKeywords: false,
    keywords: [input.query],
    location: input.location ?? DEFAULT_LOCATION,
    maxItems: input.resultsLimit ?? DEFAULT_RESULTS_LIMIT,
    sortType: "MOST_LIKED",
  };
}

/**
 * Step 1 — Apify scraping.
 * Synchronous run with a 300s hard cap on Apify's side. If a category's scrape
 * regularly exceeds that, switch to the start-and-poll variant.
 */
export async function runApifyScraper(
  input: ScrapeInput,
  options: ApifyScrapeOptions,
): Promise<RawApifyItem[]> {
  const actor = (options.actor ?? DEFAULT_ACTOR).replace("/", "~");
  const url = `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${options.token}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildActorInput(input)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApifyError(
      `Apify run failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const items = (await response.json()) as RawApifyItem[];
  return Array.isArray(items) ? items : [];
}
