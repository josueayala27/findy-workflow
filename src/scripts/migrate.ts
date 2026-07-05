import { neon } from "@neondatabase/serverless";

const STATEMENTS = [
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS suspicious_location boolean DEFAULT false NOT NULL`,
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text`,
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified' NOT NULL`,
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS verification_score numeric`,
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS department text`,
  `ALTER TABLE places ADD COLUMN IF NOT EXISTS municipality text`,
  `ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS source text DEFAULT 'tiktok' NOT NULL`,
  `ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS source_url text`,
  `ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS evidence text`,
  `ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS transcript text`,
  `DROP INDEX IF EXISTS place_mentions_video_id_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS place_mentions_place_source_video_key ON place_mentions (place_id, source, video_id)`,
  `CREATE TABLE IF NOT EXISTS web_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url text NOT NULL UNIQUE,
    domain text NOT NULL,
    category text,
    status text DEFAULT 'pending' NOT NULL,
    scraped_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS web_sources_status_idx ON web_sources (status)`,
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sql = neon(databaseUrl);

  for (const statement of STATEMENTS) {
    console.log(`Running: ${statement.slice(0, 70)}...`);
    await sql.query(statement);
  }

  console.log("Migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
