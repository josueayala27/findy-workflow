import type { Coordinates } from "./types";

export type { Coordinates };

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export async function geocodeLocation(location: string): Promise<Coordinates | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "findy-workflow/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim geocoding failed for "${location}": ${response.status}`);
  }

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  const [first] = results;
  if (!first) {
    return null;
  }

  return { lat: Number(first.lat), lng: Number(first.lon) };
}
