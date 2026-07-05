import type { PlaceWithMentions } from "./db";

const SEARCH_UPSERT_URL = "https://search.findy.place/upsert";
const DEFAULT_INDEX = "places";
const MAX_TEXT_FIELD = 400;
const MAX_SUMMARIES = 5;
const MAX_TRANSCRIPTS = 3;
const MAX_SOURCE_URLS = 5;
const MAX_SENTIMENTS = 10;

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

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function uniqueRecentTexts(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.unshift(truncate(item, MAX_TEXT_FIELD));
    if (result.length >= limit) break;
  }

  return result;
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

/** Best-effort index upsert — DB persistence already succeeded; search failures are logged, not thrown. */
export async function upsertSearchDocSafe(input: SearchUpsertInput): Promise<boolean> {
  try {
    await upsertSearchDoc(input);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[search] skipped index for ${input.id}: ${message}`);
    return false;
  }
}

export function buildSearchDoc(place: PlaceWithMentions): SearchUpsertInput {
  const sentiments = place.sentiments.slice(-MAX_SENTIMENTS);

  return {
    id: place.id,
    content: {
      name: place.canonicalName,
      locationText: place.locationText ?? "",
      category: place.category ?? "",
      summaries: uniqueRecentTexts(place.summaries, MAX_SUMMARIES),
      transcripts: uniqueRecentTexts(place.transcripts, MAX_TRANSCRIPTS),
    },
    metadata: {
      coordinates: place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null,
      department: place.department,
      municipality: place.municipality,
      category: place.category,
      verificationStatus: place.verificationStatus,
      sources: place.sources,
      sourceUrls: place.sourceUrls.slice(-MAX_SOURCE_URLS),
      mentionCount: place.mentionCount,
      engagement: {
        likes: place.totalLikes,
        comments: place.totalComments,
        shares: place.totalShares,
        bookmarks: place.totalBookmarks,
      },
      sentiments,
      videoIds: sentiments.map((s) => s.videoId),
      suspicious: place.suspicious,
    },
  };
}
