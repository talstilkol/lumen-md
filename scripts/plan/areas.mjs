#!/usr/bin/env node
/**
 * Plan W6.44: the "works for the user" board. A score per area, computed
 * from signed receipts against the bar for 10, never from status text.
 *
 *   plan/areas.json            the 19 areas, and which area each plan task serves
 *   scripts/plan/area-bars.mjs the bar for 10 per area, as metrics
 *   plan/areas-board.json      the scores (this script writes it)
 *   plan/areas-board.html      the same as a static page
 *
 *   node scripts/plan/areas.mjs [--receipts <clone of lumen-md-receipts>] [--nightly reports/nightly]
 *        [--owner reports/owner] [--metrics <dir>] [--pin <fp,…>] [--levels plan/verified-receipts.json]
 *        [--out plan/areas-board.json] [--html plan/areas-board.html]
 *
 * A receipt counts only when its Ed25519 signature verifies against a trusted
 * key (keys/*.pem in --receipts, PUBLIC_KEY.pem in --nightly, --owner and
 * --metrics; narrowed with --pin), in the sealed format of
 * scripts/plan/receipts.mjs (#455 / #511), and it carries a date. The newest
 * receipt that measures a metric gives its value.
 *
 * A measurement tool proves a number with a sealed "metric" receipt:
 *   { format: "lumen-metric", version: 1, kind: "metric", commit: { sha }, measuredAt,
 *     metrics: { "<metric id>": <number | boolean> }, command, receipt: { … } }
 *
 * The score of an area is 10 × the mean credit of its metrics:
 *   met → 1 · measured and short → value/target (≥) or target/value (≤), at most 1;
 *   a boolean false or a ≤ 0 target missed → 0 · not measured → 0, shown as "not measured".
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BARS } from "./area-bars.mjs";
import { LEVELS, fingerprint, verifySealed } from "./receipts.mjs";

export const AREAS_FILE = "plan/areas.json";
export const BOARD_JSON = "plan/areas-board.json";
export const BOARD_HTML = "plan/areas-board.html";
const OPS = new Set([">=", "<=", "true"]);
const SOURCES = ["metric", "suite", "owner", "real"];

// ── validation (plan:check) ──

/**
 * plan/areas.json and the bars against the plan.
 * → { problems: [...], unknown: [ids in areas.json that the plan doesn't have] }
 */
export function checkAreas(plan, areas, bars = BARS) {
  const problems = [];
  const list = Array.isArray(areas?.areas) ? areas.areas : [];
  const ids = list.map((a) => a?.id);
  const want = Array.from({ length: 19 }, (_, i) => i + 1);
  if (ids.length !== 19 || want.some((n) => !ids.includes(n))) problems.push(`areas: want ids 1–19 once each, got [${ids.join(", ")}]`);
  for (const a of list) if (!a?.key || !a?.en || !a?.he) problems.push(`area ${a?.id}: needs key, en and he`);
  const seen = new Set();
  for (const n of want) {
    const ms = bars[n];
    if (!Array.isArray(ms) || !ms.length) {
      problems.push(`area ${n}: no metrics in scripts/plan/area-bars.mjs`);
      continue;
    }
    for (const x of ms) {
      if (seen.has(x.id)) problems.push(`metric ${x.id}: used twice`);
      seen.add(x.id);
      if (!x.en || !x.he) problems.push(`metric ${x.id}: needs en and he`);
      if (!OPS.has(x.target?.op) || (x.target.op !== "true" && typeof x.target.value !== "number")) problems.push(`metric ${x.id}: bad target`);
      const src = Object.keys(x.from ?? {}).filter((k) => SOURCES.includes(k));
      if (src.length !== 1) problems.push(`metric ${x.id}: \`from\` needs exactly one of ${SOURCES.join(", ")}`);
      if (x.from?.owner && !x.from.check) problems.push(`metric ${x.id}: an owner source needs a check`);
    }
  }
  const map = areas?.tasks && typeof areas.tasks === "object" ? areas.tasks : {};
  const planIds = (plan.phases ?? []).flatMap((p) => p.tasks.map((t) => t.id));
  const missing = planIds.filter((id) => !Object.hasOwn(map, id));
  if (missing.length) problems.push(`${missing.length} plan task(s) have no entry in ${AREAS_FILE} (add the area ids, or [] for process work): ${missing.join(", ")}`);
  for (const [id, v] of Object.entries(map)) {
    if (!Array.isArray(v) || v.some((n) => !Number.isInteger(n) || n < 1 || n > 19) || new Set(v).size !== v.length) problems.push(`${AREAS_FILE} ${id}: want a list of distinct area ids 1–19, got ${JSON.stringify(v)}`);
  }
  const known = new Set(planIds);
  return { problems, unknown: Object.keys(map).filter((id) => !known.has(id)) };
}

// ── evidence ──

const allOk = (xs) => Array.isArray(xs) && xs.length > 0 && xs.every((x) => x?.ok === true);
/** The receipt's date: when it finished or was measured. */
export const dateOf = (r) => r?.finishedAt ?? r?.measuredAt ?? r?.generatedAt ?? r?.startedAt ?? null;

/** What one verified receipt says about one metric: a number, a boolean, or undefined (it doesn't measure it). */
export function valueOf(report, from) {
  if (from.metric) {
    const v = report.metrics?.[from.metric];
    return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? v : undefined;
  }
  if (from.suite) {
    if (report.kind !== "full") return undefined;
    const names = Object.keys(report.suites ?? {}).filter((n) => n.startsWith(from.suite));
    return names.length ? names.every((n) => report.suites[n]?.ok === true) : undefined;
  }
  if (from.owner) {
    if (report.kind !== "owner" || report.step !== from.owner) return undefined;
    const c = (report.checks ?? []).find((x) => x.id === from.check);
    return c && c.ok !== null && c.ok !== undefined ? c.ok === true : undefined;
  }
  if (from.real) {
    const isSafari = report.kind === "safari" && from.real === "safari";
    if (!isSafari && !(report.kind === "real" && report.real?.type === from.real)) return undefined;
    return allOk(report.kind === "safari" ? report.platforms : report.checks);
  }
  return undefined;
}

/** Credit for one value against its target (0–1). */
export function credit(value, target) {
  if (value === undefined) return 0;
  if (target.op === "true") return value === true ? 1 : 0;
  if (typeof value !== "number") return 0;
  const t = target.value;
  if (target.op === ">=") return value >= t ? 1 : t > 0 ? Math.max(0, value / t) : 0;
  if (value <= t) return 1;
  return t > 0 ? Math.min(1, t / value) : 0;
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * The board.
 *   areas:    plan/areas.json
 *   receipts: [{ report, source }] already verified
 *   levels:   plan/verified-receipts.json (#511) or null
 */
export function computeBoard({ areas, receipts, levels = null, bars = BARS }) {
  const dated = receipts.filter((r) => dateOf(r.report)).sort((a, b) => String(dateOf(b.report)).localeCompare(String(dateOf(a.report))));
  const rows = areas.areas.map((a) => {
    const metrics = (bars[a.id] ?? []).map((x) => {
      const hit = dated.find((r) => valueOf(r.report, x.from) !== undefined);
      const value = hit ? valueOf(hit.report, x.from) : undefined;
      const c = credit(value, x.target);
      return {
        id: x.id,
        en: x.en,
        he: x.he,
        target: x.target,
        unit: x.unit,
        status: value === undefined ? "not measured" : c === 1 ? "met" : "short",
        value: value ?? null,
        credit: Math.round(c * 100) / 100,
        receipt: hit ? { at: dateOf(hit.report), commit: hit.report.commit?.sha ?? hit.report.sha ?? null, source: hit.source, key: hit.report.receipt?.key ?? null } : null,
      };
    });
    const score = metrics.length ? round1((10 * metrics.reduce((n, x) => n + credit(x.value ?? undefined, x.target), 0)) / metrics.length) : 0;
    const mine = Object.entries(areas.tasks).filter(([, v]) => v.includes(a.id)).map(([id]) => id);
    const computed = Object.fromEntries([...LEVELS, "none"].map((k) => [k, 0]));
    for (const id of mine) computed[levels?.tasks?.[id]?.computed ?? "none"]++;
    return { id: a.id, key: a.key, en: a.en, he: a.he, leader: a.leader ?? null, score, measured: metrics.filter((x) => x.status !== "not measured").length, met: metrics.filter((x) => x.status === "met").length, metrics, tasks: { count: mine.length, computed: levels ? computed : null } };
  });
  return {
    average: round1(rows.reduce((n, r) => n + r.score, 0) / rows.length),
    metrics: rows.reduce((n, r) => n + r.metrics.length, 0),
    measured: rows.reduce((n, r) => n + r.measured, 0),
    met: rows.reduce((n, r) => n + r.met, 0),
    areas: rows,
  };
}

// ── the page ──

const E = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtTarget = (t, unit) => (t.op === "true" ? "כן" : `${t.op === ">=" ? "≥" : "≤"} ${t.value} ${unit}`);
const fmtValue = (v, unit) => (v === null ? "—" : typeof v === "boolean" ? (v ? "כן" : "לא") : `${v} ${unit}`);
const STATUS_HE = { met: "עומד ברף", short: "מתחת לרף", "not measured": "לא נמדד" };

export function renderHtml(board) {
  const areaHtml = board.areas
    .map((a) => {
      const rows = a.metrics
        .map((x) => `<tr class="${x.status === "met" ? "met" : x.status === "short" ? "short" : "none"}"><td>${E(x.he)}<div class="en" dir="ltr">${E(x.en)}</div></td><td dir="ltr">${E(fmtTarget(x.target, x.unit))}</td><td dir="ltr">${E(fmtValue(x.value, x.unit))}</td><td><span class="chip">${STATUS_HE[x.status]}</span></td><td dir="ltr">${x.receipt ? `${E(String(x.receipt.at).slice(0, 10))} · <code>${E(String(x.receipt.commit ?? "").slice(0, 9))}</code><div class="en">${E(x.receipt.source)}</div>` : "—"}</td></tr>`)
        .join("\n");
      const lv = a.tasks.computed ? ` · רמות מקבלות: ${LEVELS.map((k) => `${k} ${a.tasks.computed[k]}`).join(", ")}, none ${a.tasks.computed.none}` : "";
      return `<section><h2><span class="score">${a.score.toFixed(1)}</span> ${a.id}. ${E(a.he)} <span class="en" dir="ltr">${E(a.en)}</span></h2>
<div class="bar"><i style="inline-size:${a.score * 10}%"></i></div>
<p class="meta">${a.met}/${a.metrics.length} מדדים עומדים ברף · ${a.measured} נמדדו · ${a.tasks.count} משימות${lv}${a.leader ? ` · המוביל: ${E(a.leader)}` : ""}</p>
<div class="scroll"><table><thead><tr><th>מדד</th><th>רף ל-10</th><th>ערך אחרון</th><th>מצב</th><th>קבלה</th></tr></thead><tbody>
${rows}
</tbody></table></div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Works-for-user board</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1b18;--muted:#6b665e;--line:#e4e0d8;--met:#1f7a4d;--short:#a66300;--none:#8a847a;--fill:#2f5fd0;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#ecebe8;--muted:#a19d95;--line:#2c2f34;--met:#5cc48f;--short:#e3a24a;--none:#8d8a84;--fill:#7aa2ff;--card:#1c1f23}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#ecebe8;--muted:#a19d95;--line:#2c2f34;--met:#5cc48f;--short:#e3a24a;--none:#8d8a84;--fill:#7aa2ff;--card:#1c1f23}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Segoe UI",Arial,sans-serif;padding:24px 16px}
main{max-inline-size:1100px;margin:0 auto}h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.05rem;margin:0 0 6px}
.lead{color:var(--muted);margin:0 0 20px}.en{color:var(--muted);font-size:.85em;font-weight:400}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 14px}
.score{display:inline-block;min-inline-size:2.6em;text-align:center;font-variant-numeric:tabular-nums}
.bar{block-size:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:4px 0 6px}.bar i{display:block;block-size:100%;background:var(--fill)}
.meta{color:var(--muted);font-size:.85rem;margin:0 0 8px}.scroll{overflow-x:auto}
table{border-collapse:collapse;inline-size:100%;font-size:.88rem}th,td{text-align:start;padding:6px 8px;border-block-start:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}.chip{font-size:.8rem;white-space:nowrap}
tr.met .chip{color:var(--met)}tr.short .chip{color:var(--short)}tr.none .chip{color:var(--none)}code{font-size:.85em}
</style></head><body><main>
<h1>לוח ״עובד אצל משתמש״ — ממוצע ${board.average.toFixed(1)}</h1>
<p class="lead">כל ציון מחושב מקבלות חתומות בלבד מול הרף ל-10 (W6.44). ${board.met}/${board.metrics} מדדים עומדים ברף, ${board.measured} נמדדו. מדד בלי קבלה מוצג ״לא נמדד״ ולא מקבל נקודות. נוצר ${E(board.generatedAt?.slice(0, 16) ?? "")} · ${board.sources?.counted ?? 0} קבלות נספרו, ${board.sources?.rejected?.length ?? 0} נדחו.</p>
${areaHtml}
</main></body></html>
`;
}

// ── the I/O ──

function walkJson(dir) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  const go = (d) => {
    for (const f of readdirSync(d)) {
      if (f === ".git" || f === "node_modules") continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) go(p);
      else if (f.endsWith(".json")) out.push(p);
    }
  };
  go(dir);
  return out;
}
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null; // why: not JSON, not a receipt
  }
};

/** Trusted keys and verified receipts from the given directories. */
export function loadReceipts({ receipts, nightly, owner, metrics, pins = null }) {
  const keys = new Map();
  const pems = [];
  if (receipts && existsSync(join(receipts, "keys"))) for (const x of readdirSync(join(receipts, "keys"))) if (x.endsWith(".pem")) pems.push(join(receipts, "keys", x));
  for (const d of [nightly, owner, metrics]) if (d && existsSync(join(d, "PUBLIC_KEY.pem"))) pems.push(join(d, "PUBLIC_KEY.pem"));
  for (const f of pems) {
    const pem = readFileSync(f, "utf8");
    const fp = fingerprint(pem);
    if (!pins || pins.includes(fp)) keys.set(fp, pem);
  }
  const ok = [];
  const rejected = [];
  for (const f of [receipts, nightly, owner, metrics].flatMap(walkJson)) {
    const r = readJson(f);
    if (!r?.receipt) continue;
    const source = relative(process.cwd(), f);
    const v = verifySealed(r, keys);
    if (!v.ok) rejected.push({ source, why: v.problems.join("; ") });
    else if (!dateOf(r)) rejected.push({ source, why: "no date (finishedAt, measuredAt, generatedAt or startedAt)" });
    else ok.push({ report: r, source });
  }
  return { receipts: ok, rejected, trustedKeys: [...keys.keys()] };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const plan = JSON.parse(readFileSync(join(root, "plan/plan.json"), "utf8"));
  const areas = JSON.parse(readFileSync(join(root, AREAS_FILE), "utf8"));
  const { problems } = checkAreas(plan, areas);
  if (problems.length) {
    console.error(`areas: ${AREAS_FILE} —\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const levelsPath = resolve(opt("levels") ?? join(root, "plan/verified-receipts.json"));
  const levels = existsSync(levelsPath) ? readJson(levelsPath) : null;
  const pins = opt("pin")?.split(",").filter(Boolean) ?? null;
  const loaded = loadReceipts({ receipts: opt("receipts"), nightly: opt("nightly"), owner: opt("owner") ?? join(root, "reports/owner"), metrics: opt("metrics"), pins });
  const board = {
    version: 1,
    generatedAt: new Date().toISOString(),
    method: "score = 10 × mean metric credit; credit from signed, dated receipts only (scripts/plan/areas.mjs)",
    sources: { counted: loaded.receipts.length, rejected: loaded.rejected, trustedKeys: loaded.trustedKeys, pinned: Boolean(pins), levels: levels ? relative(root, levelsPath) : null },
    ...computeBoard({ areas, receipts: loaded.receipts, levels }),
  };
  const out = resolve(opt("out") ?? join(root, BOARD_JSON));
  const html = resolve(opt("html") ?? join(root, BOARD_HTML));
  writeFileSync(out, JSON.stringify(board, null, 2) + "\n");
  writeFileSync(html, renderHtml(board));
  console.log(`areas: average ${board.average.toFixed(1)} · ${board.met}/${board.metrics} metrics met, ${board.measured} measured · ${loaded.receipts.length} receipts counted, ${loaded.rejected.length} rejected → ${relative(process.cwd(), out)}, ${relative(process.cwd(), html)}`);
  for (const a of board.areas) console.log(`  ${String(a.id).padStart(2)} ${a.score.toFixed(1).padStart(4)}  ${a.met}/${a.metrics.length} met  ${a.en}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
