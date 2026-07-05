import type { ExistingPlace, PlaceRow } from "./db";
import { createLlmClient, generateJson } from "./llm";
import { isDuplicateCandidate } from "./place-matching";
import type { LocationMention, PlaceSummary, VideoAnalysis } from "./types";

const LIKE_WEIGHT = 1;
const COMMENT_WEIGHT = 2;
const SHARE_WEIGHT = 3;
const BOOKMARK_WEIGHT = 4;

export interface CanonicalizePlaceOptions {
  apiKey: string;
  model?: string;
}

const CANONICALIZE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      matchedExistingName: {
        type: ["string", "null"],
        description:
          "If this place is the same real-world place as one already in the known list, or as another place mentioned in this same video, return that place's name exactly as given. Otherwise null.",
      },
      canonicalName: {
        type: "string",
        description:
          "A normalized, human-readable name for this place (e.g. 'Playa Los Cóbanos'). If matchedExistingName is set, this must equal it.",
      },
    },
    required: ["matchedExistingName", "canonicalName"],
    additionalProperties: false,
  },
};

/**
 * Resolves each of a video's mentioned locations to a canonical place name, matching
 * against places already known from other videos as well as against each other (so a
 * place named twice within the same video collapses to one canonical name).
 */
export async function canonicalizePlaces(
  locations: LocationMention[],
  summary: string,
  existingPlaces: ExistingPlace[],
  options: CanonicalizePlaceOptions,
): Promise<string[]> {
  if (locations.length === 0) {
    return [];
  }

  const client = createLlmClient(options);

  const prompt = [
    "A video mentions these places:",
    JSON.stringify(locations.map((location) => ({ name: location.name, coordinates: location.coordinates }))),
    "Video summary for context:",
    summary,
    "Here is a list of places already known from other videos:",
    JSON.stringify(existingPlaces.map((place) => ({ name: place.name, lat: place.lat, lng: place.lng }))),
    "For each mentioned place, in the same order, decide whether it is the same real-world place as one already in the known list, or as another place mentioned earlier in this same list (accounting for spelling, phrasing, or language differences), or if it's a new distinct place.",
    "If a mentioned place differs from a known place only by a city or region suffix, such as 'X' versus 'X, San Salvador', return the known place name exactly.",
  ].join("\n");

  const parsed = await generateJson<Array<{ matchedExistingName: string | null; canonicalName: string }>>(
    client,
    prompt,
    CANONICALIZE_SCHEMA,
    { model: options.model, schemaName: "canonicalize_places" },
  );

  return parsed.map((entry) => entry.matchedExistingName ?? entry.canonicalName);
}

function weightedEngagement(row: PlaceRow): number {
  return (
    Number(row.totalLikes) * LIKE_WEIGHT +
    Number(row.totalComments) * COMMENT_WEIGHT +
    Number(row.totalShares) * SHARE_WEIGHT +
    Number(row.totalBookmarks) * BOOKMARK_WEIGHT
  );
}

function chooseDisplayRow(rows: PlaceRow[]): PlaceRow {
  return rows
    .slice()
    .sort((a, b) => {
      if (a.googlePlaceId && !b.googlePlaceId) return -1;
      if (!a.googlePlaceId && b.googlePlaceId) return 1;
      if ((b.canonicalName?.length ?? 0) !== (a.canonicalName?.length ?? 0)) {
        return b.canonicalName.length - a.canonicalName.length;
      }
      return b.mentionCount - a.mentionCount;
    })[0];
}

export function deduplicatePlaceRows(rows: PlaceRow[]): PlaceRow[] {
  const groups: PlaceRow[][] = [];

  for (const row of rows) {
    const group = groups.find((existing) => existing.some((candidate) => isDuplicateCandidate(row, candidate)));
    if (group) {
      group.push(row);
    } else {
      groups.push([row]);
    }
  }

  return groups.map((group) => {
    const display = chooseDisplayRow(group);
    return {
      ...display,
      mentionCount: group.reduce((sum, row) => sum + Number(row.mentionCount), 0),
      totalLikes: group.reduce((sum, row) => sum + Number(row.totalLikes), 0),
      totalComments: group.reduce((sum, row) => sum + Number(row.totalComments), 0),
      totalShares: group.reduce((sum, row) => sum + Number(row.totalShares), 0),
      totalBookmarks: group.reduce((sum, row) => sum + Number(row.totalBookmarks), 0),
      sentiments: group.flatMap((row) => row.sentiments),
      suspicious: group.every((row) => row.suspicious),
    };
  });
}

export function computeScores(rows: PlaceRow[]): PlaceSummary[] {
  const dedupedRows = deduplicatePlaceRows(rows);
  const maxWeighted = Math.max(1, ...dedupedRows.map(weightedEngagement));

  return dedupedRows
    .map((row) => ({
      placeId: row.id,
      name: row.canonicalName,
      location: row.locationText,
      coordinates: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
      score: weightedEngagement(row) / maxWeighted,
      mentionCount: row.mentionCount,
      engagement: {
        likes: Number(row.totalLikes),
        comments: Number(row.totalComments),
        shares: Number(row.totalShares),
        bookmarks: Number(row.totalBookmarks),
      },
      sentiments: row.sentiments.map((sentiment) => ({
        videoId: sentiment.videoId,
        sentiment: sentiment.sentiment as VideoAnalysis["sentiment"],
        sentimentScore: Number(sentiment.sentimentScore),
      })),
      suspicious: row.suspicious,
    }))
    .sort((a, b) => b.score - a.score);
}
