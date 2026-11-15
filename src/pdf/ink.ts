/**
 * Ink on a PDF page (plan 4.14, W10.E64): freehand strokes drawn over the
 * page, saved as W3C Web Annotations next to the highlights, in the PDF's
 * companion note.
 *
 * One annotation per page holds that page's strokes. Its target is the PDF
 * and the page (an RFC 3778 `page=N` FragmentSelector), refined by an
 * SvgSelector: the strokes as an SVG in page units (0…1 on both axes, so a
 * zoom or another screen draws them in the same place). Another W3C
 * annotation tool can read the SVG. Lumen also keeps the samples, with
 * pressure, under `lumen:strokes`, so it can draw them again exactly.
 *
 * Safety:
 *  - The strokes live in a region of their own in the companion note (its own
 *    markers and fence). The highlights' region, its strict reader and its
 *    writer (annotations.ts) never see them, so a reader that knows nothing of
 *    ink keeps them when it saves highlights, and the other way round.
 *  - A damaged ink block reads as null and is never saved over.
 *  - Moving the PDF keeps the ids and points the target at the new path.
 *    Duplicating gives the copy new ids, so two PDFs never share an annotation.
 */
import { ANNO_CONTEXT, RFC3778 } from "./annotations";

/** A sample in page units: x, y in 0…1 from the page's top-left, pressure 0…1. */
export type InkSample = [x: number, y: number, p: number];

export interface PdfInkStroke {
  points: InkSample[];
  /** Diameter as a fraction of the page width. */
  size: number;
  /** `#rrggbb`. */
  color: string;
}

export interface SvgSelector {
  type: "SvgSelector";
  value: string;
}

export interface PdfInkAnnotation {
  "@context": typeof ANNO_CONTEXT;
  id: string;
  type: "Annotation";
  motivation: "highlighting";
  created: string;
  modified?: string;
  target: {
    source: string;
    selector: { type: "FragmentSelector"; conformsTo: typeof RFC3778; value: string; refinedBy: SvgSelector };
  };
  "lumen:strokes": PdfInkStroke[];
}

const r4 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

/** A stroke with its samples clamped to the page and rounded (4 digits: a 0.1 mm grid on A4). */
export function cleanStroke(s: PdfInkStroke): PdfInkStroke {
  return { points: s.points.map(([x, y, p]) => [r4(x), r4(y), r4(p)] as InkSample), size: Math.min(0.2, Math.max(0.0005, s.size)), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : "#000000" };
}

const n = (v: number) => String(Math.round(v * 10000) / 10000);

/** The strokes as an SVG document in page units (viewBox 0 0 1 1): one polyline path per stroke. */
export function strokesSvg(strokes: readonly PdfInkStroke[]): string {
  const paths = strokes
    .filter((s) => s.points.length)
    .map((s) => {
      const [first, ...rest] = s.points;
      const d = `M${n(first[0])} ${n(first[1])}` + (rest.length ? rest.map(([x, y]) => ` L${n(x)} ${n(y)}`).join("") : ` L${n(first[0])} ${n(first[1])}`);
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${n(s.size)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none">${paths}</svg>`;
}

export function newInkAnnotationId(rand: () => number = Math.random): string {
  const hex = Array.from({ length: 16 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `urn:lumen:pdf-ink:${hex}`;
}

/** The page's ink annotation with `strokes` (new, or `prev` updated). */
export function inkAnnotation(opts: { source: string; page: number; strokes: readonly PdfInkStroke[]; prev?: PdfInkAnnotation; now?: Date; id?: string }): PdfInkAnnotation {
  const now = (opts.now ?? new Date()).toISOString();
  const strokes = opts.strokes.map(cleanStroke).filter((s) => s.points.length > 0);
  return {
    "@context": ANNO_CONTEXT,
    id: opts.prev?.id ?? opts.id ?? newInkAnnotationId(),
    type: "Annotation",
    motivation: "highlighting",
    created: opts.prev?.created ?? now,
    ...(opts.prev ? { modified: now } : {}),
    target: { source: opts.source, selector: { type: "FragmentSelector", conformsTo: RFC3778, value: `page=${opts.page}`, refinedBy: { type: "SvgSelector", value: strokesSvg(strokes) } } },
    "lumen:strokes": strokes,
  };
}

export const inkPage = (a: PdfInkAnnotation): number | null => {
  const m = /^page=(\d+)$/.exec(a.target.selector.value);
  return m ? Number(m[1]) : null;
};

/** `list` with page `page`'s strokes set (an empty list drops the page's annotation). */
export function setPageStrokes(list: readonly PdfInkAnnotation[], source: string, page: number, strokes: readonly PdfInkStroke[], now?: Date): PdfInkAnnotation[] {
  const prev = list.find((a) => inkPage(a) === page);
  const rest = list.filter((a) => a !== prev);
  if (!strokes.length) return rest;
  return [...rest, inkAnnotation({ source, page, strokes, prev, now })].sort((a, b) => (inkPage(a) ?? 0) - (inkPage(b) ?? 0));
}

/** The PDF moved: same annotations (same ids), pointing at `to`. */
export const moveInk = (list: readonly PdfInkAnnotation[], to: string): PdfInkAnnotation[] => list.map((a) => ({ ...a, target: { ...a.target, source: to } }));

/** The PDF was copied: the copy's annotations, with new ids and `to` as their source. */
export function duplicateInk(list: readonly PdfInkAnnotation[], to: string, rand?: () => number): PdfInkAnnotation[] {
  return list.map((a) => ({ ...structuredClone(a), id: newInkAnnotationId(rand), target: { ...structuredClone(a.target), source: to } }));
}

// ── the companion note's ink region ─────────────────────────────────────

export const INK_START = "<!-- lumen:pdf-ink:start -->";
export const INK_END = "<!-- lumen:pdf-ink:end -->";
const INK_FENCE_RE = /(`{3,}|~{3,})[ \t]*json[ \t]+lumen-pdf-ink[^\n]*\n([\s\S]*?)\n\1/;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function isInkAnnotation(x: unknown): x is PdfInkAnnotation {
  if (!isObj(x) || x.type !== "Annotation" || typeof x.id !== "string" || typeof x.created !== "string") return false;
  const t = x.target;
  if (!isObj(t) || typeof t.source !== "string" || !isObj(t.selector) || typeof t.selector.value !== "string" || !/^page=\d+$/.test(t.selector.value)) return false;
  if (!isObj(t.selector.refinedBy) || t.selector.refinedBy.type !== "SvgSelector" || typeof t.selector.refinedBy.value !== "string") return false;
  const strokes = x["lumen:strokes"];
  return Array.isArray(strokes) && strokes.every((s) => isObj(s) && isNum(s.size) && typeof s.color === "string" && Array.isArray(s.points) && s.points.every((p) => Array.isArray(p) && p.length === 3 && p.every(isNum)));
}

function region(md: string): { start: number; end: number } | null {
  for (let start = md.lastIndexOf(INK_START); start !== -1; start = start === 0 ? -1 : md.lastIndexOf(INK_START, start - 1)) {
    const end = md.indexOf(INK_END, start + INK_START.length);
    if (end !== -1 && INK_FENCE_RE.test(md.slice(start, end))) return { start, end };
  }
  return null;
}

/** The ink in a companion note, strictly: [] for none, null for a block that can't be read whole (never save over it). */
export function readInkNote(md: string | null | undefined): PdfInkAnnotation[] | null {
  if (!md || !md.includes(INK_START)) return [];
  const r = region(md);
  if (!r) return null;
  const fence = INK_FENCE_RE.exec(md.slice(r.start, r.end));
  if (!fence) return null;
  try {
    const data = JSON.parse(fence[2]) as unknown;
    return Array.isArray(data) && data.every(isInkAnnotation) ? data : null;
  } catch {
    return null;
  }
}

/** The companion note with its ink region set to `list` (added at the end when there is none; removed when `list` is empty). Everything else is kept byte for byte. */
export function upsertInkNote(md: string | null | undefined, list: readonly PdfInkAnnotation[]): string {
  const text = md ?? "";
  if (readInkNote(text) === null) throw new Error("the ink block of this note can't be read: not saving over it");
  const r = region(text);
  const block = list.length ? `${INK_START}\n\`\`\`json lumen-pdf-ink\n${JSON.stringify(list, null, 1)}\n\`\`\`\n${INK_END}` : "";
  if (r) {
    const before = text.slice(0, r.start);
    const after = text.slice(r.end + INK_END.length);
    return block ? before + block + after : before.replace(/\n+$/, "\n") + after.replace(/^\n+/, "");
  }
  if (!block) return text;
  return (text && !text.endsWith("\n") ? text + "\n" : text) + (text ? "\n" : "") + block + "\n";
}
