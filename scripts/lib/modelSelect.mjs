/**
 * Plan W11.I12 — the default model per RAM tier, picked from measured
 * results (research R2.4, R4 #4), never assumed.
 *
 * Input: eval cards (W11.I18). Quality comes only from cards tagged public or
 * heldout; speed and memory from a `lumen-perf` card (any tag: it measures
 * the machine, not a claim on a set). A model is a candidate for a tier
 * only when every input below is measured and its peak RAM fits the tier.
 *
 *   heq      HeQ test, metric f1                       (dataset name starts with "heq")
 *   aleph    AlephBench macro average, and its nikud   ("alephbench": metrics macro, nikud)
 *   bfcl     BFCL v4 ast_simple and ast_multiple       ("bfcl-v4")
 *   perf     tok_s and peak_ram_gb                     ("lumen-perf")
 *
 * Composite = 0.30 HeQ F1 + 0.30 AlephBench macro + 0.25 BFCL (mean of simple
 * and multiple) + 0.15 speed (tok/s ÷ 30, capped at 1).
 *
 * The rule (plan W11.I12): the incumbent (the tier's current default) is
 * replaced only by a candidate with a higher composite, **≥ 5 points more
 * AlephBench macro, and at most 3 points less nikud**. With no measured
 * incumbent the tier keeps its current default until a candidate is
 * measured against it; a tier with no default and complete candidates
 * takes the best composite. No tier ever gets a model above its RAM.
 */

import { cardOf, CLAIM_TAGS, validateCard } from "./evalCard.mjs";

export const TIERS = Object.freeze([4, 8]);
export const WEIGHTS = Object.freeze({ heq: 0.3, aleph: 0.3, bfcl: 0.25, speed: 0.15 });
export const SPEED_FULL_TOK_S = 30;
export const MIN_ALEPH_GAIN = 0.05;
export const MAX_NIKUD_DROP = 0.03;
/** Today's defaults (coordinator, 15.11): qwen2.5:7b stays until a Mac measurement picks a winner. */
export const CURRENT_DEFAULTS = Object.freeze({ 4: null, 8: "qwen2.5:7b" });

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * The measured numbers per model, from cards. Newer cards of the same model
 * and dataset win (by `date`, then file order). Cards that are incomplete,
 * or dev-tagged quality cards, are listed in `ignored` with the reason.
 * @param {{ file: string, report: any }[]} inputs
 */
export function measurements(inputs) {
  /** @type {Map<string, Record<string, number>>} */
  const by = new Map();
  const ignored = [];
  const seen = new Map();
  const sorted = [...inputs].sort((a, b) => String(a.report?.date ?? "").localeCompare(String(b.report?.date ?? "")));
  for (const { file, report } of sorted) {
    const card = cardOf(report);
    const bad = validateCard(card);
    if (bad.length) {
      ignored.push({ file, reason: `incomplete card: ${bad[0]}` });
      continue;
    }
    const ds = card.dataset.name.toLowerCase();
    const kind = ds.startsWith("heq") ? "heq" : ds.startsWith("alephbench") ? "aleph" : ds.startsWith("bfcl-v4") ? "bfcl" : ds === "lumen-perf" ? "perf" : null;
    if (!kind) {
      ignored.push({ file, reason: `dataset ${card.dataset.name} is not a selection input` });
      continue;
    }
    if (kind !== "perf" && !CLAIM_TAGS.includes(card.tag)) {
      ignored.push({ file, reason: `${card.tag} card: only public or heldout results pick a default` });
      continue;
    }
    if (kind === "bfcl" && report?.repair === true) {
      ignored.push({ file, reason: "toolRepair run: the default is picked on the raw score" });
      continue;
    }
    const m = card.metrics;
    const v = (k) => (m[k] ? m[k].value : undefined);
    const got = kind === "heq" ? { heq: v("f1") } : kind === "aleph" ? { aleph: v("macro"), nikud: v("nikud") } : kind === "bfcl" ? { bfclSimple: v("ast_simple"), bfclMultiple: v("ast_multiple") } : { tokS: v("tok_s"), peakRamGB: v("peak_ram_gb") };
    const model = card.model.name;
    const row = by.get(model) ?? {};
    for (const [k, x] of Object.entries(got)) if (typeof x === "number") row[k] = x;
    by.set(model, row);
    seen.set(`${model}|${kind}`, file);
  }
  return { byModel: by, ignored, sources: [...new Set(seen.values())].sort() };
}

const REQUIRED = ["heq", "aleph", "nikud", "bfclSimple", "bfclMultiple", "tokS", "peakRamGB"];
export const missing = (row) => REQUIRED.filter((k) => typeof row?.[k] !== "number");

export function composite(row) {
  const bfcl = (row.bfclSimple + row.bfclMultiple) / 2;
  const speed = Math.min(row.tokS / SPEED_FULL_TOK_S, 1);
  return r3(WEIGHTS.heq * row.heq + WEIGHTS.aleph * row.aleph + WEIGHTS.bfcl * bfcl + WEIGHTS.speed * speed);
}

const numbers = (row) => ({ composite: composite(row), heqF1: r3(row.heq), alephMacro: r3(row.aleph), nikud: r3(row.nikud), bfclSimple: r3(row.bfclSimple), bfclMultiple: r3(row.bfclMultiple), tokS: r3(row.tokS), peakRamGB: r3(row.peakRamGB) });
const pts = (x) => `${(x * 100).toFixed(1)}`;

/**
 * The choice for every tier.
 * @param {Map<string, Record<string, number>>} byModel
 * @param {{ incumbents?: Record<number, string | null>, tiers?: readonly number[] }} [o]
 */
export function selectDefaults(byModel, { incumbents = CURRENT_DEFAULTS, tiers = TIERS } = {}) {
  const out = {};
  for (const tier of tiers) {
    const complete = [...byModel].filter(([, row]) => !missing(row).length);
    const fits = complete.filter(([, row]) => row.peakRamGB <= tier).sort((a, b) => composite(b[1]) - composite(a[1]) || a[0].localeCompare(b[0]));
    const inc = incumbents[tier] ?? null;
    const incRow = inc ? byModel.get(inc) : undefined;
    const incOk = incRow && !missing(incRow).length && incRow.peakRamGB <= tier;
    const rejected = [];
    for (const [name, row] of complete) if (row.peakRamGB > tier) rejected.push({ model: name, reason: `peak RAM ${row.peakRamGB} GB > ${tier} GB` });
    for (const [name, row] of byModel) if (missing(row).length) rejected.push({ model: name, reason: `not measured: ${missing(row).join(", ")}` });

    if (!inc && !fits.length) {
      out[tier] = { model: null, reason: "no default for this tier and no fully measured model that fits it", rejected };
      continue;
    }
    if (!inc) {
      const [name, row] = fits[0];
      out[tier] = { model: name, reason: `no previous default: the best composite that fits ${tier} GB`, numbers: numbers(row), rejected };
      continue;
    }
    if (!incOk) {
      out[tier] = { model: inc, reason: incRow ? (incRow.peakRamGB > tier ? `the default ${inc} does not fit ${tier} GB when measured; kept until a measured candidate passes the rule against a measured default` : `the default ${inc} is not fully measured (${missing(incRow).join(", ")}); kept until it is`) : `the default ${inc} has no measured results; kept until a Mac run measures it against the candidates`, rejected };
      continue;
    }
    let best = null;
    for (const [name, row] of fits) {
      if (name === inc) continue;
      const why = [];
      if (composite(row) <= composite(incRow)) why.push(`composite ${composite(row)} ≤ ${composite(incRow)}`);
      if (row.aleph - incRow.aleph < MIN_ALEPH_GAIN - 1e-9) why.push(`AlephBench +${pts(row.aleph - incRow.aleph)} < +5 points`);
      if (incRow.nikud - row.nikud > MAX_NIKUD_DROP + 1e-9) why.push(`nikud −${pts(incRow.nikud - row.nikud)} > 3 points`);
      if (why.length) rejected.push({ model: name, reason: why.join("; ") });
      else if (!best) best = [name, row];
    }
    out[tier] = best
      ? { model: best[0], replaces: inc, reason: `${best[0]} beats ${inc}: composite ${composite(best[1])} > ${composite(incRow)}, AlephBench +${pts(best[1].aleph - incRow.aleph)} points, nikud ${best[1].nikud >= incRow.nikud ? "+" : "−"}${pts(Math.abs(best[1].nikud - incRow.nikud))} points`, numbers: numbers(best[1]), incumbent: numbers(incRow), rejected }
      : { model: inc, reason: `${inc} stays: no candidate passes the rule`, numbers: numbers(incRow), rejected };
  }
  return out;
}
