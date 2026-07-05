import type { Coordinates } from "./types";

export type { Coordinates };

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const EL_SALVADOR_BOUNDS = {
  minLat: 12.9,
  maxLat: 14.5,
  minLng: -90.2,
  maxLng: -87.6,
};

export interface GeocodeResult {
  coordinates: Coordinates;
  department: string | null;
  municipality: string | null;
  source: "nominatim" | "google";
}

interface NominatimResult {
  lat: string;
  lon: string;
  address?: {
    state?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
}

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

/** Haversine distance in km between two coordinate pairs. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parseNominatimAddress(address?: NominatimResult["address"]): {
  department: string | null;
  municipality: string | null;
} {
  if (!address) {
    return { department: null, municipality: null };
  }
  const department = address.state ?? null;
  const municipality =
    address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? null;
  return { department, municipality };
}

function parseGoogleAddress(components?: Array<{ long_name: string; types: string[] }>): {
  department: string | null;
  municipality: string | null;
} {
  if (!components) {
    return { department: null, municipality: null };
  }
  const find = (...types: string[]) =>
    components.find((c) => types.some((t) => c.types.includes(t)))?.long_name ?? null;

  return {
    department: find("administrative_area_level_1"),
    municipality: find("locality", "administrative_area_level_2", "sublocality"),
  };
}

export async function geocodeLocation(location: string): Promise<Coordinates | null> {
  const result = await geocodeLocationDetailed(location);
  return result?.coordinates ?? null;
}

export async function geocodeLocationDetailed(location: string): Promise<GeocodeResult | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "sv");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: { "User-Agent": "findy-workflow/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Nominatim geocoding failed for "${location}": ${response.status}`);
  }

  const results = (await response.json()) as NominatimResult[];
  const match = results.find((r) =>
    isWithinElSalvador({ lat: Number(r.lat), lng: Number(r.lon) }),
  );
  if (!match) {
    return null;
  }

  const { department, municipality } = parseNominatimAddress(match.address);
  return {
    coordinates: { lat: Number(match.lat), lng: Number(match.lon) },
    department,
    municipality,
    source: "nominatim",
  };
}

export async function geocodeWithGoogle(
  query: string,
  apiKey: string,
): Promise<GeocodeResult | null> {
  const url = new URL(GOOGLE_GEOCODE_URL);
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:SV");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google geocoding failed for "${query}": ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      address_components: Array<{ long_name: string; types: string[] }>;
    }>;
  };

  if (data.status !== "OK" || data.results.length === 0) {
    return null;
  }

  const [first] = data.results;
  const coordinates = {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
  };
  if (!isWithinElSalvador(coordinates)) {
    return null;
  }

  const { department, municipality } = parseGoogleAddress(first.address_components);
  return { coordinates, department, municipality, source: "google" };
}

export interface ResolveCoordinatesInput {
  name: string;
  locationText?: string;
  googleApiKey?: string;
}

/** Tries Nominatim first, then Google Geocoding as fallback. */
export async function resolveCoordinates(
  input: ResolveCoordinatesInput,
): Promise<GeocodeResult | null> {
  const query = input.locationText
    ? `${input.name}, ${input.locationText}, El Salvador`
    : `${input.name}, El Salvador`;

  const nominatim = await geocodeLocationDetailed(query);
  if (nominatim) {
    return nominatim;
  }

  if (!input.googleApiKey) {
    return null;
  }

  return geocodeWithGoogle(query, input.googleApiKey);
}
