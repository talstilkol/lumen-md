/**
 * The summary eval's scoring and report (plan 6.11, W10.C9), kept apart from
 * summarize.eval.ts so it is unit-tested without a model.
 *
 * Per document: grounded sentences (the quoteContained check, before
 * dropping), key-word coverage, and ROUGE-L / ROUGE-Lsum F1 against the
 * set's reference summary. Only model summaries count toward the headline
 * numbers; a document that fell back to the extractive layer is listed but
 * not averaged, because extractive sentences are copied from the document and
 * would inflate both grounding and ROUGE.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasHebrew } from "../../../src/text/hebrew";
import { meanRouge, rougeL, rougeLsum, type RougeScore } from "./rouge";

export interface SummaryItem {
  id: string;
  document: string;
  reference?: string;
  keywords?: string[];
}

export interface SummaryRow {
  id: string;
  engine: string;
  produced: number;
  grounded: number;
  keywords: string;
  ms: number;
  /** ROUGE-L F1 against the reference; null when the item has no reference. */
  rougeL: number | null;
  rougeLsum: number | null;
}

/**
 * Every item of a split folder: sotu.json when it is there (the committed
 * set), else every *.json in the folder that holds an `items` list (a
 * HebSummaries split built on the Mac, W11.O4).
 */
export function loadSplit(dir: string): SummaryItem[] {
  const files = existsSync(join(dir, "sotu.json")) ? ["sotu.json"] : readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort();
  const out: SummaryItem[] = [];
  for (const f of files) {
    const set = JSON.parse(readFileSync(join(dir, f), "utf8")) as { items?: SummaryItem[] };
    if (Array.isArray(set.items)) out.push(...set.items);
  }
  if (!out.length) throw new Error(`${dir}: no items (expected sotu.json or *.json with an items list)`);
  return out;
}

/** Score one model summary against its item. Hebrew references get the one-letter prefix rule. */
export function scoreSummary(item: SummaryItem, summary: string): { keywords: string; rougeL: number | null; rougeLsum: number | null } {
  const text = summary.toLowerCase();
  const kws = item.keywords ?? [];
  const kw = kws.filter((k) => text.includes(k.toLowerCase())).length;
  if (!item.reference?.trim()) return { keywords: `${kw}/${kws.length}`, rougeL: null, rougeLsum: null };
  const opts = { hebrewPrefixes: hasHebrew(item.reference) };
  return { keywords: `${kw}/${kws.length}`, rougeL: rougeL(summary, item.reference, opts).f1, rougeLsum: rougeLsum(summary, item.reference, opts).f1 };
}

export interface SummaryTotals {
  documents: number;
  modelDocuments: number;
  produced: number;
  grounded: number;
  groundedShare: number;
  /** Mean ROUGE-L F1 over model summaries that have a reference. */
  rougeL: number | null;
  rougeLsum: number | null;
  rougeScored: number;
}

export function summaryTotals(rows: SummaryRow[]): SummaryTotals {
  const model = rows.filter((r) => r.engine !== "extractive");
  const produced = model.reduce((a, r) => a + r.produced, 0);
  const grounded = model.reduce((a, r) => a + r.grounded, 0);
  const withRef = model.filter((r) => r.rougeL !== null);
  const asScore = (v: number): RougeScore => ({ precision: 0, recall: 0, f1: v });
  return {
    documents: rows.length,
    modelDocuments: model.length,
    produced,
    grounded,
    groundedShare: produced ? grounded / produced : 0,
    rougeL: withRef.length ? meanRouge(withRef.map((r) => asScore(r.rougeL!))).f1 : null,
    rougeLsum: withRef.length ? meanRouge(withRef.map((r) => asScore(r.rougeLsum!))).f1 : null,
    rougeScored: withRef.length,
  };
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);
const f3 = (v: number | null) => (v === null ? "—" : v.toFixed(3));

export function summaryMarkdown(model: string, date: string, rows: SummaryRow[]): string {
  const t = summaryTotals(rows);
  return [
    `# Summary eval — ${model}, ${date}`,
    "",
    `Grounded sentences (model summaries, before dropping): **${t.grounded} / ${t.produced} (${pct(t.groundedShare)})** — target ≥ 95 % (plan 6.11).`,
    `ROUGE-L F1 against the reference (mean of ${t.rougeScored} model summaries): **${f3(t.rougeL)}**; ROUGE-Lsum F1: **${f3(t.rougeLsum)}**. Hebrew references are compared with one leading one-letter prefix removed (rouge.ts).`,
    `Documents the model summarised: ${t.modelDocuments} / ${t.documents} (the rest fell back to the extractive layer and are not counted).`,
    "",
    "| id | engine | grounded | key words | ROUGE-L | ROUGE-Lsum | s |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.engine} | ${r.grounded}/${r.produced} | ${r.keywords} | ${f3(r.rougeL)} | ${f3(r.rougeLsum)} | ${(r.ms / 1000).toFixed(1)} |`),
  ].join("\n");
}
