export interface MatchablePlace {
  id?: string;
  canonicalName: string;
  lat: number | null;
  lng: number | null;
  municipality: string | null;
  googlePlaceId?: string | null;
}

export interface CoordinatesLike {
  lat: number;
  lng: number;
}

const NEARBY_DEGREES = 0.005;

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeBaseName(name: string): string {
  return normalizeText(name.split(",")[0]);
}

function locationSuffix(name: string): string | null {
  const suffix = name.split(",").slice(1).join(",");
  const normalized = normalizeText(suffix);
  return normalized || null;
}

export function namesMatch(a: string, b: string): boolean {
  const left = normalizeBaseName(a);
  const right = normalizeBaseName(b);

  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 4 && longer.startsWith(`${shorter} `);
}

export function coordsNearby(
  a: CoordinatesLike | null,
  b: CoordinatesLike | null,
  maxDegrees = NEARBY_DEGREES,
): boolean {
  if (!a || !b) {
    return false;
  }

  return Math.abs(a.lat - b.lat) < maxDegrees && Math.abs(a.lng - b.lng) < maxDegrees;
}

export function sameMunicipality(a: string | null, b: string | null): boolean {
  return Boolean(a && b && normalizeBaseName(a) === normalizeBaseName(b));
}

export function isDuplicateCandidate(a: MatchablePlace, b: MatchablePlace): boolean {
  if (a.googlePlaceId && b.googlePlaceId && a.googlePlaceId === b.googlePlaceId) {
    return true;
  }

  if (!namesMatch(a.canonicalName, b.canonicalName)) {
    return false;
  }

  const aSuffix = locationSuffix(a.canonicalName);
  const bSuffix = locationSuffix(b.canonicalName);
  if (aSuffix && bSuffix && aSuffix !== bSuffix) {
    return false;
  }

  const aCoords = a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null;
  const bCoords = b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;

  if (aCoords && bCoords) {
    return coordsNearby(aCoords, bCoords);
  }

  return sameMunicipality(a.municipality, b.municipality);
}
