import {
  GoogleGenAI,
  Type,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import type { RawApifyItem, VideoAnalysis } from "./types";

const MODEL = "gemini-2.5-flash";
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_TIMEOUT_MS = 120_000;

export interface AnalyzeVideoOptions {
  apiKey: string;
}

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sentiment: {
      type: Type.STRING,
      description:
        "One-word overall feeling conveyed by the video, e.g. 'happy', 'excited', 'relaxing', 'nostalgic'.",
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
    location: {
      type: Type.STRING,
      nullable: true,
      description:
        "The specific place/location mentioned or shown in the video (e.g. a restaurant, beach, city). Null if none is identifiable.",
    },
    summary: {
      type: Type.STRING,
      description: "One or two sentence summary of what the video is about.",
    },
  },
  required: ["sentiment", "sentimentScore", "transcription", "location", "summary"],
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

  const parsed = JSON.parse(text) as Omit<VideoAnalysis, "videoId">;

  return { videoId: item.id, ...parsed };
}
