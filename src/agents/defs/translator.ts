/**
 * translator — `ai.translate`. Translates Markdown into a target language
 * while keeping its structure. Long documents are translated chunk by
 * chunk (never splitting a code fence); each chunk is checked:
 * code fences, link URLs and image URLs must survive unchanged, and the
 * output must be written in the target language's script when that
 * script is distinctive (Hebrew, Arabic, Cyrillic, CJK) — the most common
 * local-model failure is answering in English.
 */

import type { AgentDefinition, AgentInput, ValidationResult } from "../types";
import { registerAgent } from "../registry";
import { fail, ok, scriptOf } from "./shared";

export interface TranslatorInput extends AgentInput {
  text: string;
  extra: { targetLanguage: string };
}

export const CHUNK_CHARS = 3500;

type Script = ReturnType<typeof scriptOf>;

/** The script a target-language name or code implies, when it is distinctive. */
export function expectedScript(targetLanguage: string): Script | null {
  const t = targetLanguage.trim().toLowerCase();
  if (/^(he|heb|hebrew|iw|עברית|ivrit)$/.test(t)) return "hebrew";
  if (/^(ar|ara|arabic|العربية|arabe|fa|persian|farsi|فارسی|ur|urdu)$/.test(t)) return "arabic";
  if (/^(ru|rus|russian|русский|uk|ukrainian|українська|bg|bulgarian|sr|serbian)$/.test(t)) return "cyrillic";
  if (/^(zh|zh-cn|zh-tw|chinese|中文|汉语|ja|jp|japanese|日本語|ko|korean|한국어)$/.test(t)) return "cjk";
  if (/^(en|eng|english|es|spanish|español|fr|french|français|de|german|deutsch|it|italian|pt|portuguese|nl|dutch|sv|swedish|pl|polish|tr|turkish|cs|czech)$/.test(t)) return "latin";
  return null;
}

/** Split Markdown into chunks of about CHUNK_CHARS at blank lines, never inside a code fence. */
export function chunkMarkdown(text: string, max = CHUNK_CHARS): string[] {
  if (text.length <= max) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    current.push(line);
    size += line.length + 1;
    if (!inFence && size >= max && line.trim() === "") {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

const urlsOf = (s: string): string[] => [...s.matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]).sort();

/** The prose of a Markdown text: no code blocks, inline code, URLs or frontmatter — what the script check should look at. */
export function proseOf(s: string): string {
  return s
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/https?:\/\/\S+/g, " ");
}
const fenceCount = (s: string): number => (s.match(/^\s*(```|~~~)/gm) ?? []).length;

/** Structure must survive: same fences, same link/image URLs; script must match the target. */
export function checkTranslation(output: string, source: string, targetLanguage: string): ValidationResult {
  if (!output.trim()) return fail("empty translation");
  if (fenceCount(output) !== fenceCount(source)) return fail("code fences changed", "Keep every ``` code block exactly as in the source, untranslated.");
  const a = urlsOf(source);
  const b = urlsOf(output);
  if (a.length !== b.length || a.some((u, i) => u !== b[i])) return fail("link or image URLs changed", "Keep every link and image URL exactly as in the source.");
  const want = expectedScript(targetLanguage);
  const got = scriptOf(proseOf(output));
  if (want && want !== "latin" && got !== want) return fail(`output is not written in ${targetLanguage}`, `Write the whole translation in ${targetLanguage}; translate every sentence.`);
  if (want === "latin" && scriptOf(proseOf(source)) !== "latin" && got !== "latin") return fail(`output is not written in ${targetLanguage}`, `Write the whole translation in ${targetLanguage}.`);
  return ok;
}

export const translatorAgent: AgentDefinition<TranslatorInput, string> = registerAgent({
  id: "translator",
  commandId: "ai.translate",
  description: "Translate Markdown into another language, preserving structure",
  system: (input) =>
    `You are a translation engine. Translate the user's Markdown into ${input.extra.targetLanguage}. Preserve all ` +
    "Markdown structure exactly: headings, lists, tables, emphasis, YAML frontmatter keys, code blocks (do not " +
    "translate code), inline code, and every link and image URL. Translate every sentence; do not summarise, " +
    "do not add notes. Output ONLY the translated Markdown.",
  user: (input) => input.text,
  parse: (text) => text.trim(),
  validators: [{ name: "translation", check: (out, input) => checkTranslation(out, input.text ?? "", (input as TranslatorInput).extra.targetLanguage) }],
  tier: "small",
  temperature: 0.2,
  maxTokens: 4000,
  cache: true,
});
