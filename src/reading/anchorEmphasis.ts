/**
 * Anchor emphasis (plan W13.R4) — the start of each word drawn heavier, the
 * idea popularised as "bionic reading" (a trademark, so not that name).
 * Off by default and labelled experimental: the evidence is weak (no
 * reliable speed or comprehension gain in the published replications), so
 * it is offered honestly and measured in the owner's reading study
 * (W13.R14) — time and comprehension with and without.
 *
 * How: the first 40% of every word (at least one letter) is marked with the
 * CSS Custom Highlight API (`::highlight(lumen-anchor)`), not by wrapping
 * text in <b>. The DOM, React's text nodes and the note are untouched, and —
 * what matters for Hebrew — a word is never split into two elements, so
 * the browser shapes it as one run and niqqud and cantillation stay on
 * their letters. The cut is at a grapheme boundary, so a letter is never
 * separated from its marks either (src/__tests__/anchorEmphasis.test.ts).
 * A ::highlight can't change font-weight, so the weight is drawn with a
 * thin text-shadow in the text's own colour.
 *
 * Only read-only rendered text: the preview and the reading page — never
 * an editor, code, keys or math.
 */
import { graphemes } from "./rsvp";

export const ANCHOR_HIGHLIGHT = "lumen-anchor";
export const ANCHOR_RATIO = 0.4;

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’׳״-]*/gu;
const SKIP = "code, pre, kbd, samp, script, style, textarea, input, math, svg, .katex, [data-no-anchor], [contenteditable]:not([contenteditable='false'])";

/** How many letters (grapheme clusters) of an `n`-letter word are emphasised. */
export function anchorLetters(n: number): number {
  return n <= 0 ? 0 : Math.max(1, Math.round(n * ANCHOR_RATIO));
}

/** The emphasised spans of `text`, as code-unit offsets, each ending on a grapheme boundary. */
export function anchorRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD)) {
    const g = graphemes(m[0]);
    const k = anchorLetters(g.filter((x) => /[\p{L}\p{N}]/u.test(x)).length);
    if (!k) continue;
    // k letters, counted as clusters; punctuation inside the word (צה״ל) counts as it comes.
    let len = 0;
    let letters = 0;
    for (const c of g) {
      if (letters >= k) break;
      len += c.length;
      if (/[\p{L}\p{N}]/u.test(c)) letters++;
    }
    out.push([m.index ?? 0, (m.index ?? 0) + len]);
  }
  return out;
}

/** Is the Custom Highlight API there? (Chromium 105+, Safari 17.2+, Firefox 140+.) */
export function anchorSupported(win: Window | undefined = typeof window !== "undefined" ? window : undefined): boolean {
  const w = win as (Window & { CSS?: { highlights?: unknown }; Highlight?: unknown }) | undefined;
  return !!w && typeof w.Highlight === "function" && !!w.CSS?.highlights;
}

/** The read-only rendered roots: the preview (not an editor) and the reading page. */
export function anchorRoots(doc: Document = document): Element[] {
  return [...doc.querySelectorAll(".prose-lumen, .reading-page")].filter((el) => !(el as HTMLElement).isContentEditable && !el.closest("[contenteditable]:not([contenteditable='false'])"));
}

/** Ranges for every eligible text node under `roots`. */
export function collectAnchorRanges(roots: Element[]): Range[] {
  const out: Range[] = [];
  for (const root of roots) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const parent = t.parentElement;
      if (!parent || parent.closest(SKIP) || parent.isContentEditable) continue;
      for (const [from, to] of anchorRanges(t.data)) {
        const r = root.ownerDocument.createRange();
        r.setStart(t, from);
        r.setEnd(t, to);
        out.push(r);
      }
    }
  }
  return out;
}

const CSS_TEXT = `::highlight(${ANCHOR_HIGHLIGHT}) { text-shadow: 0.025em 0 0 currentColor, -0.01em 0 0 currentColor; }`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById("lumen-anchor-css")) return;
  const style = doc.createElement("style");
  style.id = "lumen-anchor-css";
  style.textContent = CSS_TEXT;
  doc.head.appendChild(style);
}

/** Draw the emphasis on the page once. Returns how many words; 0 when the browser can't. */
export function applyAnchor(doc: Document = document): number {
  const win = doc.defaultView as (Window & { CSS: { highlights: Map<string, unknown> }; Highlight: new (...r: Range[]) => unknown }) | null;
  if (!win || !anchorSupported(win)) return 0;
  ensureStyle(doc);
  const ranges = collectAnchorRanges(anchorRoots(doc));
  win.CSS.highlights.set(ANCHOR_HIGHLIGHT, new win.Highlight(...ranges));
  return ranges.length;
}

export function clearAnchor(doc: Document = document): void {
  const win = doc.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> } }) | null;
  win?.CSS?.highlights?.delete(ANCHOR_HIGHLIGHT);
}

let watching: { stop: () => void; doc: Document } | null = null;

/** Keep the emphasis on while the preview re-renders. Idempotent. */
export function watchAnchor(doc: Document = document, delayMs = 150): { stop: () => void } {
  if (watching?.doc === doc) return watching;
  watching?.stop();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      applyAnchor(doc);
    }, delayMs);
  });
  applyAnchor(doc);
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  const w = {
    doc,
    stop: () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      clearAnchor(doc);
      if (watching === w) watching = null;
    },
  };
  watching = w;
  return w;
}

/** Turn it on or off (the reading profile's `anchor`). */
export function setAnchor(on: boolean, doc: Document = document): void {
  if (on) watchAnchor(doc);
  else if (watching) watching.stop();
  else clearAnchor(doc);
}

export function anchorOn(): boolean {
  return watching !== null;
}
