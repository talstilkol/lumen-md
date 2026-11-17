/**
 * W11.Q4 (research R5.6): editor ceilings, part 2. ProseMirror (Milkdown)
 * renders the whole document and has no viewport virtualisation
 * (https://discuss.prosemirror.net/t/lazy-rendering-for-prosemirror/1486),
 * so a very large note freezes the WYSIWYG view. Above a size ceiling the note
 * opens in the source editor (CodeMirror, which renders only the viewport)
 * with a notice; the person can still choose WYSIWYG, with a warning.
 *
 * The ceiling, from R5.6: 300 KB of UTF-8 or 5,000 blocks, whichever comes
 * first. "Tune by measurement": `npm run perf:wysiwyg-ceiling`
 * (e2e/wysiwyg-ceiling-calibrate.spec.ts) opens 50 KB–900 KB in WYSIWYG with
 * the CPU 4× slower and records open time and keypress → paint p95;
 * scripts/perf/wysiwyg-ceiling.mjs --check fails while these two numbers are
 * above what that measurement supports. They move only with it.
 */

export const WYSIWYG_MAX_BYTES = 300 * 1024;
export const WYSIWYG_MAX_BLOCKS = 5000;

export interface CeilingVerdict {
  tooLarge: boolean;
  bytes: number;
  blocks: number;
  /** Which limit was passed (the first one checked that is over). */
  reason: "bytes" | "blocks" | null;
}

/** UTF-8 length without allocating the encoded bytes. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Top-level blocks, roughly as ProseMirror will have them: each heading, list
 * item, table row, block quote line run, fence and paragraph counts once.
 * Lines inside a fenced code block are one block. Stops counting at `cap`.
 */
export function countBlocks(md: string, cap = Infinity): number {
  let blocks = 0;
  let inPara = false;
  let fence: string | null = null;
  let start = 0;
  while (start <= md.length && blocks < cap) {
    let end = md.indexOf("\n", start);
    if (end < 0) end = md.length;
    const line = md.slice(start, end);
    start = end + 1;
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    const f = /^(`{3,}|~{3,})/.exec(trimmed);
    if (f) {
      fence = f[1][0].repeat(3);
      blocks++;
      inPara = false;
      continue;
    }
    if (!trimmed) {
      inPara = false;
      continue;
    }
    if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(trimmed)) {
      blocks++;
      inPara = false;
      continue;
    }
    if (!inPara) {
      blocks++;
      inPara = true;
    }
    if (end === md.length) break;
  }
  return blocks;
}

/** Whether this note is over the WYSIWYG ceiling. */
export function wysiwygCeiling(md: string, limits = { bytes: WYSIWYG_MAX_BYTES, blocks: WYSIWYG_MAX_BLOCKS }): CeilingVerdict {
  // Both counts are linear and run once per note opened (EditorLayout), not per keystroke.
  const bytes = utf8Bytes(md);
  if (bytes > limits.bytes) return { tooLarge: true, bytes, blocks: countBlocks(md, limits.blocks + 1), reason: "bytes" };
  const blocks = countBlocks(md, limits.blocks + 1);
  return { tooLarge: blocks > limits.blocks, bytes, blocks, reason: blocks > limits.blocks ? "blocks" : null };
}

/** Notes the person opened in WYSIWYG anyway, this session (by path). */
const forced = new Set<string>();

export function forceWysiwyg(path: string | null, on: boolean): void {
  if (!path) return;
  if (on) forced.add(path);
  else forced.delete(path);
}

export function isWysiwygForced(path: string | null): boolean {
  return !!path && forced.has(path);
}

/** For tests. */
export function resetWysiwygForced(): void {
  forced.clear();
}
