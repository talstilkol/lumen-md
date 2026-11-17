/**
 * Drawing one basemap tile on a 2D canvas (plan W13.G3): the Protomaps
 * basemap layers (earth, water, landuse, landcover, roads, boundaries,
 * buildings, places) in a light or dark palette, and the place labels in
 * the UI's language (`name:he`, else `name`, else `name:en`).
 *
 * Why Canvas 2D: the browser shapes and orders the text itself, so Hebrew
 * and Arabic labels come out right without MapLibre's RTL text plugin (which
 * WebGL glyph rendering needs). Each label's direction is its first strong
 * letter; a mixed label keeps its parts in order (the canvas runs the bidi
 * algorithm with that direction).
 */
import { GeomType, type Feature, type Layer } from "./mvt";

export interface Palette {
  earth: string;
  water: string;
  park: string;
  urban: string;
  building: string;
  road: string;
  roadCasing: string;
  highway: string;
  boundary: string;
  label: string;
  halo: string;
}

export const LIGHT: Palette = { earth: "#f3f0ea", water: "#a9cbe6", park: "#d5e8c4", urban: "#ebe6de", building: "#ddd6cc", road: "#ffffff", roadCasing: "#d3cdc3", highway: "#f6d48b", boundary: "#9a8fa6", label: "#2b2b2b", halo: "rgba(255,255,255,0.9)" };
export const DARK: Palette = { earth: "#22252b", water: "#1d3247", park: "#26362a", urban: "#2a2c31", building: "#33363c", road: "#3c4048", roadCasing: "#2a2d33", highway: "#6b5a33", boundary: "#7d7290", label: "#e8e8e8", halo: "rgba(0,0,0,0.75)" };

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;

/** A label's direction: its first strong letter. */
export function labelDir(text: string): "rtl" | "ltr" {
  for (const ch of text) if (LETTER.test(ch)) return RTL_LETTER.test(ch) ? "rtl" : "ltr";
  return "ltr";
}

/** The name to show for a feature in this language. */
export function labelOf(p: Feature["properties"], lang: string): string | null {
  for (const k of [`name:${lang}`, "name", "name:en"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const ORDER = ["earth", "landcover", "landuse", "water", "buildings", "boundaries", "roads", "transit"];

function path(ctx: CanvasRenderingContext2D, f: Feature, s: number, close: boolean) {
  ctx.beginPath();
  for (const part of f.geometry) {
    ctx.moveTo(part[0] * s, part[1] * s);
    for (let i = 2; i < part.length; i += 2) ctx.lineTo(part[i] * s, part[i + 1] * s);
    if (close) ctx.closePath();
  }
}

const isPark = (k: unknown) => typeof k === "string" && /park|forest|wood|grass|nature|garden|farmland|meadow|cemetery/.test(k);

export interface DrawnLabel {
  text: string;
  dir: "rtl" | "ltr";
  x: number;
  y: number;
}

/**
 * Draw `layers` into a size × size area of `ctx` at (0, 0). Returns the
 * labels drawn (for tests and screen-reader summaries).
 */
export function drawTile(ctx: CanvasRenderingContext2D, layers: readonly Layer[], size: number, opts: { lang: string; palette?: Palette; zoom: number }): DrawnLabel[] {
  const pal = opts.palette ?? LIGHT;
  ctx.save();
  ctx.fillStyle = pal.earth;
  ctx.fillRect(0, 0, size, size);
  const byName = new Map(layers.map((l) => [l.name, l]));
  for (const name of ORDER) {
    const l = byName.get(name);
    if (!l) continue;
    const s = size / l.extent;
    for (const f of l.features) {
      if (f.type === GeomType.Polygon) {
        const kind = f.properties.kind ?? f.properties.pmap_kind;
        ctx.fillStyle = name === "water" ? pal.water : name === "buildings" ? pal.building : name === "earth" ? pal.earth : isPark(kind) ? pal.park : pal.urban;
        path(ctx, f, s, true);
        ctx.fill("evenodd");
      } else if (f.type === GeomType.Line) {
        const kind = String(f.properties.kind ?? f.properties.pmap_kind ?? "");
        if (name === "boundaries") {
          ctx.strokeStyle = pal.boundary;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          path(ctx, f, s, false);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (name === "water") {
          ctx.strokeStyle = pal.water;
          ctx.lineWidth = 1.5;
          path(ctx, f, s, false);
          ctx.stroke();
        } else if (name === "roads" || name === "transit") {
          const major = /highway|motorway|trunk|major_road|primary/.test(kind);
          const w = major ? Math.max(2, opts.zoom - 7) : Math.max(1, opts.zoom - 11);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = pal.roadCasing;
          ctx.lineWidth = w + 1.5;
          path(ctx, f, s, false);
          ctx.stroke();
          ctx.strokeStyle = major ? pal.highway : pal.road;
          ctx.lineWidth = w;
          ctx.stroke();
        }
      }
    }
  }
  // Labels last, biggest places first, no two overlapping.
  const labels: DrawnLabel[] = [];
  const places = byName.get("places");
  if (places) {
    const s = size / places.extent;
    const boxes: Array<[number, number, number, number]> = [];
    const ranked = places.features
      .filter((f) => f.type === GeomType.Point && f.geometry[0]?.length >= 2)
      .map((f) => ({ f, rank: Number(f.properties.min_zoom ?? f.properties["pmap:min_zoom"] ?? 10) - (f.properties.kind === "country" ? 5 : f.properties.kind === "region" ? 2 : 0) }))
      .sort((a, b) => a.rank - b.rank);
    for (const { f } of ranked) {
      const text = labelOf(f.properties, opts.lang);
      if (!text) continue;
      const x = f.geometry[0][0] * s;
      const y = f.geometry[0][1] * s;
      if (x < 0 || y < 0 || x > size || y > size) continue;
      const big = f.properties.kind === "country" || f.properties.kind === "region";
      const px = big ? 13 : f.properties.kind === "locality" ? 12 : 11;
      ctx.font = `${big ? 600 : 500} ${px}px system-ui, "Noto Sans Hebrew", "Noto Sans Arabic", sans-serif`;
      const dir = labelDir(text);
      ctx.direction = dir;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(text).width;
      const box: [number, number, number, number] = [x - w / 2 - 2, y - px / 2 - 2, x + w / 2 + 2, y + px / 2 + 2];
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.halo;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = pal.label;
      ctx.fillText(text, x, y);
      labels.push({ text, dir, x, y });
    }
  }
  ctx.restore();
  return labels;
}
