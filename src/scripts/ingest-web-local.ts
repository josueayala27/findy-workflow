import {
  countDistinctSources,
  findPlaceByCanonicalName,
  findPlaceByGoogleId,
  getProcessedWebUrls,
  getSqlClient,
  markWebSourceStatus,
  registerWebSource,
} from "../db";
import { discoverUrls, extractDomain } from "../exa";
import { extractPlaces } from "../firecrawl";
import { resolveCoordinates } from "../geocode";
import { findPlaceByText } from "../google-places";
import { buildWebMention, persistAndIndexPlace } from "../persist";
import type { Category } from "../types";
import { verifyPlace } from "../verify";

function parseArgs(): { query: string; category: Category; maxUrls: number } {
  const args = process.argv.slice(2);
  const maxUrlsFlagIndex = args.indexOf("--max-urls");
  const maxUrls =
    maxUrlsFlagIndex >= 0 ? Number.parseInt(args[maxUrlsFlagIndex + 1] ?? "3", 10) : 3;
  const positional = args.filter((_, i) => i !== maxUrlsFlagIndex && i !== maxUrlsFlagIndex + 1);
  const category = positional.at(-1);
  const query = positional.slice(0, -1).join(" ");

  if (!query || !category) {
    console.error(
      "Usage: node --env-file=.env node_modules/tsx/dist/cli.mjs src/scripts/ingest-web-local.ts <query> <category> [--max-urls 3]",
    );
    process.exit(1);
  }

  return { query, category: category as Category, maxUrls };
}

async function main() {
  const { query, category, maxUrls } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  const exaKey = process.env.EXA_API_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!exaKey) throw new Error("EXA_API_KEY is not configured");
  if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY is not configured");

  const sql = getSqlClient(databaseUrl);

  console.log(`Discovering URLs for "${query}" (${category}), maxUrls=${maxUrls}...`);
  const excludeUrls = await getProcessedWebUrls(sql);
  const urls = await discoverUrls({ query, category, maxUrls }, { apiKey: exaKey, excludeUrls });
  console.log(`Found ${urls.length} URLs`);

  for (const result of urls) {
    await registerWebSource(sql, result.url, extractDomain(result.url), category);
  }

  let placesProcessed = 0;

  for (const urlResult of urls) {
    console.log(`Extracting places from ${urlResult.url}...`);
    const extracted = await extractPlaces(urlResult.url, { apiKey: firecrawlKey });
    console.log(`  → ${extracted.length} places found`);

    for (const webPlace of extracted) {
      const locationText = webPlace.locationText;
      const geocode = await resolveCoordinates({
        name: webPlace.name,
        locationText,
        googleApiKey,
      });

      const googlePlace = googleApiKey
        ? await findPlaceByText(webPlace.name, locationText, googleApiKey)
        : null;

      const existingByGoogle = googlePlace ? await findPlaceByGoogleId(sql, googlePlace.placeId) : null;
      const existingByName = existingByGoogle ? null : await findPlaceByCanonicalName(sql, webPlace.name);
      const existingPlaceId = existingByGoogle?.id ?? existingByName?.id;
      const existingSourceCount = existingPlaceId ? await countDistinctSources(sql, existingPlaceId) : 0;

      const verifyResult = verifyPlace({
        name: webPlace.name,
        locationText,
        category: webPlace.category || category,
        coordinates: geocode?.coordinates ?? null,
        googlePlace,
        existingSourceCount,
        incomingSource: "web",
      });

      const placeId = await persistAndIndexPlace(sql, {
        canonicalName: webPlace.name,
        locationText,
        category: webPlace.category || category,
        coordinates: geocode?.coordinates ?? null,
        geocode: geocode
          ? {
              ...geocode,
              department: geocode.department ?? webPlace.department,
              municipality: geocode.municipality ?? webPlace.municipality,
            }
          : null,
        googlePlace,
        verifyResult,
        mention: buildWebMention(
          urlResult.url,
          webPlace.name,
          webPlace.description,
          locationText,
          webPlace.evidence,
        ),
      });

      if (placeId) {
        placesProcessed++;
        console.log(`  ✓ ${webPlace.name} (${verifyResult.status})`);
      } else {
        console.log(`  ✗ ${webPlace.name} (rejected or duplicate)`);
      }
    }

    await markWebSourceStatus(sql, urlResult.url, "processed");
  }

  console.log(`Done. urls=${urls.length} placesProcessed=${placesProcessed}`);
}

main();
