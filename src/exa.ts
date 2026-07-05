const EXA_SEARCH_URL = "https://api.exa.ai/search";
/** Exa free/starter plans cap results per request (typically 100). */
const EXA_MAX_NUM_RESULTS = 100;

export interface ExaSearchResult {
  url: string;
  title: string;
  score: number;
}

export interface DiscoverUrlsInput {
  query: string;
  category: string;
  maxUrls: number;
}

export interface DiscoverUrlsOptions {
  apiKey: string;
  excludeUrls?: string[];
}

export async function discoverUrls(
  input: DiscoverUrlsInput,
  options: DiscoverUrlsOptions,
): Promise<ExaSearchResult[]> {
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey,
    },
    body: JSON.stringify({
      query: `${input.query} El Salvador blog guía reseña`,
      type: "auto",
      numResults: Math.min(input.maxUrls * 2, EXA_MAX_NUM_RESULTS),
      useAutoprompt: true,
      contents: {
        text: false,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Exa search failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ url?: string; title?: string; score?: number }>;
  };

  const exclude = new Set(options.excludeUrls ?? []);
  const seen = new Set<string>();
  const results: ExaSearchResult[] = [];

  for (const item of data.results ?? []) {
    if (!item.url || exclude.has(item.url) || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    results.push({
      url: item.url,
      title: item.title ?? item.url,
      score: item.score ?? 0,
    });
    if (results.length >= input.maxUrls) {
      break;
    }
  }

  return results;
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
