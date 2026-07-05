import { GoogleGenAI, Type } from "@google/genai";
import type { ExistingPlace, PlaceRow } from "./db";
import type { LocationMention, PlaceSummary, VideoAnalysis } from "./types";

const MODEL = "gemini-2.5-flash";

const LIKE_WEIGHT = 1;
const COMMENT_WEIGHT = 2;
const SHARE_WEIGHT = 3;
const BOOKMARK_WEIGHT = 4;

export interface CanonicalizePlaceOptions {
  apiKey: string;
}

const CANONICALIZE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      matchedExistingName: {
        type: Type.STRING,
        nullable: true,
        description:
          "If this place is the same real-world place as one already in the known list, or as another place mentioned in this same video, return that place's name exactly as given. Otherwise null.",
      },
      canonicalName: {
        type: Type.STRING,
        description:
          "A normalized, human-readable name for this place (e.g. 'Playa Los Cóbanos'). If matchedExistingName is set, this must equal it.",
      },
    },
    required: ["matchedExistingName", "canonicalName"],
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

  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const prompt = [
    "A video mentions these places:",
    JSON.stringify(locations.map((location) => ({ name: location.name, coordinates: location.coordinates }))),
    "Video summary for context:",
    summary,
    "Here is a list of places already known from other videos:",
    JSON.stringify(existingPlaces.map((place) => ({ name: place.name, lat: place.lat, lng: place.lng }))),
    "For each mentioned place, in the same order, decide whether it is the same real-world place as one already in the known list, or as another place mentioned earlier in this same list (accounting for spelling, phrasing, or language differences), or if it's a new distinct place.",
  ].join("\n");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: CANONICALIZE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no output for place canonicalization");
  }

  const parsed = JSON.parse(text) as Array<{ matchedExistingName: string | null; canonicalName: string }>;
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

export function computeScores(rows: PlaceRow[]): PlaceSummary[] {
  const maxWeighted = Math.max(1, ...rows.map(weightedEngagement));

  return rows
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
