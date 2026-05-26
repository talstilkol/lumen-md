/**
 * AI-powered outline generation — inserts markdown headings based on the
 * document content. Useful for long un-structured notes.
 *
 * Prompts the LLM with the document text and expects a JSON array of
 * heading objects. Each heading is inserted at the appropriate line.
 */

import { chat } from "./llm";
import { log } from "../lib/logger";

export interface OutlineHeading {
  level: 1 | 2 | 3 | 4;
  title: string;
  line: number; // 0-based line index where heading should be inserted
}

const SYSTEM_PROMPT = `You are an expert document outliner. Given markdown text with no headings, propose a logical heading structure.

Output ONLY a JSON array. Each element: {"level": 1|2|3, "title": "Heading text", "line": <0-based index where heading should be inserted (start of a paragraph)>}.

Rules:
- Use H2 (level:2) for main sections, H3 (level:3) for subsections. Rarely H1.
- "line" must be the index of an existing non-empty paragraph start, not the middle of a sentence.
- Maximum 8 headings for a typical document.
- Do NOT wrap in markdown code blocks. Raw JSON only.`;

/**
 * Generate outline headings for the given markdown text.
 * Returns an array of heading insertions sorted by line ascending.
 */
export async function generateOutline(
  text: string,
): Promise<OutlineHeading[]> {
  const lines = text.split("\n");
  if (lines.length < 5) {
    return [];
  }

  try {
    const response = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Propose headings for this markdown document (\${lines.length} lines):\n\n${text.slice(0, 4000)}`,
        },
      ],
      { maxTokens: 600, temperature: 0.2 },
    );

    const json = extractJsonArray(response);
    if (!json) {
      log.debug("outline", "No JSON array found in response");
      return [];
    }

    const headings: OutlineHeading[] = json
      .filter(
        (h: unknown): h is Record<string, unknown> =>
          !!h &&
          typeof h === "object" &&
          "level" in h &&
          "title" in h &&
          "line" in h,
      )
      .map((h) => ({
        level: Math.min(Math.max(Number(h.level) || 2, 1), 4) as 1 | 2 | 3 | 4,
        title: String(h.title).trim(),
        line: Math.min(Math.max(Number(h.line) || 0, 0), lines.length - 1),
      }))
      .filter((h) => h.title.length > 0)
      .sort((a, b) => a.line - b.line);

    return headings;
  } catch (err) {
    log.warn("outline generation failed", err);
    return [];
  }
}

/**
 * Apply headings to a document string. Returns the new document text.
 */
export function applyOutline(
  text: string,
  headings: OutlineHeading[],
): string {
  if (headings.length === 0) return text;
  const lines = text.split("\n");
  let offset = 0;
  for (const h of headings) {
    const insertIndex = h.line + offset;
    const prefix = "#".repeat(h.level) + " ";
    lines.splice(insertIndex, 0, prefix + h.title);
    offset++;
  }
  return lines.join("\n");
}

function extractJsonArray(text: string): unknown[] | null {
  // Try to find JSON array in the response, handling markdown code blocks
  const match = text.match(/\[.*\]/s);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as unknown[];
  } catch {
    return null;
  }
}
