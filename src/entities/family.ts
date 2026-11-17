/**
 * The family tree of person entities (plan W13.G7): parents, children and
 * spouses from the entity graph's `child` and `spouse` edges, and the
 * three charts genealogy tools draw (topola's set) — ancestors (pedigree),
 * descendants, and the hourglass (both around one person).
 *
 * Layout in slots: a row per generation (ancestors above, descendants
 * below), a box per person, parents centred over their child, children
 * spread under their parent, spouses beside the person in a descendants
 * chart. A person reached twice (cousins who married, pedigree collapse) is
 * drawn once, where first met. Right to left, the chart is mirrored: the
 * first parent and the first child sit on the right, as Hebrew charts read.
 *
 * Pure: the view (ui/FamilyTreeView.tsx) draws the boxes and links.
 */
import type { Edge } from "./model";
import { gematria } from "../daily/gematria";
import type { ExportPerson } from "./gedcom";

export interface FamilyPerson {
  id: string;
  name: string;
  sex?: string;
  born?: string;
  died?: string;
}

export interface Family {
  persons: Map<string, FamilyPerson>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  spouses: Map<string, string[]>;
}

/** The year to show: Gregorian as digits, a Hebrew-calendar date (GEDCOM HEBREW / @#DHEBREW@) in Hebrew numerals (5665 → תרס״ה). */
const yearOf = (v: unknown): string | undefined => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string" || !v.trim()) return undefined;
  const y = /\b(\d{3,4})\b/.exec(v)?.[1];
  if (y && /HEBREW/i.test(v)) return gematria(Number(y) % 1000);
  return y ?? v.trim();
};

export function buildFamily(people: readonly ExportPerson[], edges: readonly Edge[]): Family {
  const persons = new Map<string, FamilyPerson>();
  for (const p of people) {
    const pr = p.props ?? {};
    persons.set(p.entity.id, { id: p.entity.id, name: p.entity.name, ...(typeof pr.sex === "string" ? { sex: pr.sex.toUpperCase() } : {}), ...(yearOf(pr.born) ? { born: yearOf(pr.born) } : {}), ...(yearOf(pr.died) ? { died: yearOf(pr.died) } : {}) });
  }
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const l = m.get(k) ?? m.set(k, []).get(k)!;
    if (!l.includes(v)) l.push(v);
  };
  for (const e of edges) {
    if (e.status !== "approved" || !persons.has(e.subject) || !persons.has(e.object) || e.subject === e.object) continue;
    if (e.predicate === "child") (push(children, e.subject, e.object), push(parents, e.object, e.subject));
    else if (e.predicate === "spouse") (push(spouses, e.subject, e.object), push(spouses, e.object, e.subject));
  }
  // Fathers first, then by birth year, then by name: a stable, readable order.
  const byOrder = (a: string, b: string) => {
    const pa = persons.get(a)!, pb = persons.get(b)!;
    return Number(pb.sex === "M") - Number(pa.sex === "M") || (pa.born ?? "9999").localeCompare(pb.born ?? "9999") || pa.name.localeCompare(pb.name);
  };
  for (const m of [parents, children, spouses]) for (const l of m.values()) l.sort(byOrder);
  return { persons, parents, children, spouses };
}

export type ChartMode = "ancestors" | "descendants" | "hourglass";

export interface ChartBox {
  id: string;
  /** Slot column (0..) and generation (negative: ancestors). */
  col: number;
  gen: number;
  /** In a descendants chart, a spouse drawn beside its partner. */
  spouseOf?: string;
}

export interface ChartLink {
  from: string;
  to: string;
  kind: "parent" | "spouse";
}

export interface Chart {
  boxes: ChartBox[];
  links: ChartLink[];
  cols: number;
  minGen: number;
  maxGen: number;
}

/** The chart around `focus`: up to `depth` generations each way the mode asks for. */
export function layoutChart(fam: Family, focus: string, mode: ChartMode, depth: number): Chart {
  const boxes = new Map<string, ChartBox>();
  const links: ChartLink[] = [];
  if (!fam.persons.has(focus)) return { boxes: [], links, cols: 0, minGen: 0, maxGen: 0 };
  const up = mode !== "descendants";
  const down = mode !== "ancestors";

  // Descendants: widths first (a person and their spouses side by side, children spread below).
  const dw = new Map<string, number>();
  const seenD = new Set<string>();
  const descWidth = (id: string, d: number): number => {
    if (seenD.has(id)) return 0;
    seenD.add(id);
    const sp = (fam.spouses.get(id) ?? []).filter((s) => !seenD.has(s));
    sp.forEach((s) => seenD.add(s));
    const kids = d > 0 ? (fam.children.get(id) ?? []).filter((c) => !seenD.has(c)) : [];
    const sum = kids.reduce((n, c) => n + descWidth(c, d - 1), 0);
    const w = Math.max(1 + sp.length, sum, 1);
    dw.set(id, w);
    return w;
  };
  const placeDesc = (id: string, d: number, gen: number, start: number) => {
    if (boxes.has(id) || !dw.has(id)) return;
    const w = dw.get(id)!;
    const sp = (fam.spouses.get(id) ?? []).filter((s) => !boxes.has(s) && s !== focus);
    const own = 1 + sp.length;
    const left = start + Math.floor((w - Math.min(w, own)) / 2);
    boxes.set(id, { id, col: left, gen });
    sp.forEach((s, k) => {
      if (boxes.has(s)) return;
      boxes.set(s, { id: s, col: left + 1 + k, gen, spouseOf: id });
      links.push({ from: id, to: s, kind: "spouse" });
    });
    if (d <= 0) return;
    let at = start;
    for (const c of fam.children.get(id) ?? []) {
      if (boxes.has(c) || !dw.has(c)) continue;
      placeDesc(c, d - 1, gen + 1, at);
      links.push({ from: id, to: c, kind: "parent" });
      at += dw.get(c)!;
    }
  };

  // Ancestors: widths by parents, each parent over its share.
  const aw = new Map<string, number>();
  const seenA = new Set<string>();
  const ancWidth = (id: string, d: number): number => {
    if (seenA.has(id)) return 0;
    seenA.add(id);
    const ps = d > 0 ? (fam.parents.get(id) ?? []) : [];
    const sum = ps.reduce((n, p) => n + ancWidth(p, d - 1), 0);
    const w = Math.max(1, sum);
    aw.set(id, w);
    return w;
  };
  const placeAnc = (id: string, d: number, gen: number, start: number) => {
    const w = aw.get(id) ?? 1;
    if (!boxes.has(id)) boxes.set(id, { id, col: start + (w - 1) / 2, gen });
    if (d <= 0) return;
    let at = start;
    for (const p of fam.parents.get(id) ?? []) {
      if (!aw.has(p) || boxes.has(p)) continue;
      placeAnc(p, d - 1, gen - 1, at);
      links.push({ from: p, to: id, kind: "parent" });
      at += aw.get(p)!;
    }
  };

  const dW = down ? descWidth(focus, depth) : 1;
  const aW = up ? ancWidth(focus, depth) : 1;
  const width = Math.max(dW, aW);
  // Centre both halves on the focus.
  if (down) placeDesc(focus, depth, 0, (width - dW) / 2);
  const focusCol = boxes.get(focus)?.col ?? (width - 1) / 2;
  if (up) {
    const shift = focusCol - (aW - 1) / 2;
    const keep = boxes.get(focus);
    boxes.delete(focus);
    placeAnc(focus, depth, 0, shift);
    if (keep) boxes.set(focus, keep);
  }
  // Normalise columns to start at 0.
  const all = [...boxes.values()];
  const min = Math.min(...all.map((b) => b.col));
  for (const b of all) b.col -= min;
  const gens = all.map((b) => b.gen);
  return { boxes: all, links, cols: Math.max(...all.map((b) => b.col)) + 1, minGen: Math.min(...gens), maxGen: Math.max(...gens) };
}

/** Life years "1900–1980", "1900–", "–1980" or "". */
export const lifeYears = (p: FamilyPerson): string => (p.born || p.died ? `${p.born ?? ""}–${p.died ?? ""}` : "");
