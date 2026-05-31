/**
 * Google Gemini provider.
 *
 * Routes chat/stream calls through the Generative Language API
 * (generativelanguage.googleapis.com). Gemini uses `contents` with a `model`
 * role (not `assistant`) and a separate `systemInstruction`, so the body shape
 * differs from OpenAI — `buildGeminiBody` handles the mapping and is exported
 * for unit testing.
 *
 * Zero external dependencies — native fetch + SSE parsing.
 */

import type { ChatMessage, ChatOptions } from "./llm";
import { getProviderKey, AiError } from "./llm";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-1.5-flash";

export function getGeminiModel(opts: ChatOptions): string {
  if (opts.model) return opts.model;
  try {
    return localStorage.getItem("lumen.ai.model.gemini") || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

interface GeminiBody {
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig?: { maxOutputTokens?: number; temperature?: number };
}

/** Pure mapping from our ChatMessage[] to the Gemini generateContent body. */
export function buildGeminiBody(messages: ChatMessage[], opts: ChatOptions = {}): GeminiBody {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: m.content }],
    }));
  const generationConfig: GeminiBody["generationConfig"] = {};
  if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

function extractText(data: unknown): string {
  const parts =
    (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

export async function chatGemini(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const key = getProviderKey("gemini");
  const url = `${BASE}/${getGeminiModel(opts)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGeminiBody(messages, opts)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = extractText(await res.json()).trim();
  if (!text) throw new AiError("PARSE_ERROR", "Empty Gemini response.");
  return text;
}

export async function* chatGeminiStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const key = getProviderKey("gemini");
  const url = `${BASE}/${getGeminiModel(opts)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGeminiBody(messages, opts)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Gemini stream ${res.status}: ${body.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new AiError("API_ERROR", "No response body from Gemini.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const delta = extractText(JSON.parse(trimmed.slice(6)));
        if (delta) yield delta;
      } catch {
        /* skip */
      }
    }
  }
}
