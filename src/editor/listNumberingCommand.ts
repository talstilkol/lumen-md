/**
 * "Number lists with Hebrew letters" (plan W13.H5): the palette command
 * writes or removes `listNumbering: hebrew` in the note's frontmatter — the
 * list items themselves stay 1. 2. 3. in the Markdown.
 */
import { listNumberingOfMarkdown } from "../lib/hebrewListNumbering";

const FM = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$))/;
const KEY_LINE = /^(?:listNumbering|list-numbering)\s*:.*(?:\r?\n|$)/m;

/** The note with Hebrew list numbering switched on or off; the rest of the text is untouched. */
export function toggleHebrewListNumbering(markdown: string): { text: string; on: boolean } {
  const on = listNumberingOfMarkdown(markdown) !== "hebrew";
  const m = FM.exec(markdown);
  if (!m) {
    return on ? { text: `---\nlistNumbering: hebrew\n---\n${markdown}`, on } : { text: markdown, on };
  }
  const [, open, body, close] = m;
  const rest = markdown.slice(m[0].length);
  let next = KEY_LINE.test(body) ? body.replace(KEY_LINE, "").replace(/\r?\n$/, "") : body;
  if (on) next = next.length ? `${next}\nlistNumbering: hebrew` : "listNumbering: hebrew";
  // An empty frontmatter left behind is removed with its fences.
  if (!next.trim()) return { text: rest, on };
  return { text: open + next + close + rest, on };
}
