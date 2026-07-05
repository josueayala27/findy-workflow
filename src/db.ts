import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { isWithinElSalvador } from "./geocode";
import type { Coordinates, RawApifyItem, VideoAnalysis } from "./types";

export type Sql = NeonQueryFunction<false, false>;

export function getSqlClient(databaseUrl: string): Sql {
  return neon(databaseUrl);
}

export interface ExistingPlace {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export async function getPlaceNames(sql: Sql): Promise<ExistingPlace[]> {
  const rows = (await sql`
    SELECT id, canonical_name, lat, lng
    FROM places
    ORDER BY mention_count DESC
    LIMIT 300
  `) as Array<{ id: string; canonical_name: string; lat: number | null; lng: number | null }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.canonical_name,
    lat: row.lat,
    lng: row.lng,
  }));
}

export interface ResolvedPlaceMention {
  canonicalName: string;
  locationText: string;
  coordinates: Coordinates | null;
}

export interface UpsertPlaceMentionsInput {
  category?: string;
  item: RawApifyItem;
  analysis: Pick<VideoAnalysis, "videoId" | "sentiment" | "sentimentScore" | "summary" | "transcription">;
  places: ResolvedPlaceMention[];
}

/**
 * Persists a video's resolved, deduped place mentions. Engagement is split evenly
 * across `places` so a video mentioning several places doesn't credit each one with
 * the full engagement of the video.
 */
export async function upsertPlaceMentions(sql: Sql, input: UpsertPlaceMentionsInput): Promise<string[]> {
  const { category, item, analysis, places } = input;
  if (places.length === 0) {
    return [];
  }

  const likes = Math.round((item.likes ?? 0) / places.length);
  const comments = Math.round((item.comments ?? 0) / places.length);
  const shares = Math.round((item.shares ?? 0) / places.length);
  const bookmarks = Math.round((item.bookmarks ?? 0) / places.length);

  const touchedPlaceIds = new Set<string>();

  for (const place of places) {
    const suspiciousLocation = !isWithinElSalvador(place.coordinates);

    const inserted = (await sql`
      INSERT INTO places (canonical_name, location_text, lat, lng, category, suspicious_location)
      VALUES (${place.canonicalName}, ${place.locationText}, ${place.coordinates?.lat ?? null}, ${place.coordinates?.lng ?? null}, ${category ?? null}, ${suspiciousLocation})
      ON CONFLICT (canonical_name) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;

    const placeId =
      inserted[0]?.id ??
      ((await sql`SELECT id FROM places WHERE canonical_name = ${place.canonicalName}`) as Array<{ id: string }>)[0].id;

    const insertedMention = (await sql`
      INSERT INTO place_mentions (place_id, video_id, sentiment, sentiment_score, likes, comments, shares, bookmarks, summary, location_text, transcript)
      VALUES (${placeId}, ${analysis.videoId}, ${analysis.sentiment}, ${analysis.sentimentScore}, ${likes}, ${comments}, ${shares}, ${bookmarks}, ${analysis.summary}, ${place.locationText}, ${analysis.transcription})
      ON CONFLICT (video_id, place_id) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;

    if (insertedMention.length === 0) {
      continue;
    }

    await sql`
      UPDATE places
      SET
        mention_count = mention_count + 1,
        total_likes = total_likes + ${likes},
        total_comments = total_comments + ${comments},
        total_shares = total_shares + ${shares},
        total_bookmarks = total_bookmarks + ${bookmarks},
        updated_at = now()
      WHERE id = ${placeId}
    `;

    touchedPlaceIds.add(placeId);
  }

  return Array.from(touchedPlaceIds);
}

export interface PlaceRow {
  id: string;
  canonicalName: string;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
  mentionCount: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalBookmarks: number;
  suspicious: boolean;
  sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
}

export interface PlaceWithMentions extends PlaceRow {
  category: string | null;
  summaries: string[];
  transcripts: string[];
}

/**
 * Re-derives a place's full current state (across all videos that mention it) straight
 * from Postgres, so a search-index doc can be rebuilt as a complete, idempotent snapshot
 * rather than an incremental patch.
 */
export async function getPlaceWithMentions(sql: Sql, placeId: string): Promise<PlaceWithMentions | null> {
  const rows = (await sql`
    SELECT
      p.id,
      p.canonical_name,
      p.location_text,
      p.lat,
      p.lng,
      p.category,
      p.mention_count,
      p.total_likes,
      p.total_comments,
      p.total_shares,
      p.total_bookmarks,
      p.suspicious_location,
      COALESCE(
        json_agg(
          json_build_object('videoId', m.video_id, 'sentiment', m.sentiment, 'sentimentScore', m.sentiment_score)
          ORDER BY m.created_at
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS sentiments,
      COALESCE(
        json_agg(m.summary ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS summaries,
      COALESCE(
        json_agg(m.transcript ORDER BY m.created_at) FILTER (WHERE m.transcript IS NOT NULL),
        '[]'
      ) AS transcripts
    FROM places p
    LEFT JOIN place_mentions m ON m.place_id = p.id
    WHERE p.id = ${placeId}
    GROUP BY p.id
  `) as Array<{
    id: string;
    canonical_name: string;
    location_text: string | null;
    lat: number | null;
    lng: number | null;
    category: string | null;
    mention_count: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
    total_bookmarks: number;
    suspicious_location: boolean;
    sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
    summaries: string[];
    transcripts: string[];
  }>;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    canonicalName: row.canonical_name,
    locationText: row.location_text,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    mentionCount: row.mention_count,
    totalLikes: row.total_likes,
    totalComments: row.total_comments,
    totalShares: row.total_shares,
    totalBookmarks: row.total_bookmarks,
    suspicious: row.suspicious_location,
    sentiments: row.sentiments,
    summaries: row.summaries,
    transcripts: row.transcripts,
  };
}

export async function listPlacesWithScores(sql: Sql): Promise<PlaceRow[]> {
  const rows = (await sql`
    SELECT
      p.id,
      p.canonical_name,
      p.location_text,
      p.lat,
      p.lng,
      p.mention_count,
      p.total_likes,
      p.total_comments,
      p.total_shares,
      p.total_bookmarks,
      p.suspicious_location,
      COALESCE(
        json_agg(
          json_build_object('videoId', m.video_id, 'sentiment', m.sentiment, 'sentimentScore', m.sentiment_score)
          ORDER BY m.created_at
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS sentiments
    FROM places p
    LEFT JOIN place_mentions m ON m.place_id = p.id
    GROUP BY p.id
    ORDER BY p.mention_count DESC
  `) as Array<{
    id: string;
    canonical_name: string;
    location_text: string | null;
    lat: number | null;
    lng: number | null;
    mention_count: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
    total_bookmarks: number;
    suspicious_location: boolean;
    sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
  }>;

  return rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
    locationText: row.location_text,
    lat: row.lat,
    lng: row.lng,
    mentionCount: row.mention_count,
    totalLikes: row.total_likes,
    totalComments: row.total_comments,
    totalShares: row.total_shares,
    totalBookmarks: row.total_bookmarks,
    suspicious: row.suspicious_location,
    sentiments: row.sentiments,
  }));
}
