import type { Sql } from "./db";
import {
  countDistinctSources,
  findPlaceByCanonicalName,
  findPlaceByGoogleId,
  getPlaceNames,
  type ResolvedPlaceMention,
} from "./db";
import { analyzeVideo as analyzeVideoWithGemini } from "./gemini";
import { resolveCoordinates } from "./geocode";
import { findPlaceByText } from "./google-places";
import { resolveLocations } from "./location";
import { canonicalizePlaces } from "./places";
import { persistAndIndexPlace } from "./persist";
import type { Category, LocationMention, RawApifyItem, VideoAnalysis } from "./types";
import { verifyPlace } from "./verify";

export interface ProcessItemOptions {
  category: Category;
  /** Gemini key for video analysis (Files API). */
  geminiApiKey: string;
  /** OpenRouter key for text LLM calls (resolveLocations, canonicalizePlaces). */
  openRouterApiKey: string;
  openRouterModel?: string;
  googleApiKey?: string;
  /** Swap out the video-analysis step when Gemini quota is exhausted. */
  analyzeVideo?: (item: RawApifyItem, opts: { apiKey: string }) => Promise<VideoAnalysis>;
}

/**
 * Runs one scraped TikTok item through analysis, location resolution, geocoding,
 * place canonicalization, verification, and persistence. Shared by the /workflow route
 * and the offline ingestion script so both stay in sync.
 */
export async function processApifyItem(
  sql: Sql,
  item: RawApifyItem,
  options: ProcessItemOptions,
): Promise<VideoAnalysis> {
  const {
    category,
    geminiApiKey,
    openRouterApiKey,
    openRouterModel,
    googleApiKey,
    analyzeVideo = analyzeVideoWithGemini,
  } = options;

  const llmOptions = { apiKey: openRouterApiKey, model: openRouterModel };

  const videoAnalysis = await analyzeVideo(item, { apiKey: geminiApiKey });

  if (videoAnalysis.locations.length === 0) {
    return videoAnalysis;
  }

  const resolvedNames = await resolveLocations(
    videoAnalysis.locations.map((location) => location.name),
    llmOptions,
  );

  const resolved = videoAnalysis.locations
    .map((location, index) => ({ name: resolvedNames[index], coordinates: location.coordinates }))
    .filter((location): location is LocationMention => location.name !== null);

  if (resolved.length === 0) {
    videoAnalysis.locations = [];
    return videoAnalysis;
  }

  const geocoded: LocationMention[] = [];
  for (const location of resolved) {
    const geocode = await resolveCoordinates({
      name: location.name,
      googleApiKey,
    });
    geocoded.push({
      name: location.name,
      coordinates: geocode?.coordinates ?? null,
    });
  }
  videoAnalysis.locations = geocoded;

  const existingPlaces = await getPlaceNames(sql);
  const canonicalNames = await canonicalizePlaces(geocoded, videoAnalysis.summary, existingPlaces, llmOptions);

  const deduped = new Map<string, ResolvedPlaceMention>();
  geocoded.forEach((location, index) => {
    const canonicalName = canonicalNames[index];
    if (!deduped.has(canonicalName)) {
      deduped.set(canonicalName, {
        canonicalName,
        locationText: location.name,
        coordinates: location.coordinates,
      });
    }
  });

  const likes = Math.round((item.likes ?? 0) / deduped.size);
  const comments = Math.round((item.comments ?? 0) / deduped.size);
  const shares = Math.round((item.shares ?? 0) / deduped.size);
  const bookmarks = Math.round((item.bookmarks ?? 0) / deduped.size);

  for (const place of deduped.values()) {
    const geocode = await resolveCoordinates({
      name: place.canonicalName,
      locationText: place.locationText,
      googleApiKey,
    });

    const googlePlace = googleApiKey
      ? await findPlaceByText(place.canonicalName, place.locationText, googleApiKey)
      : null;

    const existingByGoogle = googlePlace ? await findPlaceByGoogleId(sql, googlePlace.placeId) : null;
    const existingByName = existingByGoogle ? null : await findPlaceByCanonicalName(sql, place.canonicalName);
    const existingPlaceId = existingByGoogle?.id ?? existingByName?.id;
    const existingSourceCount = existingPlaceId ? await countDistinctSources(sql, existingPlaceId) : 0;

    const verifyResult = verifyPlace({
      name: place.canonicalName,
      locationText: place.locationText,
      category,
      coordinates: geocode?.coordinates ?? place.coordinates,
      googlePlace,
      existingSourceCount,
      incomingSource: "tiktok",
    });

    await persistAndIndexPlace(sql, {
      canonicalName: place.canonicalName,
      locationText: place.locationText,
      category,
      coordinates: geocode?.coordinates ?? place.coordinates,
      geocode,
      googlePlace,
      verifyResult,
      mention: {
        source: "tiktok",
        videoId: videoAnalysis.videoId,
        sourceUrl: item.video?.url ?? item.postPage ?? null,
        sentiment: videoAnalysis.sentiment,
        sentimentScore: videoAnalysis.sentimentScore,
        likes,
        comments,
        shares,
        bookmarks,
        summary: videoAnalysis.summary,
        locationText: place.locationText,
        transcript: videoAnalysis.transcription,
      },
    });
  }

  return videoAnalysis;
}
