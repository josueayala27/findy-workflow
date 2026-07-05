import { distanceKm, isWithinElSalvador } from "./geocode";
import type { GooglePlaceResult } from "./google-places";
import type { Coordinates } from "./types";

export type VerificationStatus = "verified" | "unverified" | "rejected";

export interface VerifyInput {
  name: string;
  locationText: string;
  category: string;
  coordinates: Coordinates | null;
  googlePlace: GooglePlaceResult | null;
  /** Distinct source types already linked to this place in DB (before current insert). */
  existingSourceCount: number;
  /** Source type being added in this operation. */
  incomingSource: "tiktok" | "instagram" | "web";
}

export interface VerifyResult {
  status: VerificationStatus;
  score: number;
  googlePlaceId: string | null;
}

const CATEGORY_TYPE_MAP: Record<string, string[]> = {
  Restaurants: ["restaurant", "food", "cafe", "bakery", "meal_takeaway", "bar"],
  Beach: ["natural_feature", "tourist_attraction", "park", "point_of_interest"],
  Tourist: ["tourist_attraction", "museum", "park", "point_of_interest", "landmark"],
  Shopping: ["shopping_mall", "store", "clothing_store", "market", "department_store"],
  Nightlife: ["bar", "night_club", "restaurant", "liquor_store"],
  ActiveLife: ["gym", "park", "stadium", "sports_club", "hiking_area", "tourist_attraction"],
};

function scoreGooglePlaceId(googlePlace: GooglePlaceResult | null): number {
  return googlePlace?.placeId ? 0.4 : 0;
}

function scoreCoordinates(
  coordinates: Coordinates | null,
  googlePlace: GooglePlaceResult | null,
): number {
  if (!coordinates || !isWithinElSalvador(coordinates)) {
    return 0;
  }
  if (!googlePlace) {
    return 0.15;
  }
  const googleCoords = { lat: googlePlace.lat, lng: googlePlace.lng };
  if (!isWithinElSalvador(googleCoords)) {
    return 0;
  }
  const km = distanceKm(coordinates, googleCoords);
  if (km <= 5) {
    return 0.25;
  }
  if (km <= 15) {
    return 0.1;
  }
  return 0;
}

function scoreCategoryTypes(category: string, googlePlace: GooglePlaceResult | null): number {
  if (!googlePlace?.types.length) {
    return 0;
  }
  const expected = CATEGORY_TYPE_MAP[category] ?? ["point_of_interest", "establishment"];
  const normalized = googlePlace.types.map((t) => t.toLowerCase());
  const match = expected.some((t) => normalized.includes(t));
  return match ? 0.15 : 0;
}

function scoreMultiSource(existingSourceCount: number, incomingSource: string): number {
  // After insert there will be at least one source; 2+ distinct sources → full weight.
  const projected = existingSourceCount + 1;
  if (projected >= 2) {
    return 0.2;
  }
  // Single source from web with evidence still gets partial credit.
  if (incomingSource === "web" && existingSourceCount === 0) {
    return 0.05;
  }
  return 0;
}

function statusFromScore(score: number): VerificationStatus {
  if (score >= 0.6) {
    return "verified";
  }
  if (score >= 0.3) {
    return "unverified";
  }
  return "rejected";
}

export function verifyPlace(input: VerifyInput): VerifyResult {
  const score =
    scoreGooglePlaceId(input.googlePlace) +
    scoreCoordinates(input.coordinates, input.googlePlace) +
    scoreCategoryTypes(input.category, input.googlePlace) +
    scoreMultiSource(input.existingSourceCount, input.incomingSource);

  return {
    status: statusFromScore(score),
    score: Math.round(score * 1000) / 1000,
    googlePlaceId: input.googlePlace?.placeId ?? null,
  };
}
