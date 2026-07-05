import type { PlaceWithMentions } from "./db";

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

export function buildSearchDoc(place: PlaceWithMentions): SearchUpsertInput {
  return {
    id: place.id,
    content: {
      name: place.canonicalName,
      locationText: place.locationText,
      summaries: place.summaries,
      transcripts: place.transcripts,
    },
    metadata: {
      coordinates: place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null,
      department: place.department,
      municipality: place.municipality,
      category: place.category,
      verificationStatus: place.verificationStatus,
      sources: place.sources,
      sourceUrls: place.sourceUrls,
      mentionCount: place.mentionCount,
      engagement: {
        likes: place.totalLikes,
        comments: place.totalComments,
        shares: place.totalShares,
        bookmarks: place.totalBookmarks,
      },
      sentiments: place.sentiments,
      videoIds: place.sentiments.map((s) => s.videoId),
      suspicious: place.suspicious,
    },
  };
}
