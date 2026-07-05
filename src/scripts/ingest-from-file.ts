import { readFileSync } from "node:fs";
import { getSqlClient } from "../db";
import { processApifyItem } from "../ingest";
import { analyzeVideoWithOpenAI } from "../openai";
import type { Category, RawApifyItem } from "../types";

function parseArgs(): { file: string; category: Category; provider: "gemini" | "openai" } {
  const args = process.argv.slice(2);
  const providerFlagIndex = args.indexOf("--provider");
  const provider = providerFlagIndex >= 0 ? (args[providerFlagIndex + 1] as "gemini" | "openai") : "gemini";
  const positional = args.filter((_, i) => i !== providerFlagIndex && i !== providerFlagIndex + 1);
  const [file, category] = positional;

  if (!file || !category || (provider !== "gemini" && provider !== "openai")) {
    console.error(
      "Usage: node --env-file=.env node_modules/tsx/dist/cli.mjs src/scripts/ingest-from-file.ts <path-to-json> <category> [--provider gemini|openai]",
    );
    process.exit(1);
  }
  return { file, category: category as Category, provider };
}

async function main() {
  const { file, category, provider } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const openRouterModel = process.env.OPENROUTER_MODEL;
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  if (provider === "gemini" && !geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (provider === "openai" && !openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");

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
      await processApifyItem(sql, item, {
        category,
        geminiApiKey: geminiApiKey ?? "",
        openRouterApiKey,
        openRouterModel,
        googleApiKey,
        analyzeVideo:
          provider === "openai"
            ? (videoItem) => analyzeVideoWithOpenAI(videoItem, { apiKey: openaiApiKey! })
            : undefined,
      });
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
