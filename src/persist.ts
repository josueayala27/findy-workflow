import {
  countDistinctSources,
  findPlaceByGoogleId,
  getPlaceWithMentions,
  type PlaceWithMentions,
  type Sql,
} from "./db";
import { isWithinElSalvador, type GeocodeResult } from "./geocode";
import type { GooglePlaceResult } from "./google-places";
import { buildSearchDoc, upsertSearchDocSafe } from "./search";
import type { VerifyResult } from "./verify";
import type { Coordinates } from "./types";

export type MentionSource = "tiktok" | "instagram" | "web";

export interface TikTokMentionInput {
  source: "tiktok" | "instagram";
  videoId: string;
  sourceUrl?: string;
  sentiment: string;
  sentimentScore: number;
  likes: number;
  comments: number;
  shares: number;
  bookmarks: number;
  summary: string;
  locationText: string;
  transcript: string;
  evidence?: null;
}

export interface WebMentionInput {
  source: "web";
  sourceUrl: string;
  videoId: string;
  sentiment: string;
  sentimentScore: number;
  summary: string;
  locationText: string;
  evidence: string;
}

export type MentionInput = TikTokMentionInput | WebMentionInput;

export interface PersistPlaceInput {
  canonicalName: string;
  locationText: string;
  category: string;
  coordinates: Coordinates | null;
  geocode: GeocodeResult | null;
  googlePlace: GooglePlaceResult | null;
  verifyResult: VerifyResult;
  mention: MentionInput;
}

function webVideoId(sourceUrl: string): string {
  let hash = 0;
  for (let i = 0; i < sourceUrl.length; i++) {
    hash = (hash << 5) - hash + sourceUrl.charCodeAt(i);
    hash |= 0;
  }
  return `web:${Math.abs(hash).toString(16)}`;
}

async function resolvePlaceId(
  sql: Sql,
  input: PersistPlaceInput,
): Promise<{ placeId: string; isNew: boolean }> {
  if (input.verifyResult.googlePlaceId) {
    const existing = await findPlaceByGoogleId(sql, input.verifyResult.googlePlaceId);
    if (existing) {
      return { placeId: existing.id, isNew: false };
    }
  }

  const lat = input.coordinates?.lat ?? input.googlePlace?.lat ?? null;
  const lng = input.coordinates?.lng ?? input.googlePlace?.lng ?? null;
  const coords = lat !== null && lng !== null ? { lat, lng } : null;
  const suspicious = !isWithinElSalvador(coords) || input.verifyResult.status === "rejected";

  const inserted = (await sql`
    INSERT INTO places (
      canonical_name, location_text, lat, lng, category,
      suspicious_location, google_place_id, verification_status, verification_score,
      department, municipality
    )
    VALUES (
      ${input.canonicalName},
      ${input.locationText},
      ${lat},
      ${lng},
      ${input.category},
      ${suspicious},
      ${input.verifyResult.googlePlaceId},
      ${input.verifyResult.status},
      ${input.verifyResult.score},
      ${input.geocode?.department ?? null},
      ${input.geocode?.municipality ?? null}
    )
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  if (inserted[0]) {
    return { placeId: inserted[0].id, isNew: true };
  }

  const byName = (await sql`
    SELECT id FROM places WHERE canonical_name = ${input.canonicalName}
  `) as Array<{ id: string }>;

  return { placeId: byName[0].id, isNew: false };
}

async function updatePlaceVerification(
  sql: Sql,
  placeId: string,
  input: PersistPlaceInput,
): Promise<void> {
  const lat = input.coordinates?.lat ?? input.googlePlace?.lat ?? null;
  const lng = input.coordinates?.lng ?? input.googlePlace?.lng ?? null;
  const coords = lat !== null && lng !== null ? { lat, lng } : null;
  const suspicious = !isWithinElSalvador(coords) || input.verifyResult.status === "rejected";

  await sql`
    UPDATE places
    SET
      location_text = COALESCE(${input.locationText}, location_text),
      lat = COALESCE(${lat}, lat),
      lng = COALESCE(${lng}, lng),
      category = COALESCE(${input.category}, category),
      google_place_id = COALESCE(${input.verifyResult.googlePlaceId}, google_place_id),
      verification_status = ${input.verifyResult.status},
      verification_score = ${input.verifyResult.score},
      department = COALESCE(${input.geocode?.department}, department),
      municipality = COALESCE(${input.geocode?.municipality}, municipality),
      suspicious_location = ${suspicious},
      updated_at = now()
    WHERE id = ${placeId}
  `;
}

async function insertMention(
  sql: Sql,
  placeId: string,
  input: PersistPlaceInput,
): Promise<boolean> {
  const mention = input.mention;
  const videoId =
    mention.source === "web" ? mention.videoId : mention.videoId;
  const sourceUrl = mention.source === "web" ? mention.sourceUrl : mention.sourceUrl ?? null;
  const evidence = mention.source === "web" ? mention.evidence : null;
  const likes = mention.source === "web" ? 0 : mention.likes;
  const comments = mention.source === "web" ? 0 : mention.comments;
  const shares = mention.source === "web" ? 0 : mention.shares;
  const bookmarks = mention.source === "web" ? 0 : mention.bookmarks;
  const transcript = mention.source === "web" ? "" : mention.transcript;

  const inserted = (await sql`
    INSERT INTO place_mentions (
      place_id, video_id, sentiment, sentiment_score,
      likes, comments, shares, bookmarks,
      summary, location_text, transcript,
      source, source_url, evidence
    )
    VALUES (
      ${placeId}, ${videoId}, ${mention.sentiment}, ${mention.sentimentScore},
      ${likes}, ${comments}, ${shares}, ${bookmarks},
      ${mention.summary}, ${mention.locationText}, ${transcript},
      ${mention.source}, ${sourceUrl}, ${evidence}
    )
    ON CONFLICT (place_id, source, video_id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  if (inserted.length === 0) {
    return false;
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

  return true;
}

export async function persistAndIndexPlace(
  sql: Sql,
  input: PersistPlaceInput,
): Promise<string | null> {
  const { placeId } = await resolvePlaceId(sql, input);
  await updatePlaceVerification(sql, placeId, input);

  const mentionInserted = await insertMention(sql, placeId, input);
  if (!mentionInserted && input.verifyResult.status === "rejected") {
    return null;
  }

  // Re-verify with updated source count after insert
  if (mentionInserted) {
    const sourceCount = await countDistinctSources(sql, placeId);
    if (sourceCount >= 2 && input.verifyResult.status !== "verified") {
      const boostedScore = Math.min(1, input.verifyResult.score + 0.2);
      const boostedStatus = boostedScore >= 0.6 ? "verified" : input.verifyResult.status;
      await sql`
        UPDATE places
        SET verification_status = ${boostedStatus}, verification_score = ${boostedScore}
        WHERE id = ${placeId}
      `;
    }
  }

  const place = await getPlaceWithMentions(sql, placeId);
  if (!place || place.verificationStatus === "rejected") {
    return null;
  }

  await upsertSearchDocSafe(buildSearchDoc(place));
  return placeId;
}

export function buildWebMention(
  sourceUrl: string,
  name: string,
  description: string,
  locationText: string,
  evidence: string,
): WebMentionInput {
  return {
    source: "web",
    sourceUrl,
    videoId: webVideoId(`${sourceUrl}:${name}`),
    sentiment: "neutral",
    sentimentScore: 0.5,
    summary: description,
    locationText,
    evidence,
  };
}

export async function indexPlaceIfNotRejected(
  sql: Sql,
  place: PlaceWithMentions,
): Promise<void> {
  if (place.verificationStatus === "rejected") {
    return;
  }
  await upsertSearchDocSafe(buildSearchDoc(place));
}
