# Video analysis via single-call Gemini multimodal, not Whisper/ElevenLabs transcription

The PRD's original Step 3 extracted places from caption + comment text only (`gpt-4o-mini`), and this session initially considered adding a separate audio transcription step (Whisper or ElevenLabs) ahead of it. Instead we adopted a proven pattern from a sibling codebase (`8mb`'s `content-reviewer.ts`): send the downloaded video file directly to `gemini-3.1-flash-lite` in a single `generateContent` call with a structured output schema, letting Gemini analyze audio, visuals, and on-screen text together rather than producing an intermediate transcript. Cross-video clustering into distinct `Place` records remains a separate, cheap text-only `gpt-4o-mini` call over the per-video Gemini summaries.

## Considered options

- Whisper or ElevenLabs transcription, feeding the resulting transcript into the existing `gpt-4o-mini` caption/comment extraction call.
- Single-call Gemini multimodal analysis per video (chosen).

## Consequences

- Video bytes must be downloaded with spoofed browser headers (TikTok/IG CDNs reject Gemini's own server-side fetcher) and uploaded to Gemini's Files API (free, 2GB/48h) rather than a self-hosted blob store — no R2/S3 needed for this step.
- `nitro.config.ts`'s `cloudflare_module` (Workers) target remains compatible since the flow is a fetch-to-fetch relay, not CPU-bound media processing.
- The real `apidojo/tiktok-scraper` actor output has no comment-text field (`comments` is a count only), so the clustering step's sentiment input comes from the Gemini video summaries, not scraped comment text as the original PRD assumed.
