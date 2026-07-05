-- Migration for findy-workflow multi-source pipeline
-- Run once against Neon: psql $DATABASE_URL -f scripts/migrate.sql

-- Places: verification + geo enrichment
ALTER TABLE places ADD COLUMN IF NOT EXISTS suspicious_location boolean DEFAULT false NOT NULL;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified' NOT NULL;
ALTER TABLE places ADD COLUMN IF NOT EXISTS verification_score numeric;
ALTER TABLE places ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS municipality text;

-- Place mentions: multi-source support
ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS source text DEFAULT 'tiktok' NOT NULL;
ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS evidence text;
ALTER TABLE place_mentions ADD COLUMN IF NOT EXISTS transcript text;

-- Drop old unique constraint on video_id alone (if exists) and add composite
DROP INDEX IF EXISTS place_mentions_video_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS place_mentions_place_source_video_key
  ON place_mentions (place_id, source, video_id);

-- Web sources tracking
CREATE TABLE IF NOT EXISTS web_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL UNIQUE,
  domain text NOT NULL,
  category text,
  status text DEFAULT 'pending' NOT NULL,
  scraped_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS web_sources_status_idx ON web_sources (status);
