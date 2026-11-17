/**
 * R12.9 eval: the cite-or-delete gate on 30 SYNTHETIC questions
 * (eval/synthetic/cite-gate, written by gen.py, labels by construction, tag
 * `dev`). Each answer mixes two true sentences with five adversarial ones:
 * flipped polarity, a changed number, an invented claim, no marker, an
 * unread source; and the model offers invented quotes.
 *
 * The committed report (eval/cards/cite-gate.json) must be what this run
 * computes, so its numbers have a source. `LUMEN_WRITE_EVAL=1` rewrites it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { alignmentHolds } from "../agents/cite/align";
import { citeOrDelete, DEFAULT_MIN_SUPPORT } from "../agents/cite/gate";

interface Case {
  id: string;
  lang: string;
  sources: Array<{ n: number; id: string; text: string }>;
  answer: string;
  modelQuotes: Record<string, string[]>;
  units: Array<{ text: string; label: "keep" | "delete"; kind: string }>;
}
const SET = JSON.parse(readFileSync("eval/synthetic/cite-gate/cases.json", "utf8")) as { name: string; version: string; license: string; cases: Case[] };
const RESULT = "eval/cards/cite-gate.json";

/** mulberry32: a seeded generator, so the bootstrap is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PerCase {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  fabricated: number;
  units: number;
}

function runCase(c: Case): PerCase {
  const sources = c.sources.map((s) => ({ ...s, note: true }));
  const modelQuotes = new Map(Object.entries(c.modelQuotes).map(([n, q]) => [Number(n), q]));
  const r = citeOrDelete(c.answer, sources, { modelQuotes });
  const keptTexts = new Set(r.kept.map((u) => u.text));
  const out: PerCase = { tp: 0, fp: 0, fn: 0, tn: 0, fabricated: 0, units: c.units.length };
  for (const u of c.units) {
    const kept = keptTexts.has(u.text);
    if (u.label === "keep") kept ? out.tp++ : out.fn++;
    else kept ? out.fp++ : out.tn++;
  }
  // A shown quote that is not its source's slice at its offsets.
  for (const e of r.evidence) if (!alignmentHolds(e, sources.find((s) => s.n === e.n)!.text)) out.fabricated++;
  expect(r.kept.length + r.deleted.length).toBe(c.units.length);
  return out;
}

const metrics = (rows: PerCase[]) => {
  const s = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn, tn: a.tn + r.tn, fabricated: a.fabricated + r.fabricated }), { tp: 0, fp: 0, fn: 0, tn: 0, fabricated: 0 });
  return {
    keptPrecision: s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1,
    keptRecall: s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1,
    lieDeletionRate: s.fp + s.tn ? s.tn / (s.fp + s.tn) : 1,
    fabricatedQuotesShown: s.fabricated,
  };
};

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function bootstrap(rows: PerCase[], seed: number, B = 1000) {
  const rand = rng(seed);
  const draws: Record<string, number[]> = {};
  for (let b = 0; b < B; b++) {
    const sample = rows.map(() => rows[Math.floor(rand() * rows.length)]);
    for (const [k, v] of Object.entries(metrics(sample))) (draws[k] ??= []).push(v);
  }
  const ci: Record<string, [number, number]> = {};
  for (const [k, v] of Object.entries(draws)) {
    v.sort((a, b) => a - b);
    ci[k] = [r4(v[Math.floor(0.025 * B)]), r4(v[Math.ceil(0.975 * B) - 1])];
  }
  return ci;
}

describe("R12.9 eval: cite-or-delete on 30 synthetic questions", () => {
  const rows = SET.cases.map(runCase);
  const m = metrics(rows);
  const ci = bootstrap(rows, 12);

  it("the set is what the card says: 30 questions, 210 units", () => {
    expect(SET.cases).toHaveLength(30);
    expect(rows.reduce((a, r) => a + r.units, 0)).toBe(210);
  });

  it("0 shown quotes that are not in the source text (adversarial), and every lie deleted", () => {
    expect(m.fabricatedQuotesShown).toBe(0);
    expect(m.lieDeletionRate).toBe(1);
  });

  it("the committed report is what this run computes, with a complete eval card", () => {
    const card = {
      schema: 1,
      tag: "dev",
      model: { name: "none: the gate is deterministic; the answers are scripted adversarial model outputs", digest: "n/a (no model weights)" },
      seed: 12,
      temperature: 0,
      dataset: { name: SET.name, version: SET.version, license: SET.license },
      n: rows.length,
      metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: r4(v), ci95: ci[k], method: "bootstrap" }])),
    };
    const report = {
      card,
      gate: { minSupport: DEFAULT_MIN_SUPPORT },
      units: rows.reduce((a, r) => a + r.units, 0),
      perCase: SET.cases.map((c, i) => ({ id: c.id, lang: c.lang, ...rows[i] })),
      note: "SYNTHETIC set written for R12.9 (tag dev): it shows the gate's behaviour on known lies, not quality on real answers.",
    };
    if (process.env.LUMEN_WRITE_EVAL === "1") writeFileSync(RESULT, `${JSON.stringify(report, null, 1)}\n`);
    expect(JSON.parse(readFileSync(RESULT, "utf8"))).toEqual(report);
    for (const v of Object.values(card.metrics)) expect(v.ci95[0] <= v.value && v.value <= v.ci95[1]).toBe(true);
  });
});
