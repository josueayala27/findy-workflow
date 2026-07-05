import type { Coordinates } from "./types";

export type { Coordinates };

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Padded rectangle around El Salvador's borders; a coarse "worth a human look"
// check, not a precise geofence.
const EL_SALVADOR_BOUNDS = {
  minLat: 12.9,
  maxLat: 14.5,
  minLng: -90.2,
  maxLng: -87.6,
};

export function isWithinElSalvador(coordinates: Coordinates | null): boolean {
  if (!coordinates) {
    return false;
  }
  const { lat, lng } = coordinates;
  return (
    lat >= EL_SALVADOR_BOUNDS.minLat &&
    lat <= EL_SALVADOR_BOUNDS.maxLat &&
    lng >= EL_SALVADOR_BOUNDS.minLng &&
    lng <= EL_SALVADOR_BOUNDS.maxLng
  );
}

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
