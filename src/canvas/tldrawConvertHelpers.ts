/**
 * Helpers of the tldraw → Excalidraw converter (plan 4.19): record access,
 * style mapping, text measuring, geometry, draw-stroke decoding and stable
 * ids. Moved verbatim out of tldrawToExcalidraw.ts to keep it under the
 * 800-line limit (W10.E29, W6.25); still pure and dependency-free.
 */
import { TldrawFormatError, type ExFillStyle, type ExStrokeStyle, type ExArrowhead, type ExTextAlign, type ExVerticalAlign, type ExPoint, type ExcalidrawElement, type TlRecord } from "./excalidrawTypes";

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
export function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
export function props(r: TlRecord): Obj {
  return isObj(r.props) ? r.props : {};
}

export function isRecord(v: unknown): v is TlRecord {
  return isObj(v) && typeof v.id === "string" && typeof v.typeName === "string";
}

/**
 * Pull the record list out of any of the stored tldraw formats.
 * Throws `TldrawFormatError` when the input isn't a tldraw canvas.
 */
export function extractTldrawRecords(input: unknown): TlRecord[] {
  let data: unknown = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      throw new TldrawFormatError("not JSON");
    }
  }
  if (!isObj(data)) throw new TldrawFormatError("not a tldraw canvas");
  let list: unknown[];
  if (isObj(data.document) && isObj(data.document.store)) {
    list = Object.values(data.document.store);
  } else if (isObj(data.store)) {
    list = Object.values(data.store);
  } else if (Array.isArray(data.records)) {
    list = data.records;
  } else {
    throw new TldrawFormatError("no tldraw store or records");
  }
  return list.filter(isRecord);
}

// ---------------------------------------------------------------------------
// Style mapping (tldraw default style values → Excalidraw).

/** tldraw's light-theme solid colours. */
export const COLORS: Record<string, string> = {
  black: "#1d1d1d",
  grey: "#9fa8b2",
  "light-violet": "#e085f4",
  violet: "#ae3ec9",
  blue: "#4465e9",
  "light-blue": "#4ba1f1",
  yellow: "#f1ac4b",
  orange: "#e16919",
  green: "#099268",
  "light-green": "#4cb05e",
  "light-red": "#f87777",
  red: "#e03131",
  white: "#ffffff",
};
/** tldraw's light-theme `semi` colours — what `fill: "solid"` paints. */
export const TINTS: Record<string, string> = {
  black: "#e8e8e8",
  grey: "#eceef0",
  "light-violet": "#f5eafa",
  violet: "#ecdcf2",
  blue: "#dce1f8",
  "light-blue": "#ddedfa",
  yellow: "#f9f0e6",
  orange: "#f8e2d4",
  green: "#d3e9e3",
  "light-green": "#dbf0e0",
  "light-red": "#f4dadb",
  red: "#f4dadb",
  white: "#f5f5f5",
};
/** tldraw light theme `solid` — what `fill: "semi"` paints. */
export const SEMI_FILL = "#fcfffe";
/** Sticky-note paper colours (tldraw light theme `note.fill`). */
export const NOTE_FILLS: Record<string, string> = {
  black: "#2c2c2c",
  grey: "#e3e7eb",
  "light-violet": "#f1c4fb",
  violet: "#dca9ec",
  blue: "#bccafa",
  "light-blue": "#a9d6fb",
  yellow: "#fed49a",
  orange: "#fbc29c",
  green: "#9cdfc9",
  "light-green": "#b0e5b8",
  "light-red": "#fbbcbc",
  red: "#fca4a4",
  white: "#ffffff",
};

export function color(name: unknown): string {
  return COLORS[str(name, "black")] ?? COLORS.black;
}
export function tint(name: unknown): string {
  return TINTS[str(name, "black")] ?? TINTS.black;
}

export const STROKE_WIDTHS: Record<string, number> = { s: 1, m: 2, l: 4, xl: 6 };
/** tldraw FONT_SIZES (text shapes). */
export const TEXT_FONT_SIZES: Record<string, number> = { s: 18, m: 24, l: 36, xl: 44 };
/** tldraw LABEL_FONT_SIZES (geo and note labels). */
export const LABEL_FONT_SIZES: Record<string, number> = { s: 18, m: 22, l: 26, xl: 32 };
/** tldraw ARROW_LABEL_FONT_SIZES. */
export const ARROW_FONT_SIZES: Record<string, number> = { s: 18, m: 20, l: 24, xl: 28 };

/** Excalidraw font families: 3 Cascadia, 5 Excalifont, 6 Nunito. */
export const FONTS: Record<string, number> = { draw: 5, sans: 6, serif: 6, mono: 3 };

export function strokeWidth(size: unknown): number {
  return STROKE_WIDTHS[str(size, "m")] ?? 2;
}
export function fontFamily(font: unknown): number {
  return FONTS[str(font, "draw")] ?? 5;
}

export function strokeStyle(dash: unknown): { strokeStyle: ExStrokeStyle; roughness: number } {
  switch (dash) {
    case "dashed":
      return { strokeStyle: "dashed", roughness: 0 };
    case "dotted":
      return { strokeStyle: "dotted", roughness: 0 };
    case "solid":
      return { strokeStyle: "solid", roughness: 0 };
    default: // "draw" — tldraw's hand-drawn line
      return { strokeStyle: "solid", roughness: 1 };
  }
}

export function fill(fillName: unknown, colorName: unknown): { backgroundColor: string; fillStyle: ExFillStyle } {
  switch (fillName) {
    // tldraw's naming is crossed: "semi" paints the near-white theme
    // background, "solid" the colour's pale tint, "fill" the full colour.
    case "semi":
      return { backgroundColor: SEMI_FILL, fillStyle: "solid" };
    case "solid":
      return { backgroundColor: tint(colorName), fillStyle: "solid" };
    case "fill":
      return { backgroundColor: color(colorName), fillStyle: "solid" };
    case "pattern":
      return { backgroundColor: color(colorName), fillStyle: "hachure" };
    default:
      return { backgroundColor: "transparent", fillStyle: "solid" };
  }
}

export const ARROWHEADS: Record<string, ExArrowhead | null> = {
  none: null,
  arrow: "arrow",
  triangle: "triangle",
  inverted: "triangle_outline",
  square: "diamond",
  diamond: "diamond",
  dot: "circle",
  pipe: "bar",
  bar: "bar",
};
export function arrowhead(v: unknown, fallback: ExArrowhead | null): ExArrowhead | null {
  const key = str(v, "");
  return key in ARROWHEADS ? (ARROWHEADS[key] ?? null) : fallback;
}

// ---------------------------------------------------------------------------
// Text helpers.

/** Plain text of a tldraw rich-text (TipTap) document. Characters are kept as-is. */
export function richTextToPlain(node: unknown): string {
  if (!isObj(node)) return "";
  const type = node.type;
  const content = Array.isArray(node.content) ? node.content : [];
  switch (type) {
    case "text":
      return str(node.text, "");
    case "hardBreak":
      return "\n";
    case "doc":
    case "blockquote":
    case "listItem":
      return content.map(richTextToPlain).join("\n");
    case "bulletList":
      return content.map((c) => "• " + richTextToPlain(c)).join("\n");
    case "orderedList": {
      const start = isObj(node.attrs) ? num(node.attrs.start, 1) : 1;
      return content.map((c, i) => `${start + i}. ` + richTextToPlain(c)).join("\n");
    }
    default:
      return content.map(richTextToPlain).join("");
  }
}

/** The text of a shape — `richText` (tldraw ≥ 3.10) or the older `text` string. */
export function shapeText(p: Obj): string {
  if (isObj(p.richText)) return richTextToPlain(p.richText);
  return str(p.text, "");
}

export const RTL_STRONG = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
export const LTR_STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** True when the first strong-direction character of `text` is right-to-left. */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return true;
    if (LTR_STRONG.test(ch)) return false;
  }
  return false;
}

export function textAlign(align: unknown, text: string): ExTextAlign {
  const a = str(align, "middle").replace(/-legacy$/, "");
  if (a === "middle") return "center";
  const rtl = isRtlText(text);
  if (a === "start") return rtl ? "right" : "left";
  if (a === "end") return rtl ? "left" : "right";
  return "center";
}

export function verticalAlign(v: unknown): ExVerticalAlign {
  return v === "start" ? "top" : v === "end" ? "bottom" : "middle";
}

export const LINE_HEIGHT = 1.25;
/** Excalidraw's BOUND_TEXT_PADDING: the gap between a container and its text. */
export const BOUND_TEXT_PADDING = 5;

export const WIDE_CHAR = /[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;

/** Estimated width of one line, in ems. */
export function lineEms(line: string): number {
  let w = 0;
  for (const ch of line) w += WIDE_CHAR.test(ch) ? 1 : 0.55;
  return w;
}

/**
 * Greedy word wrap at `width` px, as Excalidraw stores a fixed-width text's
 * `text` (with `originalText` holding the source). Only line breaks are
 * inserted at spaces (or inside a word longer than the line).
 */
export function wrapText(text: string, fontSize: number, width: number): string {
  const max = width / fontSize;
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      for (const word of line.split(/(?<=\s)/)) {
        if (cur && lineEms(cur + word.trimEnd()) > max) {
          out.push(cur.trimEnd());
          cur = "";
        }
        let w = word;
        while (!cur && lineEms(w.trimEnd()) > max && w.length > 1) {
          let n = 1;
          while (n < w.length && lineEms(w.slice(0, n + 1)) <= max) n++;
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        cur += w;
      }
      out.push(cur.trimEnd());
      return out.join("\n");
    })
    .join("\n");
}

/** Rough text box (Excalidraw re-measures text when it is edited). */
export function measureText(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split("\n");
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, lineEms(line));
  return {
    width: round(Math.max(widest * fontSize, fontSize * 0.5)),
    height: round(lines.length * fontSize * LINE_HEIGHT),
  };
}

// ---------------------------------------------------------------------------
// Geometry.

export interface Transform {
  x: number;
  y: number;
  rotation: number;
}

export function rotate(x: number, y: number, r: number): ExPoint {
  if (r === 0) return [x, y];
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export function normAngle(r: number): number {
  const t = Math.PI * 2;
  const a = ((r % t) + t) % t;
  return a < 1e-9 || t - a < 1e-9 ? 0 : a;
}

/** Excalidraw box (x, y = unrotated top-left, rotation about the centre) from a tldraw box (rotation about the origin). */
export function boxFrom(t: Transform, w: number, h: number): { x: number; y: number; angle: number } {
  const [cx, cy] = rotate(w / 2, h / 2, t.rotation);
  return {
    x: round(t.x + cx - w / 2),
    y: round(t.y + cy - h / 2),
    angle: normAngle(t.rotation),
  };
}

/** Page point of a shape-local point. */
export function toPage(t: Transform, x: number, y: number): ExPoint {
  const [rx, ry] = rotate(x, y, t.rotation);
  return [t.x + rx, t.y + ry];
}

/** Excalidraw linear-element placement from absolute points: origin at the first point. */
export function linearFrom(abs: ExPoint[]): { x: number; y: number; width: number; height: number; points: ExPoint[] } {
  const pts = abs.length > 0 ? abs : [[0, 0] as ExPoint];
  const [ox, oy] = pts[0];
  const points = pts.map(([x, y]) => [round(x - ox), round(y - oy)] as ExPoint);
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: round(ox), y: round(oy), width: round(maxX - minX), height: round(maxY - minY), points };
}

/** Unit-box vertices for the geo kinds Excalidraw draws as closed lines. */
export function polygonFor(geo: string): ExPoint[] | null {
  const regular = (n: number, start: number): ExPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const a = start + (i * Math.PI * 2) / n;
      return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as ExPoint;
    });
  switch (geo) {
    case "triangle":
      return [[0.5, 0], [1, 1], [0, 1]];
    case "trapezoid":
      return [[0.25, 0], [0.75, 0], [1, 1], [0, 1]];
    case "rhombus":
      return [[0.25, 0], [1, 0], [0.75, 1], [0, 1]];
    case "rhombus-2":
      return [[0, 0], [0.75, 0], [1, 1], [0.25, 1]];
    case "pentagon":
      return regular(5, -Math.PI / 2);
    case "hexagon":
      return [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
    case "octagon":
      return regular(8, -Math.PI / 2 + Math.PI / 8);
    case "star":
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 0.5 : 0.2;
        return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as ExPoint;
      });
    case "arrow-right":
      return [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]];
    case "arrow-left":
      return [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]];
    case "arrow-up":
      return [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]];
    case "arrow-down":
      return [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]];
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Draw-stroke points. Older tldraw stores `segments[].points` as `{x,y,z}`
// arrays; tldraw 4.5 (draw schema v4, highlight v3) stores `segments[].path`.

export function decodeBase64(s: string): Uint8Array | null {
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = s.replace(/[\s=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = ABC.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function float16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/**
 * Points of a base64 `path` (tldraw 4.5 `b64Vecs`): the first point as three
 * little-endian float32 (x, y, z), then each following point as three
 * float16 deltas from the previous one. Null when the bytes don't fit that
 * layout or decode to non-finite numbers.
 */
export function decodeDrawPath(path: string): { x: number; y: number; z: number }[] | null {
  if (path === "") return [];
  const bytes = decodeBase64(path);
  if (!bytes || bytes.length < 12 || (bytes.length - 12) % 6 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let x = view.getFloat32(0, true);
  let y = view.getFloat32(4, true);
  let z = view.getFloat32(8, true);
  const out = [{ x, y, z }];
  for (let i = 12; i < bytes.length; i += 6) {
    x += float16(view.getUint16(i, true));
    y += float16(view.getUint16(i + 2, true));
    z += float16(view.getUint16(i + 4, true));
    out.push({ x, y, z });
  }
  return out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) ? out : null;
}

export function segmentPoints(seg: unknown): { x: number; y: number; z: number }[] | null {
  if (!isObj(seg)) return null;
  if (Array.isArray(seg.points)) {
    return seg.points.filter(isObj).map((p) => ({ x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0.5) }));
  }
  if (typeof seg.path === "string") return decodeDrawPath(seg.path);
  return null;
}

// ---------------------------------------------------------------------------
// Ids and seeds.

/** FNV-1a 32-bit — a deterministic seed from an id. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2147483647 || 1;
}

/** Excalidraw id of a tldraw id: the `shape:` / `asset:` prefix is dropped. */
export function excalidrawIdOf(tldrawId: string): string {
  return tldrawId.replace(/^(shape|asset):/, "");
}

/** The point at fraction `t` (0..1) of a polyline's length. */
export function pointAlong(pts: ExPoint[], t: number): ExPoint {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = Math.min(1, Math.max(0, t)) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? Math.min(1, left / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    left -= lens[i];
  }
  return pts[0];
}

export function boundsOf(list: ExcalidrawElement[]): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const el of list) {
    if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
      for (const [px] of el.points) {
        minX = Math.min(minX, el.x + px);
        maxX = Math.max(maxX, el.x + px);
      }
    } else {
      // Rotated about the centre: the horizontal half-extent of the rotated box.
      const half = (Math.abs(el.width * Math.cos(el.angle)) + Math.abs(el.height * Math.sin(el.angle))) / 2;
      const cx = el.x + el.width / 2;
      minX = Math.min(minX, cx - half);
      maxX = Math.max(maxX, cx + half);
    }
  }
  return { minX: Number.isFinite(minX) ? minX : 0, maxX: Number.isFinite(maxX) ? maxX : 0 };
}
