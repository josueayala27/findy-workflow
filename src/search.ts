const SEARCH_UPSERT_URL = "https://search.findy.place/upsert";
const DEFAULT_INDEX = "places";

export interface SearchUpsertInput {
  index?: string;
  id: string;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class SearchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

export async function upsertSearchDoc(input: SearchUpsertInput): Promise<void> {
  const response = await fetch(SEARCH_UPSERT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      index: input.index ?? DEFAULT_INDEX,
      id: input.id,
      content: input.content,
      metadata: input.metadata,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SearchError(`Search upsert failed (${response.status}): ${detail.slice(0, 500)}`, response.status);
  }
}
