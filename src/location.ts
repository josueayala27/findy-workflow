import { GoogleGenAI, Type } from "@google/genai/web";

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

const DEPARTMENT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "The input place name, exactly as given.",
      },
      department: {
        type: Type.STRING,
        description:
          "The department name exactly as written in the given list, or exactly 'unknown' if not confident or not in El Salvador.",
      },
    },
    required: ["name", "department"],
  },
};

async function resolveDepartments(
  placeNames: string[],
  options: ResolveLocationOptions,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (placeNames.length === 0) {
    return map;
  }

  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const prompt = [
    "These are places in El Salvador:",
    JSON.stringify(placeNames),
    `For each one (in the same order), decide which of these 14 departments it is located in: ${EL_SALVADOR_DEPARTMENTS.join(", ")}.`,
    "Respond with a JSON array, one entry per input place, using its exact name and the matching department.",
    "If you are not confident about a place or it is not in El Salvador, use exactly: unknown",
  ].join(" ");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: DEPARTMENT_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    return map;
  }

  const parsed = JSON.parse(text) as Array<{ name: string; department: string }>;
  for (const entry of parsed) {
    const normalized = normalize(entry.department);
    const department =
      EL_SALVADOR_DEPARTMENTS.find((candidate) => normalize(candidate) === normalized) ?? null;
    map.set(entry.name, department);
  }
  return map;
}

/**
 * Turns raw Gemini-extracted locations into the "Place, Department" convention,
 * returning null (per position) for locations that aren't specific enough to keep.
 */
export async function resolveLocations(
  locations: string[],
  options: ResolveLocationOptions,
): Promise<Array<string | null>> {
  const trimmed = locations.map((location) => location.trim());

  const needsDepartment = trimmed.filter(
    (location) => location && !isGenericLocation(location) && !hasDepartment(location),
  );
  const departments = await resolveDepartments(needsDepartment, options);

  return trimmed.map((location) => {
    if (!location || isGenericLocation(location)) {
      return null;
    }
    if (hasDepartment(location)) {
      return location;
    }
    const department = departments.get(location);
    return department ? `${location}, ${department}` : null;
  });
}
