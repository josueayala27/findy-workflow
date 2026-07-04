import { getPlaceNames, getSqlClient, listPlacesWithScores, upsertPlaceMention } from "./src/db";
import { canonicalizePlace, computeScores } from "./src/places";
import type { RawApifyItem, VideoAnalysis } from "./src/types";

async function main() {
  const databaseUrl = process.env.DATABASE_URL!;
  const apiKey = process.env.GEMINI_API_KEY!;
  const sql = getSqlClient(databaseUrl);

  const analysisA: VideoAnalysis = {
    videoId: "test-video-1",
    sentiment: "excited",
    sentimentScore: 0.9,
    transcription: "",
    location: "Los Cobanos, El Salvador",
    coordinates: { lat: 13.522, lng: -89.559 },
    summary: "A video about Los Cobanos beach.",
  };
  const itemA: RawApifyItem = { id: "test-video-1", likes: 100, comments: 10, shares: 5, bookmarks: 20 };

  const analysisB: VideoAnalysis = {
    videoId: "test-video-2",
    sentiment: "happy",
    sentimentScore: 0.7,
    transcription: "",
    location: "Playa Los Cóbanos",
    coordinates: { lat: 13.5225, lng: -89.5595 },
    summary: "Another video about Playa Los Cóbanos.",
  };
  const itemB: RawApifyItem = { id: "test-video-2", likes: 50, comments: 5, shares: 2, bookmarks: 10 };

  for (const [analysis, item] of [
    [analysisA, itemA],
    [analysisB, itemB],
  ] as const) {
    const existingPlaces = await getPlaceNames(sql);
    console.log("existing places before canonicalizing", analysis.videoId, existingPlaces);
    const canonicalName = await canonicalizePlace(analysis, existingPlaces, { apiKey });
    console.log("canonicalName ->", canonicalName);
    await upsertPlaceMention(sql, { canonicalName, category: "Beach", item, analysis });
  }

  const rows = await listPlacesWithScores(sql);
  const summaries = computeScores(rows);
  console.log(JSON.stringify(summaries, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
