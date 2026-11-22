/**
 * W12.R1 — PDF highlights as cards on the canvas (Heptabase's "highlight
 * cards"), each linked to the exact place in the PDF.
 *
 * A card is a rectangle with the quote bound inside it. Its `link` is the
 * highlight's own target, `file.pdf#page=N&highlight=ID` — the same
 * fragment `[[file.pdf#page=N&highlight=ID]]` links use — so clicking it
 * opens the reader at that page and flashes the highlight, which the
 * reader re-anchors by its TextQuoteSelector (it survives a new text layer
 * or OCR). `annotation=ID` is read as a synonym. In JSON Canvas (4.17) the
 * card is a `file` node with that `subpath`, as Obsidian Canvas keeps one.
 *
 * A highlight deleted since is not removed from the canvas: its card turns
 * dashed and says the source was deleted.
 *
 * Pure: no DOM, no Excalidraw import.
 */
import type { ExBase, ExShapeElement, ExTextElement } from "./tldrawToExcalidraw";
import { isRtlText, wrapLines } from "./noteCards";
import { shortId } from "../pdf/annotations";

/** What a drag of a highlight carries (the highlights panel sets it). */
export const HIGHLIGHT_MIME = "application/x-lumen-highlight";

export interface HighlightDrag {
  /** The PDF's vault path. */
  pdf: string;
  /** The highlight's id (full or the short form links use). */
  id: string;
  page: number;
  quote: string;
}

export const CARD_W = 280;
const PAD = 12;
const SIZE = 16;
const LINE = 1.25;
const FONT = 6;
const MAX_LINES = 8;
export const DELETED_MARK = "⚠";

/** The card's link: the PDF path and the highlight fragment. */
export function highlightCardLink(h: Pick<HighlightDrag, "pdf" | "id" | "page">): string {
  return `${h.pdf}#page=${h.page}&highlight=${shortId(h.id)}`;
}

/** A card link back into its parts; null for any other link. */
export function parseCardLink(link: string | null | undefined): { path: string; fragment: string; page: number; highlight: string } | null {
  if (!link) return null;
  const hash = link.indexOf("#");
  if (hash < 0) return null;
  let path = link.slice(0, hash);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* why: a literal % in a file name; keep it as written */
  }
  if (!/\.pdf$/i.test(path)) return null;
  const params = new URLSearchParams(link.slice(hash + 1));
  const highlight = params.get("highlight") ?? params.get("annotation");
  const page = Number(params.get("page"));
  if (!highlight || !(page >= 1)) return null;
  return { path, fragment: `page=${page}&highlight=${highlight}`, page, highlight };
}

const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;

/** The rectangle and its bound quote, top-left at `at` (scene coordinates). */
export function highlightCard(h: HighlightDrag, at: { x: number; y: number }, pageWord: (n: number) => string, now = Date.now()): [ExShapeElement, ExTextElement] {
  const id = `hl-${h.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}-${Math.round(at.x)}-${Math.round(at.y)}`;
  const inner = CARD_W - 2 * PAD;
  const lines = wrapLines(h.quote.replace(/\s+/g, " ").trim(), inner, SIZE);
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `${lines[MAX_LINES - 1]} …`] : lines;
  const text = [...shown, `— ${pageWord(h.page)}`].join("\n");
  const textH = (shown.length + 1) * SIZE * LINE;
  const base = (eid: string, w: number, hgt: number, x: number, y: number): ExBase => ({
    id: eid,
    x,
    y,
    width: w,
    height: hgt,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: seedOf(eid),
    version: 1,
    versionNonce: seedOf(`${eid}~n`),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
  });
  const rect: ExShapeElement = {
    ...base(id, CARD_W, textH + 2 * PAD, at.x, at.y),
    type: "rectangle",
    backgroundColor: "#fff9db",
    roundness: { type: 3 },
    boundElements: [{ id: `${id}~q`, type: "text" }],
    link: highlightCardLink(h),
  };
  const quote: ExTextElement = {
    ...base(`${id}~q`, inner, textH, at.x + PAD, at.y + PAD),
    type: "text",
    text,
    originalText: text,
    fontSize: SIZE,
    fontFamily: FONT,
    textAlign: isRtlText(h.quote) ? "right" : "left",
    verticalAlign: "top",
    containerId: id,
    autoResize: false,
    lineHeight: LINE,
  };
  return [rect, quote];
}

type Element = ExBase & { type: string; text?: string; originalText?: string; containerId?: string | null };

/**
 * Cards whose highlight no longer exists (`live`: the PDFs' highlight ids,
 * short or full) turn dashed and get the deleted mark on their first line;
 * a card whose highlight came back is restored. Elements that are not
 * cards, and cards of PDFs not in `live`, are left as they are.
 */
export function markSourceDeleted<T extends Element>(elements: readonly T[], live: ReadonlyMap<string, ReadonlySet<string>>, label: string): { elements: T[]; changed: number } {
  let changed = 0;
  const gone = new Map<string, boolean>();
  for (const el of elements) {
    const c = parseCardLink(el.link);
    const ids = c && live.get(c.path);
    if (!c || !ids || el.isDeleted) continue;
    const alive = [...ids].some((x) => x === c.highlight || shortId(x) === c.highlight);
    gone.set(el.id, !alive);
  }
  const mark = `${DELETED_MARK} ${label}`;
  const out = elements.map((el) => {
    const g = gone.get(el.id) ?? (el.containerId ? gone.get(el.containerId) : undefined);
    if (g === undefined) return el;
    const marked = el.text !== undefined ? el.text.startsWith(mark) : el.strokeStyle === "dashed";
    if (marked === g) return el;
    changed++;
    if (el.text !== undefined) {
      const text = g ? `${mark}\n${el.text}` : el.text.slice(mark.length + 1);
      return { ...el, text, originalText: text, version: el.version + 1 };
    }
    return { ...el, strokeStyle: g ? "dashed" : "solid", opacity: g ? 60 : 100, version: el.version + 1 };
  });
  return { elements: out, changed };
}
