import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { isWithinElSalvador } from "./geocode";
import * as schema from "./schema";
import type { Coordinates, RawApifyItem, VideoAnalysis } from "./types";

export type Sql = NeonQueryFunction<false, false>;
export type MentionSource = "tiktok" | "instagram" | "web";
export type VerificationStatus = "verified" | "unverified" | "rejected";
export type Db = NeonHttpDatabase<typeof schema>;

export function getSqlClient(databaseUrl: string): Sql {
  return neon(databaseUrl);
}

/** Drizzle client for new queries. Existing tagged-SQL functions in this file are unaffected. */
export function getDrizzleClient(databaseUrl: string): Db {
  return drizzle(neon(databaseUrl), { schema });
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

export async function findPlaceByCanonicalName(
  sql: Sql,
  canonicalName: string,
): Promise<{ id: string } | null> {
  const rows = (await sql`
    SELECT id FROM places WHERE canonical_name = ${canonicalName} LIMIT 1
  `) as Array<{ id: string }>;
  return rows[0] ?? null;
}

export async function findPlaceByGoogleId(
  sql: Sql,
  googlePlaceId: string,
): Promise<{ id: string; canonicalName: string } | null> {
  const rows = (await sql`
    SELECT id, canonical_name FROM places WHERE google_place_id = ${googlePlaceId} LIMIT 1
  `) as Array<{ id: string; canonical_name: string }>;
  return rows[0] ? { id: rows[0].id, canonicalName: rows[0].canonical_name } : null;
}

export async function countDistinctSources(sql: Sql, placeId: string): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(DISTINCT source)::int AS count
    FROM place_mentions
    WHERE place_id = ${placeId}
  `) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

export async function getProcessedWebUrls(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    SELECT url FROM web_sources WHERE status = 'processed'
  `) as Array<{ url: string }>;
  return rows.map((r) => r.url);
}

export async function registerWebSource(
  sql: Sql,
  url: string,
  domain: string,
  category: string,
): Promise<void> {
  await sql`
    INSERT INTO web_sources (url, domain, category, status)
    VALUES (${url}, ${domain}, ${category}, 'pending')
    ON CONFLICT (url) DO NOTHING
  `;
}

export async function markWebSourceStatus(
  sql: Sql,
  url: string,
  status: "processed" | "failed",
): Promise<void> {
  await sql`
    UPDATE web_sources SET status = ${status}, scraped_at = now() WHERE url = ${url}
  `;
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
  sourceUrl?: string;
}

/** @deprecated Use persistAndIndexPlace from persist.ts instead. Kept for compatibility. */
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
      INSERT INTO place_mentions (place_id, video_id, sentiment, sentiment_score, likes, comments, shares, bookmarks, summary, location_text, transcript, source, source_url)
      VALUES (${placeId}, ${analysis.videoId}, ${analysis.sentiment}, ${analysis.sentimentScore}, ${likes}, ${comments}, ${shares}, ${bookmarks}, ${analysis.summary}, ${place.locationText}, ${analysis.transcription}, 'tiktok', ${input.sourceUrl ?? item.video?.url ?? null})
      ON CONFLICT (place_id, source, video_id) DO NOTHING
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
  verificationStatus: VerificationStatus;
  verificationScore: number | null;
  department: string | null;
  municipality: string | null;
  googlePlaceId: string | null;
  sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
}

export interface PlaceWithMentions extends PlaceRow {
  category: string | null;
  summaries: string[];
  transcripts: string[];
  sources: MentionSource[];
  sourceUrls: string[];
}

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
      p.verification_status,
      p.verification_score,
      p.department,
      p.municipality,
      p.google_place_id,
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
      ) AS transcripts,
      COALESCE(
        json_agg(DISTINCT m.source) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS sources,
      COALESCE(
        json_agg(m.source_url ORDER BY m.created_at) FILTER (WHERE m.source_url IS NOT NULL),
        '[]'
      ) AS source_urls
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
    verification_status: VerificationStatus;
    verification_score: string | null;
    department: string | null;
    municipality: string | null;
    google_place_id: string | null;
    sentiments: Array<{ videoId: string; sentiment: string; sentimentScore: number }>;
    summaries: string[];
    transcripts: string[];
    sources: MentionSource[];
    source_urls: string[];
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
    verificationStatus: row.verification_status ?? "unverified",
    verificationScore: row.verification_score ? Number(row.verification_score) : null,
    department: row.department,
    municipality: row.municipality,
    googlePlaceId: row.google_place_id,
    sentiments: row.sentiments,
    summaries: row.summaries,
    transcripts: row.transcripts,
    sources: row.sources ?? [],
    sourceUrls: row.source_urls ?? [],
  };
}

export async function listAllPlaceIds(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    SELECT id FROM places WHERE verification_status != 'rejected'
  `) as Array<{ id: string }>;
  return rows.map((r) => r.id);
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
      p.verification_status,
      p.verification_score,
      p.department,
      p.municipality,
      p.google_place_id,
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
    verification_status: VerificationStatus;
    verification_score: string | null;
    department: string | null;
    municipality: string | null;
    google_place_id: string | null;
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
    verificationStatus: row.verification_status ?? "unverified",
    verificationScore: row.verification_score ? Number(row.verification_score) : null,
    department: row.department,
    municipality: row.municipality,
    googlePlaceId: row.google_place_id,
    sentiments: row.sentiments,
  }));
}
