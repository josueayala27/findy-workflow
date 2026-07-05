import {
  GoogleGenAI,
  Type,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import { SENTIMENTS, type RawApifyItem, type Sentiment, type VideoAnalysis } from "./types";

const MODEL = "gemini-2.5-flash";
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_TIMEOUT_MS = 120_000;
const MAX_LOCATIONS = 5;

export interface AnalyzeVideoOptions {
  apiKey: string;
}

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sentiment: {
      type: Type.STRING,
      enum: SENTIMENTS as unknown as string[],
      description: "The overall feeling conveyed by the video. Must be one of the enum values.",
    },
    sentimentScore: {
      type: Type.NUMBER,
      description: "Sentiment score from -1 (very negative) to 1 (very positive).",
    },
    transcription: {
      type: Type.STRING,
      description:
        "Full transcription of the spoken audio in the video, in its original language (likely Spanish). Empty string if there is no speech.",
    },
    locations: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description:
        "The specific, named places shown or mentioned in the video (e.g. beach, restaurant, town, or landmark names), such as 'Playa Los Cóbanos' or 'Playa El Tunco'. " +
        "Read both the spoken audio and any on-screen text overlays for this — many videos have no speech but show place names as text on screen. " +
        "A video may mention several distinct places (e.g. a compilation of beaches); list each one separately instead of joining them into one string. " +
        `Return at most the ${MAX_LOCATIONS} most clearly identified, prominent places, ordered by prominence. ` +
        "Never include just 'El Salvador' or a generic description like 'a beach in El Salvador' or 'various beaches' — those are not specific places. " +
        "Empty array if no specific named place can be identified from either audio or on-screen text.",
    },
    summary: {
      type: Type.STRING,
      description: "One or two sentence summary of what the video is about.",
    },
  },
  required: ["sentiment", "sentimentScore", "transcription", "locations", "summary"],
};

async function waitForFileActive(ai: GoogleGenAI, name: string) {
  const start = Date.now();
  let file = await ai.files.get({ name });
  while (file.state === "PROCESSING") {
    if (Date.now() - start > FILE_POLL_TIMEOUT_MS) {
      throw new Error(`Gemini file ${name} did not become active in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, FILE_POLL_INTERVAL_MS));
    file = await ai.files.get({ name });
  }
  if (file.state !== "ACTIVE") {
    throw new Error(`Gemini file ${name} failed to process (state: ${file.state})`);
  }
  return file;
}

export async function analyzeVideo(
  item: RawApifyItem,
  options: AnalyzeVideoOptions,
): Promise<VideoAnalysis> {
  const videoUrl = item.video?.url;
  if (!item.id || !videoUrl) {
    throw new Error("Video item is missing an id or video url");
  }

  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video ${item.id}: ${videoResponse.status}`);
  }
  const videoBlob = await videoResponse.blob();

  const uploaded = await ai.files.upload({
    file: videoBlob,
    config: { mimeType: "video/mp4" },
  });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error(`Gemini upload for video ${item.id} did not return a file reference`);
  }

  const file = await waitForFileActive(ai, uploaded.name);

  const prompt = [
    "Analyze this TikTok video about El Salvador.",
    "The spoken audio is likely in Spanish.",
    "Return only the requested structured fields based on what you see and hear in the video.",
  ].join(" ");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([
      createPartFromUri(file.uri!, file.mimeType ?? "video/mp4"),
      prompt,
    ]),
    config: {
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned no output for video ${item.id}`);
  }

  const parsed = JSON.parse(text) as {
    sentiment: string;
    sentimentScore: number;
    transcription: string;
    locations: string[];
    summary: string;
  };

  return {
    videoId: item.id,
    sentiment: normalizeSentiment(parsed.sentiment),
    sentimentScore: parsed.sentimentScore,
    transcription: parsed.transcription,
    summary: parsed.summary,
    locations: parsed.locations
      .filter((name) => name.trim().length > 0)
      .slice(0, MAX_LOCATIONS)
      .map((name) => ({ name, coordinates: null })),
  };
}

function normalizeSentiment(value: string): Sentiment {
  const normalized = value.trim().toLowerCase();
  return (SENTIMENTS as readonly string[]).includes(normalized)
    ? (normalized as Sentiment)
    : "neutral";
}
