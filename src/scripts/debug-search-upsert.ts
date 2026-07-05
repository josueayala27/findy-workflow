import { neon } from "@neondatabase/serverless";
import { getPlaceWithMentions } from "../db";
import { buildSearchDoc } from "../search";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT p.id, p.canonical_name
    FROM places p
    JOIN place_mentions m ON m.place_id = p.id
    WHERE m.source = 'web'
    ORDER BY m.created_at DESC
    LIMIT 10
  `) as Array<{ id: string; canonical_name: string }>;

  for (const row of rows) {
    const place = await getPlaceWithMentions(sql, row.id);
    if (!place) continue;
    const doc = buildSearchDoc(place);
    const body = JSON.stringify({ index: "places", ...doc });
    const res = await fetch("https://search.findy.place/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    const summaryChars = place.summaries.join("").length;
    const transcriptChars = place.transcripts.join("").length;
    console.log(
      `${row.canonical_name} -> ${res.status} size=${body.length} summaries=${place.summaries.length}/${summaryChars} transcripts=${place.transcripts.length}/${transcriptChars}`,
    );
    if (!res.ok) console.log("  ", text.slice(0, 200));
  }
}

main();
