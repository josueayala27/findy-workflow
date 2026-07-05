import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import OpenAI, { toFile } from "openai";
import { normalizeSentiment } from "./gemini";
import { SENTIMENTS, type RawApifyItem, type VideoAnalysis } from "./types";

/**
 * Fallback video analyzer for when the Gemini path (src/gemini.ts) is unavailable
 * (e.g. Files API quota exhausted). Unlike Gemini, OpenAI has no single "watch this
 * video" call, so this stitches together: Whisper transcription of the raw file,
 * ffmpeg-sampled frames for on-screen text/visual context, and a GPT-4o vision call
 * for sentiment/locations/summary.
 *
 * Requires a local `ffmpeg` binary and Node's fs/child_process — only safe to use
 * from the local ingestion script, not from the Cloudflare Worker (server.ts).
 */

const execFileAsync = promisify(execFile);

const TRANSCRIPTION_MODEL = "whisper-1";
const CHAT_MODEL = "gpt-4o-mini";
const FRAME_COUNT = 4;
const MAX_LOCATIONS = 5;
const DEFAULT_DURATION_SECONDS = 30;

export interface AnalyzeVideoWithOpenAIOptions {
  apiKey: string;
}

const ANALYSIS_JSON_SCHEMA = {
  name: "video_analysis",
  schema: {
    type: "object",
    properties: {
      sentiment: {
        type: "string",
        enum: SENTIMENTS as unknown as string[],
        description: "The overall feeling conveyed by the video.",
      },
      sentimentScore: {
        type: "number",
        description: "Sentiment score from -1 (very negative) to 1 (very positive).",
      },
      locations: {
        type: "array",
        items: { type: "string" },
        description:
          "The specific, named places shown or mentioned in the video (e.g. beach, restaurant, town, or landmark names). " +
          "Read both the transcript and any on-screen text visible in the frames. " +
          `Return at most the ${MAX_LOCATIONS} most clearly identified, prominent places. ` +
          "Never include just 'El Salvador' or a generic description. Empty array if none can be identified.",
      },
      summary: {
        type: "string",
        description: "One or two sentence summary of what the video is about, written in Spanish.",
      },
    },
    required: ["sentiment", "sentimentScore", "locations", "summary"],
    additionalProperties: false,
  },
  strict: true,
};

async function transcribeVideo(client: OpenAI, videoBuffer: Buffer): Promise<string> {
  const file = await toFile(videoBuffer, "video.mp4", { type: "video/mp4" });
  const transcription = await client.audio.transcriptions.create({
    file,
    model: TRANSCRIPTION_MODEL,
  });
  return transcription.text ?? "";
}

async function extractFrameDataUrls(videoPath: string, workDir: string, durationSeconds: number): Promise<string[]> {
  const fps = FRAME_COUNT / Math.max(durationSeconds, 1);
  const pattern = join(workDir, "frame-%02d.jpg");

  await execFileAsync("ffmpeg", [
    "-i",
    videoPath,
    "-vf",
    `fps=${fps},scale=512:-1`,
    "-frames:v",
    String(FRAME_COUNT),
    "-y",
    pattern,
  ]);

  const frames: string[] = [];
  for (let i = 1; i <= FRAME_COUNT; i++) {
    const framePath = join(workDir, `frame-${String(i).padStart(2, "0")}.jpg`);
    try {
      const bytes = await readFile(framePath);
      frames.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
    } catch {
      // fps rounding can yield fewer frames than requested for very short videos.
    }
  }
  return frames;
}

async function runVisionAnalysis(
  client: OpenAI,
  transcript: string,
  frameDataUrls: string[],
): Promise<{ sentiment: string; sentimentScore: number; locations: string[]; summary: string }> {
  const prompt = [
    "Analyze this TikTok video about El Salvador using its transcript and the sampled frames below.",
    "The transcript may be empty if the video has no speech — in that case rely on any on-screen text/visuals in the frames.",
    "Transcript:",
    transcript || "(no speech detected)",
  ].join("\n");

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...frameDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: ANALYSIS_JSON_SCHEMA },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned no output for video analysis");
  }
  return JSON.parse(content);
}

export async function analyzeVideoWithOpenAI(
  item: RawApifyItem,
  options: AnalyzeVideoWithOpenAIOptions,
): Promise<VideoAnalysis> {
  const videoUrl = item.video?.url;
  if (!item.id || !videoUrl) {
    throw new Error("Video item is missing an id or video url");
  }

  const client = new OpenAI({ apiKey: options.apiKey });

  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video ${item.id}: ${videoResponse.status}`);
  }
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

  const workDir = await mkdtemp(join(tmpdir(), "findy-openai-"));
  const videoPath = join(workDir, "video.mp4");

  try {
    await writeFile(videoPath, videoBuffer);

    const [transcript, frames] = await Promise.all([
      transcribeVideo(client, videoBuffer),
      extractFrameDataUrls(videoPath, workDir, item.video?.duration ?? DEFAULT_DURATION_SECONDS),
    ]);

    const analysis = await runVisionAnalysis(client, transcript, frames);

    return {
      videoId: item.id,
      sentiment: normalizeSentiment(analysis.sentiment),
      sentimentScore: analysis.sentimentScore,
      transcription: transcript,
      summary: analysis.summary,
      locations: analysis.locations
        .filter((name) => name.trim().length > 0)
        .slice(0, MAX_LOCATIONS)
        .map((name) => ({ name, coordinates: null })),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
