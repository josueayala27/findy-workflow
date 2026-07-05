import type { Sql } from "./db";
import { getPlaceNames, getPlaceWithMentions, upsertPlaceMentions, type ResolvedPlaceMention } from "./db";
import { analyzeVideo as analyzeVideoWithGemini } from "./gemini";
import { geocodeLocation } from "./geocode";
import { resolveLocations } from "./location";
import { canonicalizePlaces } from "./places";
import { upsertSearchDoc } from "./search";
import type { Category, LocationMention, RawApifyItem, VideoAnalysis } from "./types";

export interface ProcessItemOptions {
  category: Category;
  /** Gemini key, used for resolveLocations + canonicalizePlaces, and as the default video analyzer's key. */
  apiKey: string;
  /** Swap out the video-analysis step (e.g. for analyzeVideoWithOpenAI when Gemini's Files API quota is exhausted). Defaults to Gemini. */
  analyzeVideo?: (item: RawApifyItem, opts: { apiKey: string }) => Promise<VideoAnalysis>;
}

/**
 * Runs one scraped TikTok item through analysis, location resolution, geocoding,
 * place canonicalization, and persistence. Shared by the /workflow route and the
 * offline ingestion script so both stay in sync.
 */
export async function processApifyItem(
  sql: Sql,
  item: RawApifyItem,
  options: ProcessItemOptions,
): Promise<VideoAnalysis> {
  const { category, apiKey, analyzeVideo = analyzeVideoWithGemini } = options;

  const videoAnalysis = await analyzeVideo(item, { apiKey });

  if (videoAnalysis.locations.length === 0) {
    return videoAnalysis;
  }

  const resolvedNames = await resolveLocations(
    videoAnalysis.locations.map((location) => location.name),
    { apiKey },
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
    const coordinates = await geocodeLocation(location.name);
    geocoded.push({ name: location.name, coordinates });
  }
  videoAnalysis.locations = geocoded;

  const existingPlaces = await getPlaceNames(sql);
  const canonicalNames = await canonicalizePlaces(geocoded, videoAnalysis.summary, existingPlaces, { apiKey });

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

  const touchedPlaceIds = await upsertPlaceMentions(sql, {
    category,
    item,
    analysis: videoAnalysis,
    places: Array.from(deduped.values()),
  });

  for (const placeId of touchedPlaceIds) {
    const place = await getPlaceWithMentions(sql, placeId);
    if (!place) {
      continue;
    }

    await upsertSearchDoc({
      id: place.id,
      content: {
        name: place.canonicalName,
        locationText: place.locationText,
        summaries: place.summaries,
        transcripts: place.transcripts,
      },
      metadata: {
        coordinates: place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null,
        category: place.category,
        mentionCount: place.mentionCount,
        engagement: {
          likes: place.totalLikes,
          comments: place.totalComments,
          shares: place.totalShares,
          bookmarks: place.totalBookmarks,
        },
        sentiments: place.sentiments,
        videoIds: place.sentiments.map((sentiment) => sentiment.videoId),
        suspicious: place.suspicious,
      },
    });
  }

  return videoAnalysis;
}
