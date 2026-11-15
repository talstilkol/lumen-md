/**
 * Analysis of Competing Hypotheses (plan R12.20) — Heuer's ACH (Psychology
 * of Intelligence Analysis, 1999, ch. 8) for an ```ach block in a note.
 *
 * Hypotheses × evidence; each cell is a mark: CC (very consistent), C,
 * N (neutral, also an empty cell), I (inconsistent), II (very inconsistent).
 * Every row has a weight (a positive whole number, default 1).
 *
 * Per hypothesis: inconsistency = Σ weight × (I → 1, II → 2) and
 * consistency = Σ weight × (C → 1, CC → 2). Hypotheses are ranked by the
 * LEAST inconsistency — evidence refutes, it does not prove — then the
 * most consistency, then the id. Also, as in Heuer's step 5–6:
 *   - a row marked the same against every hypothesis is not diagnostic;
 *   - a diagnostic row whose removal alone changes the leader is a linchpin;
 *   - rows flagged `deceptive` are taken out, to see whether the leader holds.
 *
 * The rules follow the ACH matrix of the owner's IsraelConnect project
 * (ACH-001), used as a design reference only: this is a separate
 * implementation, and the tests check that it gives the same numbers on the
 * same synthetic matrix. Pure.
 */

import { parse as parseYaml } from "yaml";

export const ACH_MARKS = ["CC", "C", "N", "I", "II"] as const;
export type AchMark = (typeof ACH_MARKS)[number];
const INCONSISTENT: Partial<Record<AchMark, number>> = { I: 1, II: 2 };
const CONSISTENT: Partial<Record<AchMark, number>> = { C: 1, CC: 2 };

export interface AchHypothesis {
  id: string;
  text: string;
}
export interface AchRow {
  id: string;
  text: string;
  weight: number;
  deceptive: boolean;
  /** Hypothesis id → mark; a missing hypothesis is N. */
  marks: Record<string, AchMark>;
}
export interface AchModel {
  title?: string;
  hypotheses: AchHypothesis[];
  rows: AchRow[];
  /** What could not be read, one line each (the block shows them). */
  problems: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A mark as written: "cc", "C", "--" (II), "-" (I), "+" (C), "++" (CC), "0" / "" (N). */
export function readMark(v: unknown): AchMark | null {
  if (v === null || v === undefined) return "N";
  const s = String(v).trim().toUpperCase();
  const alias: Record<string, AchMark> = { "++": "CC", "+": "C", "0": "N", "": "N", "-": "I", "--": "II" };
  if (s in alias) return alias[s];
  return (ACH_MARKS as readonly string[]).includes(s) ? (s as AchMark) : null;
}

/**
 * The block's YAML:
 *
 *     title: Who leaked the report?
 *     hypotheses:
 *       H1: Someone inside the ministry
 *       H2: A contractor
 *     evidence:
 *       - id: E1
 *         text: The file's metadata names a ministry laptop
 *         weight: 3
 *         marks: { H1: CC, H2: I }
 *       - id: E2
 *         text: The contractor's own blog post
 *         deceptive: true
 *         marks: { H1: N, H2: C }
 *
 * `hypotheses` may also be a list of `{id, text}`; `rows` is accepted for
 * `evidence`. Ids default to H1…, E1… in order.
 */
export function parseAch(src: string): AchModel {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(src) ?? {};
  } catch (e) {
    return { hypotheses: [], rows: [], problems: [(e as Error).message.split("\n")[0]] };
  }
  if (!isRecord(raw)) return { hypotheses: [], rows: [], problems: ["the block is a YAML map: hypotheses:, evidence:"] };
  const hypotheses: AchHypothesis[] = [];
  const seenH = new Set<string>();
  const addH = (id: string, text: string) => {
    if (seenH.has(id)) problems.push(`hypothesis ${id} twice`);
    else {
      seenH.add(id);
      hypotheses.push({ id, text });
    }
  };
  if (isRecord(raw.hypotheses)) for (const [id, text] of Object.entries(raw.hypotheses)) addH(id, String(text ?? ""));
  else if (Array.isArray(raw.hypotheses))
    raw.hypotheses.forEach((h, i) => {
      if (isRecord(h)) addH(String(h.id ?? `H${i + 1}`), String(h.text ?? ""));
      else addH(`H${i + 1}`, String(h ?? ""));
    });
  const list = Array.isArray(raw.evidence) ? raw.evidence : Array.isArray(raw.rows) ? raw.rows : [];
  const rows: AchRow[] = [];
  const seenR = new Set<string>();
  list.forEach((r, i) => {
    if (!isRecord(r)) {
      problems.push(`evidence ${i + 1}: a map with text: and marks:`);
      return;
    }
    const id = String(r.id ?? `E${i + 1}`);
    if (seenR.has(id)) {
      problems.push(`evidence ${id} twice`);
      return;
    }
    seenR.add(id);
    const w = r.weight === undefined ? 1 : Number(r.weight);
    const weight = Number.isInteger(w) && w > 0 ? w : 1;
    if (r.weight !== undefined && weight !== w) problems.push(`evidence ${id}: weight is a whole number above 0`);
    const marks: Record<string, AchMark> = {};
    if (isRecord(r.marks))
      for (const [h, m] of Object.entries(r.marks)) {
        const mark = readMark(m);
        if (!seenH.has(h)) problems.push(`evidence ${id}: no hypothesis ${h}`);
        else if (!mark) problems.push(`evidence ${id}: ${String(m)} is not one of ${ACH_MARKS.join(" ")}`);
        else marks[h] = mark;
      }
    rows.push({ id, text: String(r.text ?? ""), weight, deceptive: r.deceptive === true, marks });
  });
  return { title: typeof raw.title === "string" ? raw.title : undefined, hypotheses, rows, problems };
}

export interface AchHypothesisScore {
  id: string;
  inconsistency: number;
  consistency: number;
  rank: number;
}
export interface AchScore {
  hypotheses: AchHypothesisScore[];
  /** The least inconsistent hypothesis; null with fewer than two. */
  leader: string | null;
  /** How much more inconsistency the runner-up has. */
  margin: number | null;
  rows: Array<{ id: string; weight: number; deceptive: boolean; diagnostic: boolean }>;
  linchpins: string[];
  deception: { rows: string[]; leaderWithout: string | null; changes: boolean };
  /** Cells with no mark (counted as N). */
  unmarked: number;
}

export const markOf = (r: AchRow, h: string): AchMark => r.marks[h] ?? "N";

function ranked(hs: readonly AchHypothesis[], rows: readonly AchRow[]): AchHypothesisScore[] {
  const scored = hs.map((h) => {
    let inconsistency = 0;
    let consistency = 0;
    for (const r of rows) {
      const m = markOf(r, h.id);
      inconsistency += r.weight * (INCONSISTENT[m] ?? 0);
      consistency += r.weight * (CONSISTENT[m] ?? 0);
    }
    return { id: h.id, inconsistency, consistency, rank: 0 };
  });
  // Ids compare by code point, as the reference does.
  scored.sort((a, b) => a.inconsistency - b.inconsistency || b.consistency - a.consistency || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}

export function scoreAch(model: Pick<AchModel, "hypotheses" | "rows">): AchScore {
  const { hypotheses: hs, rows } = model;
  const many = hs.length > 1;
  const all = ranked(hs, rows);
  const leader = all[0]?.id ?? null;
  const leadOf = (use: readonly AchRow[]) => ranked(hs, use)[0]?.id ?? null;
  const diagnostic = (r: AchRow) => many && new Set(hs.map((h) => markOf(r, h.id))).size > 1;
  const linchpins = many ? rows.filter((r) => diagnostic(r) && leadOf(rows.filter((x) => x !== r)) !== leader).map((r) => r.id) : [];
  const deceptive = rows.filter((r) => r.deceptive);
  const without = deceptive.length ? leadOf(rows.filter((r) => !r.deceptive)) : leader;
  let unmarked = 0;
  for (const r of rows) for (const h of hs) if (!(h.id in r.marks)) unmarked++;
  return {
    hypotheses: all,
    leader: many ? leader : null,
    margin: all.length > 1 ? all[1].inconsistency - all[0].inconsistency : null,
    rows: rows.map((r) => ({ id: r.id, weight: r.weight, deceptive: r.deceptive, diagnostic: diagnostic(r) })),
    linchpins,
    deception: { rows: deceptive.map((r) => r.id), leaderWithout: many ? without : null, changes: many && without !== leader },
    unmarked,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The matrix as a GFM table (hypotheses in rank order), with the scores as the last two rows — "export as a table". */
export function achMarkdownTable(model: AchModel, score: AchScore, labels: { evidence: string; weight: string; inconsistency: string; consistency: string }): string {
  const byId = new Map(model.hypotheses.map((h) => [h.id, h]));
  const order = score.hypotheses.map((s) => byId.get(s.id)!);
  const head = [labels.evidence, labels.weight, ...order.map((h) => `${h.id}${h.text ? `: ${h.text}` : ""}`)];
  const lines = [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of model.rows) lines.push(`| ${[`${r.id}${r.text ? `: ${r.text}` : ""}`, String(r.weight), ...order.map((h) => markOf(r, h.id))].map(cell).join(" | ")} |`);
  lines.push(`| ${[labels.inconsistency, "", ...score.hypotheses.map((s) => String(s.inconsistency))].map(cell).join(" | ")} |`);
  lines.push(`| ${[labels.consistency, "", ...score.hypotheses.map((s) => String(s.consistency))].map(cell).join(" | ")} |`);
  return lines.join("\n");
}
