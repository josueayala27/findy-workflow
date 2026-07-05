import { neon } from "@neondatabase/serverless";
import { getPlaceWithMentions, type Sql, type VerificationStatus } from "../db";
import { isDuplicateCandidate, type MatchablePlace } from "../place-matching";
import { buildSearchDoc, deleteSearchDocSafe, upsertSearchDocSafe } from "../search";

interface MergePlaceRow extends MatchablePlace {
  id: string;
  locationText: string | null;
  category: string | null;
  suspicious: boolean;
  verificationStatus: VerificationStatus;
  verificationScore: number | null;
  department: string | null;
  mentionCount: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalBookmarks: number;
}

interface MergePlan {
  canonical: MergePlaceRow;
  duplicates: MergePlaceRow[];
}

function parseArgs(): { apply: boolean } {
  return { apply: process.argv.includes("--apply") };
}

async function listPlaces(sql: Sql): Promise<MergePlaceRow[]> {
  const rows = (await sql`
    SELECT
      id,
      canonical_name,
      location_text,
      lat,
      lng,
      category,
      suspicious_location,
      verification_status,
      verification_score,
      department,
      municipality,
      google_place_id,
      mention_count,
      total_likes,
      total_comments,
      total_shares,
      total_bookmarks
    FROM places
    WHERE verification_status != 'rejected'
    ORDER BY mention_count DESC, updated_at DESC
  `) as Array<{
    id: string;
    canonical_name: string;
    location_text: string | null;
    lat: number | null;
    lng: number | null;
    category: string | null;
    suspicious_location: boolean;
    verification_status: VerificationStatus;
    verification_score: string | null;
    department: string | null;
    municipality: string | null;
    google_place_id: string | null;
    mention_count: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
    total_bookmarks: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
    locationText: row.location_text,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    suspicious: row.suspicious_location,
    verificationStatus: row.verification_status ?? "unverified",
    verificationScore: row.verification_score ? Number(row.verification_score) : null,
    department: row.department,
    municipality: row.municipality,
    googlePlaceId: row.google_place_id,
    mentionCount: row.mention_count,
    totalLikes: row.total_likes,
    totalComments: row.total_comments,
    totalShares: row.total_shares,
    totalBookmarks: row.total_bookmarks,
  }));
}

class UnionFind {
  private parents = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parents.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.parents.get(id);
    if (!parent || parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parents.set(rootB, rootA);
    }
  }
}

function chooseCanonical(group: MergePlaceRow[]): MergePlaceRow {
  return group
    .slice()
    .sort((a, b) => {
      if (a.googlePlaceId && !b.googlePlaceId) return -1;
      if (!a.googlePlaceId && b.googlePlaceId) return 1;
      const scoreDelta = (b.verificationScore ?? 0) - (a.verificationScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return b.mentionCount - a.mentionCount;
    })[0];
}

function buildPlans(rows: MergePlaceRow[]): MergePlan[] {
  const unionFind = new UnionFind(rows.map((row) => row.id));

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (isDuplicateCandidate(rows[i], rows[j])) {
        unionFind.union(rows[i].id, rows[j].id);
      }
    }
  }

  const groups = new Map<string, MergePlaceRow[]>();
  for (const row of rows) {
    const root = unionFind.find(row.id);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => {
      const canonical = chooseCanonical(group);
      return {
        canonical,
        duplicates: group.filter((row) => row.id !== canonical.id),
      };
    });
}

async function mergeDuplicate(sql: Sql, canonical: MergePlaceRow, duplicate: MergePlaceRow): Promise<void> {
  await sql`
    DELETE FROM place_mentions duplicate_mentions
    WHERE duplicate_mentions.place_id = ${duplicate.id}
      AND EXISTS (
        SELECT 1
        FROM place_mentions canonical_mentions
        WHERE canonical_mentions.place_id = ${canonical.id}
          AND canonical_mentions.source = duplicate_mentions.source
          AND canonical_mentions.video_id = duplicate_mentions.video_id
      )
  `;

  await sql`
    UPDATE place_mentions
    SET place_id = ${canonical.id}
    WHERE place_id = ${duplicate.id}
  `;

  await sql`
    UPDATE places
    SET
      location_text = COALESCE(location_text, ${duplicate.locationText}),
      lat = COALESCE(lat, ${duplicate.lat}),
      lng = COALESCE(lng, ${duplicate.lng}),
      category = COALESCE(category, ${duplicate.category}),
      google_place_id = COALESCE(google_place_id, ${duplicate.googlePlaceId ?? null}),
      verification_score = GREATEST(COALESCE(verification_score, 0), ${duplicate.verificationScore ?? 0}),
      department = COALESCE(department, ${duplicate.department}),
      municipality = COALESCE(municipality, ${duplicate.municipality}),
      suspicious_location = suspicious_location AND ${duplicate.suspicious},
      updated_at = now()
    WHERE id = ${canonical.id}
  `;

  const totals = (await sql`
    SELECT
      COUNT(*)::int AS mention_count,
      COALESCE(SUM(likes), 0)::int AS total_likes,
      COALESCE(SUM(comments), 0)::int AS total_comments,
      COALESCE(SUM(shares), 0)::int AS total_shares,
      COALESCE(SUM(bookmarks), 0)::int AS total_bookmarks
    FROM place_mentions
    WHERE place_id = ${canonical.id}
  `) as Array<{
    mention_count: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
    total_bookmarks: number;
  }>;

  const total = totals[0] ?? {
    mention_count: 0,
    total_likes: 0,
    total_comments: 0,
    total_shares: 0,
    total_bookmarks: 0,
  };

  await sql`
    UPDATE places
    SET
      mention_count = ${total.mention_count},
      total_likes = ${total.total_likes},
      total_comments = ${total.total_comments},
      total_shares = ${total.total_shares},
      total_bookmarks = ${total.total_bookmarks},
      updated_at = now()
    WHERE id = ${canonical.id}
  `;

  await sql`DELETE FROM places WHERE id = ${duplicate.id}`;

  await deleteSearchDocSafe(duplicate.id);
}

async function applyPlan(sql: Sql, plan: MergePlan): Promise<void> {
  for (const duplicate of plan.duplicates) {
    console.log(`Merging "${duplicate.canonicalName}" (${duplicate.id}) -> "${plan.canonical.canonicalName}" (${plan.canonical.id})`);
    await mergeDuplicate(sql, plan.canonical, duplicate);
  }

  const place = await getPlaceWithMentions(sql, plan.canonical.id);
  if (place && place.verificationStatus !== "rejected") {
    await upsertSearchDocSafe(buildSearchDoc(place));
  }
}

function printPlans(plans: MergePlan[]): void {
  if (plans.length === 0) {
    console.log("No duplicate place candidates found.");
    return;
  }

  for (const [index, plan] of plans.entries()) {
    console.log(`\nGroup ${index + 1}`);
    console.log(`  canonical: ${plan.canonical.canonicalName} (${plan.canonical.id})`);
    for (const duplicate of plan.duplicates) {
      console.log(`  duplicate: ${duplicate.canonicalName} (${duplicate.id})`);
    }
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const { apply } = parseArgs();
  const sql = neon(databaseUrl);
  const rows = await listPlaces(sql);
  const plans = buildPlans(rows);

  printPlans(plans);

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to merge these places.");
    return;
  }

  for (const plan of plans) {
    await applyPlan(sql, plan);
  }

  console.log(`\nMerged ${plans.reduce((sum, plan) => sum + plan.duplicates.length, 0)} duplicate place rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
