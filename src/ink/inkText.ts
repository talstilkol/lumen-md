/**
 * W12.R4 — handwritten text in search, behind a measured gate.
 *
 * When the ink recogniser (W7.11) reads an ink block, the text goes into
 * the block's hidden `data-ink-text` attribute. The block is part of the
 * note's Markdown, which the vault index already tokenises, so search finds
 * a handwritten word with no other change. Nothing is shown: the attribute
 * is not rendered, and the UI offers no recognition.
 *
 * The gate: this happens only while ./inkRecognitionGate.json says W11.H14
 * passed — an eval card is linked and its character error rate on the
 * ivrit.ai handwriting benchmark is at or under `maxCer`. Until then
 * `inkTextEnabled()` is false, `applyInkText` changes nothing and returns
 * why, and no capability that was not measured is offered. (MyScript is
 * not an option: its recognition runs only on its cloud or server, under a
 * commercial licence.)
 */
import gateFile from "./inkRecognitionGate.json";
import { findInkBlocks, parseInk } from "./inkModel";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface InkRecognitionGate {
  plan: string;
  status: "not-measured" | "failed" | "passed";
  /** The eval card of the measurement (a path or URL); null until one exists. */
  evalCard: string | null;
  /** Character error rate measured on the benchmark (0..1). */
  cer: number | null;
  /** The highest CER that passes. */
  maxCer: number;
}

export const INK_GATE: InkRecognitionGate = gateFile as InkRecognitionGate;

/** Why the gate is shut, or null when it is open. */
export function gateClosedReason(g: InkRecognitionGate = INK_GATE): string | null {
  if (g.status !== "passed") return `${g.plan} has not passed (status: ${g.status})`;
  if (!g.evalCard) return `${g.plan} passed without an eval card`;
  if (g.cer === null || !Number.isFinite(g.cer)) return `${g.plan} has no measured CER`;
  if (g.cer > g.maxCer) return `CER ${g.cer} is above the gate (${g.maxCer})`;
  return null;
}

/** True only when the recogniser passed its measured gate. */
export const inkTextEnabled = (g: InkRecognitionGate = INK_GATE): boolean => gateClosedReason(g) === null;

/**
 * Put recognised `texts` (ink id → text) into the note's ink blocks. With
 * the gate shut, the note is returned unchanged with the reason. Empty
 * text removes a block's hidden text.
 */
export function applyInkText(markdown: string, texts: ReadonlyMap<string, string>, g: InkRecognitionGate = INK_GATE): { markdown: string; changed: number; blocked: string | null } {
  const blocked = gateClosedReason(g);
  if (blocked) return { markdown, changed: 0, blocked };
  let out = markdown;
  let changed = 0;
  // From the end, so earlier offsets stay valid. Only the opening <svg> tag
  // changes: the strokes stay byte for byte as they were.
  for (const range of findInkBlocks(markdown).reverse()) {
    const text = texts.get(range.id);
    if (text === undefined) continue;
    const block = markdown.slice(range.start, range.end);
    const ink = parseInk(block);
    if (!ink) continue;
    const clean = text.replace(/\s+/g, " ").trim();
    if ((ink.text ?? "") === clean) continue;
    const head = /^<svg\b[^>]*>/i.exec(block)![0];
    const bare = head.replace(/\sdata-ink-text="[^"]*"/, "");
    const next = clean ? bare.replace(/>$/, ` data-ink-text="${escapeAttr(clean)}">`) : bare;
    out = out.slice(0, range.start) + next + block.slice(head.length) + out.slice(range.end);
    changed++;
  }
  return { markdown: out, changed, blocked: null };
}

/** The hidden text of every ink block in a note, by ink id. */
export function inkTexts(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const range of findInkBlocks(markdown)) {
    const ink = parseInk(markdown.slice(range.start, range.end));
    if (ink?.text) out.set(ink.id, ink.text);
  }
  return out;
}
