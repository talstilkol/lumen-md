/**
 * The graph view as a picture or a Gephi file (plan W13.G12): what is on
 * screen now — the visible nodes at their laid-out positions, in their
 * colours and sizes, with their labels — as
 *
 * - SVG: one `<circle>` per node, one `<line>` per link, one `<text>` per
 *   label. A label runs in its own direction (`direction` + `unicode-bidi:
 *   plaintext`, from its first strong character), so a Hebrew name with an
 *   English word and a number reads as it does on the canvas; it is never
 *   cut inside a grapheme (niqqud stays on its letter). The file has a
 *   `<title>` and `<desc>` (the W13.G11 sentence) and `xml:lang`, so it is
 *   accessible where it is pasted (a slide, a web page).
 * - PNG: the SVG drawn on a canvas at 2× (`svgToPng`, browser only).
 * - GEXF 1.3 (gexf.net), with the viz extension for position, colour and
 *   size, and typed attributes for nodes (kind, plus the caller's) and edges
 *   (relation, plus the caller's): what Gephi and Gephi Lite open.
 *
 * Pure apart from `svgToPng`; nothing leaves the device (the host downloads
 * the file).
 */

import { graphemes, labelDirection as labelDir, prepareLabel } from "./labels";

export type Rgba = readonly [number, number, number, number];

export interface SceneNode {
  id: string;
  label: string;
  x: number;
  y: number;
  /** 0..1 floats, as the renderer takes them. */
  color: Rgba;
  /** Radius in layout units. */
  size: number;
  kind?: string;
  /** Extra GEXF attributes (wikidata, aliases…). */
  attrs?: Record<string, string | number | boolean>;
}

export interface SceneEdge {
  source: string;
  target: string;
  relation?: string;
  /** Extra GEXF attributes (confidence, note, quote…). */
  attrs?: Record<string, string | number | boolean>;
}

export interface Scene {
  title: string;
  /** A sentence about the graph (W13.G11), for the SVG's <desc> and GEXF's <description>. */
  description?: string;
  lang?: string;
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
  /** Colours of links and labels, and the background (null = transparent). */
  edgeColor?: Rgba;
  labelColor?: Rgba;
  background?: Rgba | null;
}

/** The label's direction: G2's rule (first strong character; digits alone read left to right). */
export function labelDirection(s: string): "rtl" | "ltr" {
  return labelDir(s, "ltr");
}

/** At most `max` graphemes, with "…" when cut: never splits a letter from its niqqud or an emoji. */
export function clipGraphemes(s: string, max: number): string {
  const parts = graphemes(s);
  return parts.length > max ? parts.slice(0, max - 1).join("").trimEnd() + "…" : s;
}

/** Unpaired UTF-16 surrogates are not XML characters (nor UTF-8): U+FFFD in their place. */
const loneSurrogates = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
/** Text content: escaped, with the characters XML 1.0 forbids removed. */
const xml = (s: string) => loneSurrogates(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
/** An attribute value: as `xml`, and a newline, return or tab as a character reference — a parser turns a literal one into a space (XML 1.0 §3.3.3). */
const attr = (s: string) => xml(s).replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
const css = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)}${c[3] < 1 ? ` / ${+c[3].toFixed(3)}` : ""})`;
/** A coordinate: a finite number, 2 decimals (Infinity or NaN from a broken layout would make the file invalid). */
const num = (v: number) => (Number.isFinite(v) ? +v.toFixed(2) : 0);

export interface SvgOptions {
  /** Output width in px; the height follows the layout's aspect ratio. */
  width?: number;
  margin?: number;
  /** Labels longer than this many graphemes are cut. */
  maxLabel?: number;
  /** Draw every label (default), or only for the biggest `labels` nodes. */
  labels?: number;
}

export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const width = opts.width ?? 1600;
  const margin = opts.margin ?? 48;
  const maxLabel = opts.maxLabel ?? 40;
  const uiDir = /^(he|iw|ar|fa|ur|yi)\b/i.test(scene.lang ?? "") ? "rtl" : "ltr";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of scene.nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.size)) continue;
    minX = Math.min(minX, n.x - n.size);
    maxX = Math.max(maxX, n.x + n.size);
    minY = Math.min(minY, n.y - n.size);
    maxY = Math.max(maxY, n.y + n.size);
  }
  if (!Number.isFinite(minX)) minX = minY = 0, maxX = maxY = 1;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const k = (width - 2 * margin) / Math.max(spanX, spanY * 0.5);
  const height = Math.max(240, Math.round(spanY * k + 2 * margin));
  const ox = (width - spanX * k) / 2;
  const oy = (height - spanY * k) / 2;
  const P = (n: SceneNode) => ({ x: num(ox + (n.x - minX) * k), y: num(oy + (n.y - minY) * k), r: num(Math.max(2, Math.min(24, n.size * k * 0.4 + 2))) });
  const pos = new Map(scene.nodes.map((n) => [n.id, P(n)]));
  const labelled = new Set(opts.labels === undefined ? scene.nodes.map((n) => n.id) : [...scene.nodes].sort((a, b) => b.size - a.size).slice(0, opts.labels).map((n) => n.id));
  const edge = scene.edgeColor ?? [0.45, 0.5, 0.58, 0.35];
  const label = scene.labelColor ?? [0.07, 0.09, 0.15, 1];
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d"${scene.lang ? ` xml:lang="${xml(scene.lang)}" lang="${xml(scene.lang)}"` : ""}>`);
  out.push(`<title id="t">${xml(scene.title)}</title>`);
  out.push(`<desc id="d">${xml(scene.description ?? "")}</desc>`);
  out.push(`<style>text{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Hebrew","Arial Hebrew",sans-serif;font-size:12px;unicode-bidi:plaintext;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}</style>`);
  if (scene.background) out.push(`<rect width="100%" height="100%" fill="${css(scene.background)}"/>`);
  out.push(`<g stroke="${css(edge)}" stroke-width="1" fill="none">`);
  for (const e of scene.edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (!a || !b) continue;
    out.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"${e.relation ? ` data-relation="${xml(e.relation)}"` : ""}/>`);
  }
  out.push(`</g>`);
  out.push(`<g>`);
  for (const n of scene.nodes) {
    const p = pos.get(n.id)!;
    out.push(`<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${css(n.color)}" data-id="${xml(n.id)}"><title>${xml(n.label)}</title></circle>`);
  }
  out.push(`</g>`);
  out.push(`<g fill="${css(label)}" text-anchor="middle">`);
  for (const n of scene.nodes) {
    if (!labelled.has(n.id)) continue;
    const p = pos.get(n.id)!;
    // G2's labels (audit r4 A3 #2): FSI … PDI around runs in the other direction, so "C++" is not drawn "++C".
    const l = prepareLabel(n.label, { maxGraphemes: maxLabel, fallback: uiDir });
    out.push(`<text x="${p.x}" y="${num(p.y - p.r - 3)}" direction="${l.dir}" style="direction:${l.dir}">${xml(l.text)}</text>`);
  }
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

/** The SVG drawn at `scale`× as a PNG (browser only: needs Image and a canvas). */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("svg did not decode"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("png encode failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

type AttrType = "string" | "double" | "boolean" | "integer";
const typeOf = (v: string | number | boolean): AttrType => (typeof v === "boolean" ? "boolean" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "double") : "string");

function attrTable(items: ReadonlyArray<{ attrs?: Record<string, string | number | boolean> }>, fixed: Record<string, AttrType>): Array<{ id: string; type: AttrType }> {
  const types = new Map<string, AttrType>(Object.entries(fixed));
  for (const it of items)
    for (const [k, v] of Object.entries(it.attrs ?? {})) {
      if (!usable(v)) continue;
      const t = typeOf(v);
      const had = types.get(k);
      types.set(k, !had || had === t ? t : had === "integer" && t === "double" ? "double" : had === "double" && t === "integer" ? "double" : "string");
    }
  return [...types].map(([id, type]) => ({ id, type }));
}

/** Infinity and NaN are not GEXF integers or doubles: such a value is left out. */
const usable = (v: string | number | boolean | undefined) => v !== undefined && v !== "" && (typeof v !== "number" || Number.isFinite(v));
const fmt = (v: string | number | boolean) => (typeof v === "number" ? String(+v.toFixed(6)) : String(v));

/** GEXF 1.3 with viz:position/color/size, node and edge attributes. `date` is the meta's lastmodifieddate (YYYY-MM-DD). */
export function sceneToGexf(scene: Scene, date = new Date().toISOString().slice(0, 10)): string {
  const nodeAttrs = attrTable(scene.nodes, scene.nodes.some((n) => n.kind) ? { kind: "string" } : {});
  const edgeAttrs = attrTable(scene.edges, scene.edges.some((e) => e.relation) ? { relation: "string" } : {});
  const ids = new Set(scene.nodes.map((n) => n.id));
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://gexf.net/1.3 http://gexf.net/1.3/gexf.xsd" version="1.3">`);
  out.push(`  <meta lastmodifieddate="${date}">`);
  out.push(`    <creator>Lumen</creator>`);
  out.push(`    <title>${xml(scene.title)}</title>`);
  if (scene.description) out.push(`    <description>${xml(scene.description)}</description>`);
  out.push(`  </meta>`);
  out.push(`  <graph defaultedgetype="directed" mode="static">`);
  const decl = (cls: "node" | "edge", list: Array<{ id: string; type: AttrType }>) => {
    if (!list.length) return;
    out.push(`    <attributes class="${cls}">`);
    list.forEach((a, i) => out.push(`      <attribute id="${cls[0]}${i}" title="${attr(a.id)}" type="${a.type}"/>`));
    out.push(`    </attributes>`);
  };
  decl("node", nodeAttrs);
  decl("edge", edgeAttrs);
  const values = (cls: "n" | "e", list: Array<{ id: string }>, v: Record<string, string | number | boolean | undefined>) => {
    const vals = list.map((a, i) => [i, v[a.id]] as const).filter(([, x]) => usable(x));
    if (!vals.length) return [];
    return [`        <attvalues>`, ...vals.map(([i, x]) => `          <attvalue for="${cls}${i}" value="${attr(fmt(x!))}"/>`), `        </attvalues>`];
  };
  out.push(`    <nodes>`);
  for (const n of scene.nodes) {
    out.push(`      <node id="${attr(n.id)}" label="${attr(n.label)}">`);
    out.push(...values("n", nodeAttrs, { kind: n.kind, ...n.attrs }));
    const [r, g, b, a] = n.color;
    out.push(`        <viz:color r="${Math.round(r * 255)}" g="${Math.round(g * 255)}" b="${Math.round(b * 255)}" a="${Number.isFinite(a) ? +a.toFixed(3) : 1}"/>`);
    out.push(`        <viz:position x="${num(n.x)}" y="${num(-n.y)}" z="0"/>`);
    out.push(`        <viz:size value="${num(n.size)}"/>`);
    out.push(`      </node>`);
  }
  out.push(`    </nodes>`);
  out.push(`    <edges>`);
  scene.edges.forEach((e, i) => {
    if (!ids.has(e.source) || !ids.has(e.target)) return;
    const body = values("e", edgeAttrs, { relation: e.relation, ...e.attrs });
    const open = `      <edge id="e${i}" source="${attr(e.source)}" target="${attr(e.target)}"${e.relation ? ` label="${attr(e.relation)}"` : ""}`;
    if (!body.length) out.push(`${open}/>`);
    else out.push(`${open}>`, ...body, `      </edge>`);
  });
  out.push(`    </edges>`);
  out.push(`  </graph>`);
  out.push(`</gexf>`);
  return out.join("\n") + "\n";
}
