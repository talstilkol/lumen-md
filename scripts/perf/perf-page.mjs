#!/usr/bin/env node
/**
 * The public performance page (plan W13.V5): a trend per release, built only
 * from signed measurement receipts — startup, INP, the 100k vault, tap to
 * paint. Obsidian publishes performance gains in every release; a page whose
 * every number carries the receipt it came from is a claim anyone can check.
 *
 *   node scripts/perf/perf-page.mjs            write docs/perf/index.md and docs/perf/index.he.md
 *   node scripts/perf/perf-page.mjs --check    exit 1 when the committed pages are stale
 *   node scripts/perf/perf-page.mjs --dir <receipts> --out <dir> --key <PUBLIC_KEY.pem>   (tests)
 *
 * Receipts: reports/metrics/*.json and reports/nightly/*.json in the
 * `lumen-metric` format (scripts/nightly/receipt.mjs seals them with the
 * nightly machine's Ed25519 key; the public half is PUBLIC_KEY.pem next to
 * them). A receipt that is not sealed, does not verify, or was signed with
 * another key is left out and listed as rejected — its numbers never reach
 * the page. Each number on the page names its receipt (the first 12 hex of
 * its sha256) and the machine it was measured on.
 *
 * Obsidian appears only where a receipt measured it on the same machine as
 * a Lumen receipt of the same release (`kind: "comparison"`, W11.Q2's
 * procedure): never next to a number from another machine.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../nightly/receipt.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The metrics the page shows, in order: receipt metric id → label (en, he) and unit. Lower is better for all. */
export const PAGE_METRICS = [
  { id: "perf.startup-gz-bytes", en: "Startup JavaScript (gzip)", he: "JavaScript בהפעלה (gzip)", unit: "B" },
  { id: "perf.cold-start-ms", en: "Cold start to first paint", he: "הפעלה קרה עד ציור ראשון", unit: "ms" },
  { id: "perf.inp-p75-ms", en: "INP p75", he: "INP p75", unit: "ms" },
  { id: "perf.vault100k.warm-open-ms", en: "100k vault: warm open", he: "כספת 100k: פתיחה חמה", unit: "ms" },
  { id: "perf.vault100k.cold-open-ms", en: "100k vault: cold open", he: "כספת 100k: פתיחה קרה", unit: "ms" },
  { id: "perf.vault100k.search-p95-ms", en: "100k vault: search p95", he: "כספת 100k: חיפוש p95", unit: "ms" },
  { id: "perf.tap-to-paint-p95-ms", en: "Tap to paint p95", he: "מהקשה עד ציור p95", unit: "ms" },
];

/** Every receipt under `dirs`, checked against `publicKeyPem`: { accepted, rejected }. */
export function loadReceipts(dirs, publicKeyPem) {
  const accepted = [];
  const rejected = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      let r;
      try {
        r = JSON.parse(readFileSync(join(dir, name), "utf8"));
      } catch {
        rejected.push({ file: name, why: "not JSON" });
        continue;
      }
      if (r?.format !== "lumen-metric") continue;
      const c = check(r, publicKeyPem);
      if (!publicKeyPem) c.problems.push("no PUBLIC_KEY.pem to verify against");
      if (c.ok && publicKeyPem) accepted.push({ file: name, ...r });
      else rejected.push({ file: name, why: c.problems.join("; ") || "not sealed" });
    }
  }
  return { accepted, rejected };
}

const releaseOf = (r) => r.release ?? r.commit?.release ?? (r.commit?.sha ? r.commit.sha.slice(0, 7) : "unreleased");
const machineOf = (r) => r.machine ? [r.machine.cpu, r.machine.platform].filter(Boolean).join(", ") : r.environments?.[0]?.device ?? "?";

/**
 * Rows of the trend: per release (in the order first measured), per metric,
 * the value from the newest accepted Lumen receipt that has it, with that
 * receipt's id and machine. A comparison receipt adds Obsidian's value only
 * when its machine equals the Lumen receipt's.
 */
export function trend(accepted) {
  const lumen = accepted.filter((r) => r.kind !== "comparison").sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)));
  const comps = accepted.filter((r) => r.kind === "comparison");
  const releases = [];
  for (const r of lumen) if (!releases.includes(releaseOf(r))) releases.push(releaseOf(r));
  const rows = [];
  for (const rel of releases) {
    for (const m of PAGE_METRICS) {
      const from = lumen.filter((r) => releaseOf(r) === rel && typeof r.metrics?.[m.id] === "number").at(-1);
      if (!from) continue;
      const machine = machineOf(from);
      const comp = comps.filter((c) => releaseOf(c) === rel && typeof c.metrics?.[`obsidian.${m.id}`] === "number" && machineOf(c) === machine).at(-1);
      rows.push({
        release: rel,
        metric: m,
        value: from.metrics[m.id],
        receipt: from.receipt.sha256.slice(0, 12),
        machine,
        obsidian: comp ? { value: comp.metrics[`obsidian.${m.id}`], receipt: comp.receipt.sha256.slice(0, 12), version: comp.obsidianVersion ?? "?" } : null,
      });
    }
  }
  return rows;
}

const T = {
  en: {
    title: "Performance, release by release",
    intro: "Every number below comes from a signed measurement receipt (Ed25519, `reports/*/PUBLIC_KEY.pem`); the receipt column is the first 12 hex digits of its sha256. Check one with `npm run nightly -- --verify <file>`. Lower is better. Obsidian is shown only where it was measured on the same machine, the same way.",
    cols: ["Release", "Metric", "Lumen", "Receipt", "Machine", "Obsidian (same machine)"],
    none: "No signed receipts yet. Numbers appear here once the nightly machine has sealed its first measurements.",
    rejected: "Receipts left out",
    generated: "Generated by `scripts/perf/perf-page.mjs` (W13.V5). Do not edit by hand.",
  },
  he: {
    title: "ביצועים, גרסה אחרי גרסה",
    intro: "כל מספר כאן מגיע מקבלת מדידה חתומה (Ed25519, `reports/*/PUBLIC_KEY.pem`); בעמודת הקבלה 12 התווים הראשונים של ה-sha256 שלה. בודקים קבלה עם `npm run nightly -- --verify <file>`. נמוך יותר טוב יותר. Obsidian מופיע רק במקום שנמדד על אותה מכונה, באותה דרך.",
    cols: ["גרסה", "מדד", "Lumen", "קבלה", "מכונה", "Obsidian (אותה מכונה)"],
    none: "עדיין אין קבלות חתומות. המספרים יופיעו כאן כשמכונת הלילה תחתום על המדידות הראשונות.",
    rejected: "קבלות שלא נכללו",
    generated: "נוצר על ידי `scripts/perf/perf-page.mjs` (W13.V5). לא לערוך ידנית.",
  },
};

const fmt = (v, unit, lang) => `${Number(v).toLocaleString(lang === "he" ? "he-IL" : "en-US")} ${unit}`;

/** The page in `lang` ("en" | "he"). */
export function renderPage(rows, rejected, lang) {
  const t = T[lang];
  const out = [`---`, `title: ${t.title}`, `---`, "", t.intro, ""];
  if (!rows.length) out.push(t.none, "");
  else {
    out.push(`| ${t.cols.join(" | ")} |`, `|${t.cols.map(() => "---").join("|")}|`);
    for (const r of rows) {
      const obs = r.obsidian ? `${fmt(r.obsidian.value, r.metric.unit, lang)} (${r.obsidian.version}, \`${r.obsidian.receipt}\`)` : "—";
      out.push(`| ${r.release} | ${r.metric[lang]} | ${fmt(r.value, r.metric.unit, lang)} | \`${r.receipt}\` | ${r.machine} | ${obs} |`);
    }
    out.push("");
  }
  if (rejected.length) {
    out.push(`## ${t.rejected}`, "");
    for (const x of rejected) out.push(`- \`${x.file}\`: ${x.why}`);
    out.push("");
  }
  out.push(`<small>${t.generated}</small>`, "");
  return out.join("\n");
}

/** Build both pages from receipt folders. */
export function build({ dirs, publicKeyPem }) {
  const { accepted, rejected } = loadReceipts(dirs, publicKeyPem);
  const rows = trend(accepted);
  return { rows, rejected, en: renderPage(rows, rejected, "en"), he: renderPage(rows, rejected, "he") };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const dirs = arg("dir") ? [resolve(arg("dir"))] : [join(ROOT, "reports", "metrics"), join(ROOT, "reports", "nightly")];
  const keyFile = arg("key") ?? [join(ROOT, "reports", "metrics", "PUBLIC_KEY.pem"), join(ROOT, "reports", "nightly", "PUBLIC_KEY.pem")].find(existsSync);
  const publicKeyPem = keyFile && existsSync(keyFile) ? readFileSync(keyFile, "utf8") : null;
  const out = resolve(arg("out") ?? join(ROOT, "docs", "perf"));
  const page = build({ dirs, publicKeyPem });
  const files = { "index.md": page.en, "index.he.md": page.he };
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([f, text]) => !existsSync(join(out, f)) || readFileSync(join(out, f), "utf8") !== text);
    if (stale.length) {
      console.error(`perf-page: stale ${stale.map(([f]) => f).join(", ")} — run node scripts/perf/perf-page.mjs`);
      process.exit(1);
    }
    console.log(`perf-page: up to date (${page.rows.length} numbers, ${page.rejected.length} receipts left out)`);
    return;
  }
  mkdirSync(out, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(out, f), text);
  console.log(`perf-page: ${page.rows.length} numbers from signed receipts, ${page.rejected.length} left out → ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
