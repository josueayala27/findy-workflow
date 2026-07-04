import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { RawApifyItem, VideoAnalysis } from "./types";

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

export interface UpsertPlaceMentionInput {
  canonicalName: string;
  category?: string;
  item: RawApifyItem;
  analysis: VideoAnalysis;
}

export async function upsertPlaceMention(sql: Sql, input: UpsertPlaceMentionInput): Promise<void> {
  const { canonicalName, category, item, analysis } = input;

  const inserted = (await sql`
    INSERT INTO places (canonical_name, location_text, lat, lng, category)
    VALUES (${canonicalName}, ${analysis.location}, ${analysis.coordinates?.lat ?? null}, ${analysis.coordinates?.lng ?? null}, ${category ?? null})
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  const placeId =
    inserted[0]?.id ??
    ((await sql`SELECT id FROM places WHERE canonical_name = ${canonicalName}`) as Array<{ id: string }>)[0].id;

  const likes = item.likes ?? 0;
  const comments = item.comments ?? 0;
  const shares = item.shares ?? 0;
  const bookmarks = item.bookmarks ?? 0;

  const insertedMention = (await sql`
    INSERT INTO place_mentions (place_id, video_id, sentiment, sentiment_score, likes, comments, shares, bookmarks, summary, location_text)
    VALUES (${placeId}, ${item.id}, ${analysis.sentiment}, ${analysis.sentimentScore}, ${likes}, ${comments}, ${shares}, ${bookmarks}, ${analysis.summary}, ${analysis.location})
    ON CONFLICT (video_id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  if (insertedMention.length === 0) {
    return;
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
  sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
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
    sentiments: row.sentiments,
  }));
}
