import OpenAI from "openai";

export const DEFAULT_OPENROUTER_MODEL = "mistralai/mistral-nemo";

export interface LlmOptions {
  apiKey: string;
  model?: string;
}

export function createLlmClient(options: LlmOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

export async function generateJson<T>(
  client: OpenAI,
  prompt: string,
  schema: Record<string, unknown>,
  options: { model?: string; schemaName?: string } = {},
): Promise<T> {
  const model = options.model ?? DEFAULT_OPENROUTER_MODEL;
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: options.schemaName ?? "response",
        schema,
        strict: true,
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no output");
  }

  return JSON.parse(content) as T;
}
