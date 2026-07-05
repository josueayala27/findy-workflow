import type { Coordinates } from "./types";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export interface GooglePlaceResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
  formattedAddress: string;
}

interface PlacesApiResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    types?: string[];
  }>;
}

export async function findPlaceByText(
  name: string,
  location: string,
  apiKey: string,
): Promise<GooglePlaceResult | null> {
  const response = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery: `${name} ${location} El Salvador`,
      regionCode: "SV",
      languageCode: "es",
      maxResultCount: 1,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Places search failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as PlacesApiResponse;
  const place = data.places?.[0];
  if (!place?.id || !place.location?.latitude || !place.location?.longitude) {
    return null;
  }

  return {
    placeId: place.id.replace(/^places\//, ""),
    name: place.displayName?.text ?? name,
    lat: place.location.latitude,
    lng: place.location.longitude,
    types: place.types ?? [],
    formattedAddress: place.formattedAddress ?? location,
  };
}

export function googlePlaceCoordinates(place: GooglePlaceResult): Coordinates {
  return { lat: place.lat, lng: place.lng };
}
