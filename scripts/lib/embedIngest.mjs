/**
 * Plan W7.13 step 6 (W10.E53): an embeddings competition run changes the
 * app's search model only through this ingest. The run is
 * `npm run eval:embed-compete` (src/agents/eval/embedCompete.eval.ts), which
 * writes eval/results/embed-compete-<date>.json = { rows, decision }.
 *
 * A run is taken when it is complete (every row measured on dev and held
 * out, a decision with a reason) and its set separated the candidates
 * (decision.discriminates: ≥ 5 nDCG@10 points). Its default becomes the
 * app's model only if that candidate is an embedding model whose licence
 * gate 0.10 verified and whose files have a sha256 (W4.14 mirror). A row id
 * `model@256` is that model's Matryoshka-256 index. Otherwise the built-in
 * model stays. Plain JavaScript, shared by scripts/eval/embed-ingest.mjs
 * and its tests.
 *
 * Review Z6-M5: the run's card (`report.card`, scripts/lib/evalCard.mjs)
 * decides what its numbers may claim, as for every other default
 * (scripts/lib/modelSelect.mjs: "only public or heldout results pick a
 * default"). Only a complete card tagged heldout or public, on a dataset
 * that is not synthetic, changes the app's model; a dev or synthetic card
 * (every run on eval/synthetic/retrieval-hard today) leaves
 * src/ai/embeddingDefault.json as it is, and its rows are recorded as dev
 * numbers (`devNdcg10`, `devHeldoutSplitNdcg10`), never as `heldoutNdcg10`.
 */

import { CLAIM_TAGS, cardOf, isSyntheticDataset, validateCard } from "./evalCard.mjs";

/**
 * May this run's numbers back a held-out claim (and so the app's default)? → { ok, why }.
 * @param {any} report
 */
export function runClaim(report) {
  const card = cardOf(report);
  if (card === undefined) return { ok: false, why: "the run has no card (report.card): its numbers are dev numbers" };
  const bad = validateCard(card);
  if (bad.length) return { ok: false, why: `the run's card is incomplete (${bad[0]}): its numbers are dev numbers` };
  if (isSyntheticDataset(card.dataset)) return { ok: false, why: `the run's card is on a synthetic dataset (${card.dataset.name}): its numbers are dev numbers` };
  if (!CLAIM_TAGS.includes(card.tag)) return { ok: false, why: `the run's card is tagged ${card.tag}: only a ${CLAIM_TAGS.join(" or ")} run changes the app's model` };
  return { ok: true, why: `${card.tag} card on ${card.dataset.name}` };
}

/** `embeddinggemma-2@256` → { id: "embeddinggemma-2", dims: 256 }. */
export function parseRowId(rowId) {
  const m = /^(.+?)@(\d+)$/.exec(String(rowId));
  return m ? { id: m[1], dims: Number(m[2]) } : { id: String(rowId), dims: null };
}

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const measuredRow = (r) => r && finite(r.ndcg10) && finite(r.msPerQuery) && finite(r.items) && r.items > 0;

/** Is `report` a complete competition run for `manifest` (embedding-candidates.json)? → { ok, reasons }. */
export function acceptEmbedRun(report, manifest) {
  const reasons = [];
  if (!report || typeof report !== "object") return { ok: false, reasons: ["not a JSON object"] };
  const ids = new Set((manifest?.candidates ?? []).filter((c) => c.kind === "embedding").map((c) => c.id));
  if (!Array.isArray(report.rows) || !report.rows.length) reasons.push("no rows");
  else
    for (const [i, r] of report.rows.entries()) {
      const { id, dims } = parseRowId(r?.id);
      if (!ids.has(id)) reasons.push(`row ${i}: ${r?.id} is not an embedding candidate in eval/models/embedding-candidates.json`);
      if (dims !== null) {
        const c = manifest.candidates.find((x) => x.id === id);
        if (!c?.matryoshka?.includes(dims)) reasons.push(`row ${i}: ${id} has no Matryoshka size ${dims}`);
      }
      if (!measuredRow(r?.dev) || !measuredRow(r?.heldout)) reasons.push(`row ${i}: ${r?.id} is not measured on both dev and held-out`);
    }
  const d = report.decision;
  if (!d || typeof d.discriminates !== "boolean") reasons.push("no decision.discriminates");
  if (!d?.default || typeof d.default.id !== "string" || typeof d.default.reason !== "string") reasons.push("no decision.default with an id and a reason");
  else if (Array.isArray(report.rows) && !report.rows.some((r) => r?.id === d.default.id) && d.default.id !== manifest?.current) reasons.push(`decision.default ${d.default.id} is not one of the rows`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * The app's embedding model after an accepted run → { entry, why, keep? }.
 * `entry` is what src/ai/embeddingDefault.json holds: null keeps the
 * built-in model (multilingual-e5-small). `keep`: the run may not change
 * that file at all (Z6-M5: its card is dev or synthetic).
 */
export function embedDefault(report, manifest, { file = null, date = null } = {}) {
  const d = report.decision;
  const claim = runClaim(report);
  if (!claim.ok) return { entry: null, keep: true, why: `${claim.why}; src/ai/embeddingDefault.json is left as it is` };
  if (!d.discriminates) return { entry: null, why: "the set did not separate the candidates (decision.discriminates is false): the built-in model stays" };
  const { id, dims } = parseRowId(d.default.id);
  if (id === manifest.current && dims === null) return { entry: null, why: `the run kept ${id}: ${d.default.reason}` };
  const c = manifest.candidates.find((x) => x.id === id && x.kind === "embedding");
  if (!c) return { entry: null, why: `${id} is not an embedding candidate` };
  if (c.licenseVerified !== true) return { entry: null, why: `${id} won, but its licence is not verified (gate 0.10): the built-in model stays` };
  if (!c.sha256) return { entry: null, why: `${id} won, but its files have no sha256 (W4.14 mirror): the built-in model stays` };
  const row = report.rows.find((r) => r.id === d.default.id);
  return {
    entry: {
      id: c.id,
      hf: c.hf,
      dtype: c.dtype ?? "q8",
      sha256: c.sha256,
      dims: dims ?? c.dims,
      prefix: { query: c.prefix?.query ?? "", document: c.prefix?.document ?? "" },
      measured: { file, date, heldoutNdcg10: row?.heldout?.ndcg10 ?? null, msPerQuery: row?.heldout?.msPerQuery ?? null, reason: d.default.reason },
    },
    why: `${d.default.id}: ${d.default.reason}`,
  };
}

/**
 * The candidates file with each measured row's numbers under `measured` (by row id). Held-out numbers are recorded
 * as `heldoutNdcg10` only when the run's card backs a held-out claim (runClaim); otherwise the split the run called
 * held out is a dev split, recorded as `devHeldoutSplitNdcg10` with `basis: "dev"` (Z6-M5).
 */
export function withMeasured(manifest, report, { file = null, date = null } = {}) {
  const measured = { ...(manifest.measured ?? {}) };
  const claim = runClaim(report).ok;
  for (const r of report.rows) {
    measured[r.id] = claim
      ? { file, date, basis: "heldout", devNdcg10: r.dev.ndcg10, heldoutNdcg10: r.heldout.ndcg10, msPerQuery: r.heldout.msPerQuery, dims: r.heldout.dims ?? null }
      : { file, date, basis: "dev", devNdcg10: r.dev.ndcg10, devHeldoutSplitNdcg10: r.heldout.ndcg10, msPerQuery: r.heldout.msPerQuery, dims: r.heldout.dims ?? null };
  }
  return { ...manifest, measured };
}
