import { GoogleGenAI, Type } from "@google/genai";
import type { ExistingPlace, PlaceRow } from "./db";
import type { PlaceSummary, VideoAnalysis } from "./types";

const MODEL = "gemini-2.5-flash";

const LIKE_WEIGHT = 1;
const COMMENT_WEIGHT = 2;
const SHARE_WEIGHT = 3;
const BOOKMARK_WEIGHT = 4;

export interface CanonicalizePlaceOptions {
  apiKey: string;
}

const CANONICALIZE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    matchedExistingName: {
      type: Type.STRING,
      nullable: true,
      description:
        "If this place is the same real-world place as one already in the existing list, return that place's name exactly as given. Otherwise null.",
    },
    canonicalName: {
      type: Type.STRING,
      description:
        "A normalized, human-readable name for this place (e.g. 'Playa Los Cóbanos'). If matchedExistingName is set, this must equal it.",
    },
  },
  required: ["matchedExistingName", "canonicalName"],
};

export async function canonicalizePlace(
  analysis: Pick<VideoAnalysis, "location" | "coordinates" | "summary">,
  existingPlaces: ExistingPlace[],
  options: CanonicalizePlaceOptions,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const prompt = [
    "A video mentions this place:",
    JSON.stringify({
      location: analysis.location,
      coordinates: analysis.coordinates,
      summary: analysis.summary,
    }),
    "Here is a list of places already known from other videos:",
    JSON.stringify(existingPlaces.map((place) => ({ name: place.name, lat: place.lat, lng: place.lng }))),
    "Decide whether the mentioned place is the same real-world place as one already in the list (accounting for spelling, phrasing, or language differences), or if it's a new place.",
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

  const parsed = JSON.parse(text) as { matchedExistingName: string | null; canonicalName: string };
  return parsed.matchedExistingName ?? parsed.canonicalName;
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
    }))
    .sort((a, b) => b.score - a.score);
}
