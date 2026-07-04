import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash";

export const EL_SALVADOR_DEPARTMENTS = [
  "Ahuachapán",
  "Santa Ana",
  "Sonsonate",
  "Chalatenango",
  "La Libertad",
  "San Salvador",
  "Cuscatlán",
  "La Paz",
  "Cabañas",
  "San Vicente",
  "Usulután",
  "San Miguel",
  "Morazán",
  "La Unión",
] as const;

const GENERIC_WORDS = [
  "beach",
  "beaches",
  "city",
  "cities",
  "coast",
  "coastline",
  "coastal",
  "various",
  "several",
  "compilation",
  "playa",
  "playas",
  "ciudad",
  "ciudades",
  "costa",
  "unknown",
  "desconocido",
  "desconocida",
];

export interface ResolveLocationOptions {
  apiKey: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function hasDepartment(location: string): boolean {
  const normalized = normalize(location);
  return EL_SALVADOR_DEPARTMENTS.some((department) => normalized.includes(normalize(department)));
}

/**
 * A location is "generic" if, once the country name and filler words are stripped,
 * nothing place-specific is left (e.g. "El Salvador", "Beaches in El Salvador").
 */
export function isGenericLocation(location: string): boolean {
  const normalized = normalize(location);
  if (!normalized.includes("el salvador")) {
    return false;
  }

  let stripped = normalized.replace("el salvador", "");
  for (const word of GENERIC_WORDS) {
    stripped = stripped.replace(new RegExp(`\\b${word}\\b`, "g"), "");
  }
  stripped = stripped.replace(/[^a-z0-9áéíóúñ]/g, "").trim();

  return stripped.length < 3;
}

async function resolveDepartment(
  placeName: string,
  options: ResolveLocationOptions,
): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const prompt = [
    `"${placeName}" is a place in El Salvador.`,
    `Which of these 14 departments is it located in: ${EL_SALVADOR_DEPARTMENTS.join(", ")}?`,
    "Respond with only the department name exactly as written in that list, and nothing else.",
    "If you are not confident or the place is not in El Salvador, respond with exactly: unknown",
  ].join(" ");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) {
    return null;
  }

  const normalized = normalize(text);
  return EL_SALVADOR_DEPARTMENTS.find((department) => normalize(department) === normalized) ?? null;
}

/**
 * Turns a raw Gemini-extracted location into the "Place, Department" convention,
 * or returns null when the location isn't specific enough to be worth keeping.
 */
export async function resolveLocation(
  location: string,
  options: ResolveLocationOptions,
): Promise<string | null> {
  const trimmed = location.trim();
  if (!trimmed || isGenericLocation(trimmed)) {
    return null;
  }

  if (hasDepartment(trimmed)) {
    return trimmed;
  }

  const department = await resolveDepartment(trimmed, options);
  if (!department) {
    return null;
  }

  return `${trimmed}, ${department}`;
}
