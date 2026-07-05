import { neon } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  const sql = neon(databaseUrl);

  const places = await sql`SELECT COUNT(*)::int AS count FROM places`;
  console.log("places:", places[0]?.count ?? 0);

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'places'
    ORDER BY column_name
  `;
  console.log("places columns:", cols.map((c: { column_name: string }) => c.column_name).join(", "));

  const webSources = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'web_sources'
    ) AS exists
  `;
  console.log("web_sources table:", webSources[0]?.exists ? "yes" : "no");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
