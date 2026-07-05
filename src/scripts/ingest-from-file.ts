import { readFileSync } from "node:fs";
import { getSqlClient } from "../db";
import { processApifyItem } from "../ingest";
import type { Category, RawApifyItem } from "../types";

function parseArgs(): { file: string; category: Category } {
  const [file, category] = process.argv.slice(2);
  if (!file || !category) {
    console.error("Usage: node --env-file=.env src/scripts/ingest-from-file.ts <path-to-json> <category>");
    process.exit(1);
  }
  return { file, category: category as Category };
}

async function main() {
  const { file, category } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const raw = JSON.parse(readFileSync(file, "utf8"));
  const items: RawApifyItem[] = Array.isArray(raw) ? raw : raw.items;

  const sql = getSqlClient(databaseUrl);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.id || !item.video?.url) {
      skipped++;
      continue;
    }

    try {
      await processApifyItem(sql, item, { category, apiKey });
      processed++;
      console.log(`[${processed + skipped + failed}/${items.length}] ok: ${item.id}`);
    } catch (error) {
      failed++;
      console.error(`[${processed + skipped + failed}/${items.length}] failed: ${item.id}`, error);
    }
  }

  console.log(`Done. processed=${processed} skipped=${skipped} failed=${failed}`);
}

main();
