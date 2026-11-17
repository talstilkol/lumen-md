/**
 * The page of the Talmud (צורת הדף, W13.R11): a main text in the middle and
 * two commentaries around it — the inner one (Rashi, toward the binding)
 * and the outer one (Tosafot) — as the Vilna page sets them.
 *
 * The idea is TalmudLab's daf-renderer (MIT): every text is a layer as wide
 * as the page, and invisible floats carve each layer's text into its own
 * region, so the three layers stack without touching. The code here is
 * written for lumen-md; what differs is how the regions are found. Instead
 * of estimating each text's area, the page is cut into horizontal bands at
 * the points where a text really ends, measured by laying it out:
 *
 *  1. lead: the two commentaries open the page, each across half of it;
 *  2. gap: a breath of space before the main text starts;
 *  3. the main text in the middle, the commentaries in narrow side columns;
 *  4. when a text ends, the others widen into its space from there on:
 *     a commentary that ends lets the main text widen to that side
 *     ("extend"); a main text that ends lets the commentaries take their
 *     halves under it ("wrap").
 *
 * Each band is exact (the next one starts where a text measured its end),
 * so no two texts overlap, whatever the lengths. A band's region for a
 * text is an interval across the page, measured from the inner side; which
 * physical side is inner depends on the amud: on amud a (the front of the
 * leaf) the binding is on the right, so Rashi is on the right; on amud b,
 * on the left.
 */

export type DafSlot = "main" | "inner" | "outer";
export const DAF_SLOTS: readonly DafSlot[] = ["main", "inner", "outer"];

export interface DafGeometry {
  /** Page width, px. */
  width: number;
  /** Space between columns, px. */
  gap: number;
  /** Width of the main column while both commentaries run beside it, px. */
  main: number;
  /** Height of the lead band (the commentaries' opening lines), px. */
  lead: number;
  /** Vertical space before a text widens into a region another text left, px. */
  gapY: number;
}

export function dafGeometry(width: number, o: { commentaryLine?: number; leadLines?: number; mainShare?: number } = {}): DafGeometry {
  const gap = Math.max(8, Math.round(width * 0.025));
  const main = Math.round(width * (o.mainShare ?? 0.46));
  return { width, gap, main, lead: Math.round((o.commentaryLine ?? 20) * (o.leadLines ?? 4)), gapY: Math.round(gap / 2) };
}

/** A text's region in a band: [from, to) px across the page, from the inner side. */
export type Extent = readonly [number, number];

export interface DafBand {
  y0: number;
  /** Infinity for the band still open while measuring. */
  y1: number;
  phase: "lead" | "gap" | "body";
  extents: Partial<Record<DafSlot, Extent>>;
}

/** Where each running text goes in a band, given which texts still run. */
export function bandExtents(active: ReadonlySet<DafSlot>, phase: DafBand["phase"], g: DafGeometry): Partial<Record<DafSlot, Extent>> {
  const W = g.width;
  const half = (W - g.gap) / 2;
  const side = (W - g.main - 2 * g.gap) / 2;
  const inner = active.has("inner");
  const outer = active.has("outer");
  const main = active.has("main");
  const out: Partial<Record<DafSlot, Extent>> = {};
  if (phase === "lead") {
    if (inner) out.inner = [0, half];
    if (outer) out.outer = [W - half, W];
    return out;
  }
  if (phase === "gap") {
    if (inner) out.inner = [0, side];
    if (outer) out.outer = [W - side, W];
    return out;
  }
  if (main) {
    if (inner) out.inner = [0, side];
    if (outer) out.outer = [W - side, W];
    out.main = [inner ? side + g.gap : 0, outer ? W - side - g.gap : W];
    return out;
  }
  // The main text has ended: each commentary takes its half under it.
  if (inner) out.inner = [0, half];
  if (outer) out.outer = [W - half, W];
  return out;
}

/**
 * Where a text ends (px from the page's top) when laid out in these bands —
 * the last one open-ended. The DOM does this in the app (`measureInDom`);
 * tests give a model.
 */
export type MeasureEnd = (slot: DafSlot, bands: readonly DafBand[]) => number;

export interface DafPlan {
  bands: DafBand[];
  /** Where each text ends, px. */
  ends: Partial<Record<DafSlot, number>>;
  height: number;
}

/** Cut the page into bands at the measured ends of its texts. */
export function planDaf(present: ReadonlySet<DafSlot>, g: DafGeometry, measure: MeasureEnd): DafPlan {
  const active = new Set(present);
  const bands: DafBand[] = [];
  const ends: Partial<Record<DafSlot, number>> = {};
  const hasCommentary = active.has("inner") || active.has("outer");
  let phase: DafBand["phase"] = active.has("main") && hasCommentary ? "lead" : "body";
  let y0 = 0;
  for (let guard = 0; active.size && guard < 12; guard++) {
    const extents = bandExtents(active, phase, g);
    const open: DafBand = { y0, y1: Infinity, phase, extents };
    const probe = [...bands, open];
    let first = Infinity;
    const ended: DafSlot[] = [];
    for (const s of active) {
      if (!extents[s]) continue;
      const e = measure(s, probe);
      if (e < first - 0.5) {
        first = e;
        ended.length = 0;
        ended.push(s);
      } else if (Math.abs(e - first) <= 0.5) ended.push(s);
    }
    const limit = phase === "lead" ? g.lead : phase === "gap" ? y0 + g.gapY : Infinity;
    if (limit <= first) {
      // The lead or gap band ends before any text: the next phase starts.
      bands.push({ ...open, y1: Math.max(limit, y0) });
      y0 = Math.max(limit, y0);
      phase = phase === "lead" ? "gap" : "body";
      continue;
    }
    if (!Number.isFinite(first)) break;
    for (const s of ended) {
      ends[s] = first;
      active.delete(s);
    }
    // The others widen only after a breath of space.
    const y1 = active.size ? first + g.gapY : first;
    bands.push({ ...open, y1 });
    y0 = y1;
    // A text that ended inside the lead or gap band: go on to the body.
    if (phase !== "body") phase = phase === "lead" && y0 < g.lead ? "lead" : "body";
  }
  const height = Math.max(0, ...Object.values(ends).map((v) => v ?? 0));
  return { bands, ends, height };
}

/** The physical floats that keep a text inside its extent, band by band. */
export function floatsFor(slot: DafSlot, bands: readonly DafBand[], g: DafGeometry, innerSide: "right" | "left"): Array<{ height: number; left: number; right: number }> {
  return bands.map((b) => {
    const h = Number.isFinite(b.y1) ? b.y1 - b.y0 : 100_000;
    const ext = b.extents[slot];
    if (!ext) return { height: h, left: g.width, right: 0 };
    const [a, z] = ext;
    // From the inner side: on the right, `a` is the right float and the rest the left one.
    return innerSide === "right" ? { height: h, left: g.width - z, right: a } : { height: h, left: a, right: g.width - z };
  });
}

/** Which side the inner commentary is on: amud a (front of the leaf) → right; amud b → left. */
export function innerSideOf(amud: "a" | "b" | null | undefined): "right" | "left" {
  return amud === "b" ? "left" : "right";
}

/**
 * Lay the bands out in a container (in the page): one layer per text, its
 * floats, then its paragraphs and an end marker. Returns the end of `slot`.
 */
export function measureInDom(layer: HTMLElement, slot: DafSlot, bands: readonly DafBand[], g: DafGeometry, innerSide: "right" | "left"): number {
  applyFloats(layer, floatsFor(slot, bands, g, innerSide));
  const end = layer.querySelector<HTMLElement>(".daf-end");
  if (!end) return 0;
  const top = layer.getBoundingClientRect().top;
  const r = end.getBoundingClientRect();
  return Math.ceil(r.bottom - top);
}

/** Replace a layer's float spacers. */
export function applyFloats(layer: HTMLElement, floats: ReturnType<typeof floatsFor>): void {
  layer.querySelectorAll(":scope > .daf-float").forEach((n) => n.remove());
  const doc = layer.ownerDocument;
  const frag = doc.createDocumentFragment();
  for (const f of floats) {
    for (const side of ["left", "right"] as const) {
      const d = doc.createElement("div");
      d.className = "daf-float";
      d.setAttribute("aria-hidden", "true");
      d.style.cssText = `float:${side};clear:${side};width:${Math.max(0, f[side])}px;height:${Math.max(0, f.height)}px;`;
      frag.appendChild(d);
    }
  }
  layer.prepend(frag);
}
