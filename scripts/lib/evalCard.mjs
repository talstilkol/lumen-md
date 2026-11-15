/**
 * Plan W11.I18 — the eval honesty pack (research R4.13).
 *
 * Every eval report carries a card: what was measured, on what, by which
 * model, how often and how sure we are. `npm run eval:card` refuses a report
 * whose card is missing a field, and plan:check refuses a ✅ that rests on a
 * report tagged `dev` (a set the authors wrote or tuned on).
 *
 *   card = {
 *     schema: 1,
 *     tag: "dev" | "heldout" | "public",
 *     model: { name, digest },                 // the pinned weights (sha256 / Ollama digest)
 *     seed, temperature,                       // W7.15 reproducibility
 *     dataset: { name, version, license, source? },
 *     n,                                       // items scored
 *     metrics: { <name>: { value, ci95: [lo, hi], method: "bootstrap", judge?: "llm" } },
 *     judgeCalibration?: { kappa, humanLabels } // required when any metric is LLM-judged
 *   }
 *
 * `public` is a published split (a URL in dataset.source); `heldout` is a W6.17
 * sealed set (dataset.name is its manifest id). Everything else is `dev`.
 *
 * A synthetic dataset (dataset.origin "synthetic", or a set under
 * eval/synthetic, coordinator W7.13) is always `dev`: a card on it that says
 * heldout or public is refused, so it can never back a ✅. Which datasets are
 * synthetic is read from the repository (`isSyntheticDataset`), not from the
 * name's spelling alone.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CARD_SCHEMA = 1;
export const TAGS = Object.freeze(["dev", "heldout", "public"]);
/** Tags that may back a plain ✅. */
export const CLAIM_TAGS = Object.freeze(["heldout", "public"]);
/** LLM-as-judge is admitted only after this agreement with human labels (R4 §1.8). */
export const MIN_KAPPA = 0.6;
export const MIN_HUMAN_LABELS = 50;
/** A dod command that runs an eval: its ✅ is a quality claim and needs a card. */
export const EVAL_COMMAND = /\b(eval:[\w-]+|models:day|heldout\b|bench:[\w-]+)/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
/** What the repository says is synthetic (read once): the sets under eval/synthetic, and eval/origins.json's synthetic parts. */
let known = null;
function syntheticKnown() {
  if (known) return known;
  const dir = join(ROOT, "eval/synthetic");
  const sets = new Set(existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()) : []);
  const parts = new Set();
  const origins = readJson(join(ROOT, "eval/origins.json")) ?? {};
  for (const [section, entries] of Object.entries(origins)) {
    if (section.startsWith("$") || !isObj(entries)) continue;
    for (const [id, e] of Object.entries(entries)) if (e?.origin === "synthetic") parts.add(id.toLowerCase());
  }
  return (known = { sets, parts });
}

/**
 * A dataset name as a path inside the repository, lower case, "/"-separated and normalised (`./`, `..`, `\\`, an
 * absolute path into the checkout); null when it points outside it.
 */
function datasetPath(name) {
  const raw = String(name ?? "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  const rel = relative(ROOT, resolve(ROOT, raw)).split(sep).join("/");
  return rel.startsWith("../") || rel === ".." || isAbsolute(rel) ? null : rel.toLowerCase();
}

/**
 * A card dataset that is synthetic (W7.13; review Z6-M5: not by its name's prefix alone). Synthetic when any of:
 * its `origin` says so; its name resolves under eval/synthetic in any path form; its first segment (after an
 * `eval/<section>/` prefix) is a set under eval/synthetic (`retrieval-hard/heldout`); that set's manifest says
 * `origin: synthetic`; or eval/origins.json lists the set's part (`<set>/<part>`) as synthetic. A name the repository
 * cannot place is judged by `origin` alone.
 */
export function isSyntheticDataset(d) {
  if (!isObj(d)) return false;
  if (d.origin === "synthetic") return true;
  const rel = datasetPath(d.name);
  if (rel === null) return false;
  if (rel === "eval/synthetic" || rel.startsWith("eval/synthetic/") || rel === "synthetic" || rel.startsWith("synthetic/")) return true;
  const segs = rel.replace(/^eval\/(?:golden|synthetic|public|heldout)\//, "").split("/").filter(Boolean);
  if (!segs.length) return false;
  const { sets, parts } = syntheticKnown();
  if (sets.has(segs[0])) return true;
  for (const section of ["golden", "synthetic", "public"]) {
    if (readJson(join(ROOT, "eval", section, segs[0], "manifest.json"))?.origin === "synthetic") return true;
  }
  return segs.length > 1 && parts.has(`${segs[0]}/${segs[1]}`);
}
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Every problem with a card (empty = a complete card).
 * @param {any} card
 * @returns {string[]}
 */
export function validateCard(card) {
  const p = [];
  if (!isObj(card)) return ["card: missing (a report needs a top-level `card`)"];
  if (card.schema !== CARD_SCHEMA) p.push(`card.schema: must be ${CARD_SCHEMA}`);
  if (!TAGS.includes(card.tag)) p.push(`card.tag: must be one of ${TAGS.join(", ")}`);
  if (!isObj(card.model)) p.push("card.model: missing");
  else {
    if (!nonEmpty(card.model.name)) p.push("card.model.name: missing");
    if (!nonEmpty(card.model.digest)) p.push("card.model.digest: missing (pin the weights: sha256 or the Ollama digest)");
  }
  if (!Number.isInteger(card.seed)) p.push("card.seed: missing (an integer)");
  if (!finite(card.temperature) || card.temperature < 0) p.push("card.temperature: missing (a number ≥ 0)");
  if (!isObj(card.dataset)) p.push("card.dataset: missing");
  else {
    for (const k of ["name", "version", "license"]) if (!nonEmpty(card.dataset[k])) p.push(`card.dataset.${k}: missing`);
    if (isSyntheticDataset(card.dataset) && card.tag !== "dev") p.push(`card.tag: ${card.tag} on a synthetic dataset (${card.dataset.name}) — a synthetic set is dev only and can never back a ✅`);
    if (card.tag === "public" && !(nonEmpty(card.dataset.source) && /^https:\/\//.test(card.dataset.source))) {
      p.push("card.dataset.source: a public set names where it is published (https URL)");
    }
  }
  if (!Number.isInteger(card.n) || card.n < 1) p.push("card.n: missing (items scored, ≥ 1)");
  const metrics = isObj(card.metrics) ? Object.entries(card.metrics) : [];
  if (!metrics.length) p.push("card.metrics: missing (at least one metric)");
  let judged = false;
  for (const [name, m] of metrics) {
    if (!isObj(m) || !finite(m.value)) {
      p.push(`card.metrics.${name}.value: missing`);
      continue;
    }
    const ci = m.ci95;
    if (!Array.isArray(ci) || ci.length !== 2 || !ci.every(finite)) p.push(`card.metrics.${name}.ci95: missing (bootstrap 95% interval [lo, hi])`);
    else if (!(ci[0] <= m.value && m.value <= ci[1])) p.push(`card.metrics.${name}.ci95: [${ci}] does not contain the value ${m.value}`);
    if (m.method !== "bootstrap") p.push(`card.metrics.${name}.method: must be "bootstrap"`);
    if (m.judge === "llm") judged = true;
  }
  if (judged) {
    const c = card.judgeCalibration;
    if (!isObj(c) || !finite(c.kappa) || !Number.isInteger(c.humanLabels)) {
      p.push("card.judgeCalibration: an LLM-judged metric needs { kappa, humanLabels } against human labels");
    } else {
      if (c.humanLabels < MIN_HUMAN_LABELS) p.push(`card.judgeCalibration.humanLabels: ${c.humanLabels} < ${MIN_HUMAN_LABELS}`);
      if (c.kappa < MIN_KAPPA) p.push(`card.judgeCalibration.kappa: ${c.kappa} < ${MIN_KAPPA} — the judge is not calibrated`);
    }
  }
  return p;
}

/** A seeded PRNG (mulberry32), so a bootstrap interval is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Percentile bootstrap of a statistic over per-item scores.
 * @param {number[]} scores one number per item (1/0 for accuracy, F1, nDCG …)
 * @param {{ resamples?: number, seed?: number, stat?: (xs: number[]) => number }} [o]
 * @returns {{ value: number, ci95: [number, number], method: "bootstrap", resamples: number }}
 */
export function bootstrapCi(scores, { resamples = 1000, seed = 1, stat = mean } = {}) {
  if (!Array.isArray(scores) || !scores.length) throw new Error("bootstrapCi: no scores");
  const value = stat(scores);
  const next = rng(seed);
  const stats = new Array(resamples);
  const n = scores.length;
  const sample = new Array(n);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) sample[i] = scores[Math.floor(next() * n)];
    stats[b] = stat(sample);
  }
  stats.sort((x, y) => x - y);
  const at = (q) => stats[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))];
  const round = (x) => Math.round(x * 1e6) / 1e6;
  return { value: round(value), ci95: [round(Math.min(at(0.025), value)), round(Math.max(at(0.975), value))], method: "bootstrap", resamples };
}

/**
 * Cohen's κ between two raters over the same items (any label type).
 * @param {unknown[]} a
 * @param {unknown[]} b
 */
export function cohenKappa(a, b) {
  if (a.length !== b.length || !a.length) throw new Error("cohenKappa: two label lists of the same, non-zero length");
  const n = a.length;
  const labels = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const l of labels) pe += (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/**
 * Builds a card from a run's per-item scores. Throws when the result is
 * incomplete, so a writer can never emit a card that eval:card would refuse.
 * @param {{ tag: string, model: { name: string, digest: string }, seed: number, temperature: number,
 *   dataset: { name: string, version: string, license: string, source?: string },
 *   scores: Record<string, number[]>, judged?: string[], judgeCalibration?: { kappa: number, humanLabels: number }, resamples?: number }} r
 */
export function makeCard(r) {
  const metrics = {};
  let n = 0;
  for (const [name, xs] of Object.entries(r.scores ?? {})) {
    metrics[name] = bootstrapCi(xs, { seed: r.seed, resamples: r.resamples });
    if (r.judged?.includes(name)) metrics[name].judge = "llm";
    n = Math.max(n, xs.length);
  }
  const card = { schema: CARD_SCHEMA, tag: r.tag, model: r.model, seed: r.seed, temperature: r.temperature, dataset: r.dataset, n, metrics };
  if (r.judgeCalibration) card.judgeCalibration = r.judgeCalibration;
  const problems = validateCard(card);
  if (problems.length) throw new Error(`makeCard: ${problems.join("; ")}`);
  return card;
}

/** The card of a report: the report's own `card`, or the file itself when it is a bare card. */
export const cardOf = (report) => (isObj(report) && isObj(report.card) ? report.card : isObj(report) && "tag" in report && "schema" in report ? report : undefined);

const isFullDone = (s = "") => s.startsWith("✅") && !s.startsWith("✅*");

/**
 * The rule plan:check adds (W11.I18): a plain ✅ that rests on an eval is
 * backed by a complete card tagged public or heldout.
 * - a task's `evalCards` lists committed card files (eval/cards/*.json);
 * - a ✅ task with `evalCards` needs every card readable, complete, and tagged public/heldout;
 *   a dev card keeps it at ✅* at most;
 * - a ✅ task whose dod runs an eval command (EVAL_COMMAND) must list its cards.
 * @param {any} plan
 * @param {(path: string) => any} readJson throws when the file is missing
 * @returns {string[]}
 */
export function checkEvalClaims(plan, readJson) {
  const problems = [];
  for (const t of plan.phases.flatMap((ph) => ph.tasks)) {
    if (t.evalCards !== undefined && (!Array.isArray(t.evalCards) || t.evalCards.some((c) => !nonEmpty(c)))) {
      problems.push(`${t.id}: evalCards must be a list of card paths`);
      continue;
    }
    if (!isFullDone(t.status ?? "")) continue;
    const cards = t.evalCards ?? [];
    if (!cards.length) {
      const cmd = (t.dod ?? []).find((c) => EVAL_COMMAND.test(c));
      if (cmd) problems.push(`${t.id} is ✅ on an eval (\`${cmd}\`) without evalCards — cite the card of the public or held-out run, or mark it ✅*`);
      continue;
    }
    for (const path of cards) {
      let card;
      try {
        card = cardOf(readJson(path));
      } catch (e) {
        problems.push(`${t.id}: eval card ${path} cannot be read (${e?.code ?? e?.message ?? e})`);
        continue;
      }
      const bad = validateCard(card);
      if (bad.length) problems.push(`${t.id}: eval card ${path} is incomplete — ${bad.join("; ")}`);
      else if (!CLAIM_TAGS.includes(card.tag)) problems.push(`${t.id} is ✅ on a ${card.tag} report (${path}) — only a public or heldout run makes ✅; keep it ✅*`);
    }
  }
  return problems;
}
