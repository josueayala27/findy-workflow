const FIRECRAWL_EXTRACT_URL = "https://api.firecrawl.dev/v2/extract";

export interface WebExtractedPlace {
  name: string;
  locationText: string;
  municipality: string | null;
  department: string | null;
  category: string;
  description: string;
  evidence: string;
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          locationText: { type: "string" },
          municipality: { type: "string" },
          department: { type: "string" },
          category: { type: "string" },
          description: { type: "string" },
          evidence: {
            type: "string",
            description: "Exact quote from the article mentioning this place and its location",
          },
        },
        required: ["name", "locationText", "category", "description", "evidence"],
      },
    },
  },
  required: ["places"],
};

export interface ExtractPlacesOptions {
  apiKey: string;
}

export async function extractPlaces(
  url: string,
  options: ExtractPlacesOptions,
): Promise<WebExtractedPlace[]> {
  const response = await fetch(FIRECRAWL_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      urls: [url],
      prompt:
        "Extract all real-world places in El Salvador mentioned in this page. " +
        "For each place include the exact evidence quote that mentions its location. " +
        "Do not invent places not mentioned in the text.",
      schema: EXTRACT_SCHEMA,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Firecrawl extract failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    success?: boolean;
    data?: { places?: WebExtractedPlace[] };
    places?: WebExtractedPlace[];
  };

  const places = data.data?.places ?? data.places ?? [];
  return places.filter((p) => p.name && p.evidence);
}
