#!/usr/bin/env node
/**
 * Logical-CSS gate for the whole of src/ (plan W13.H2).
 *
 * Plan 9.3 guards the editor and the preview. Panels, dialogs and menus —
 * and code that a model writes — bring back `margin-left`, `right: 0`,
 * `paddingRight`, `ml-2` or `text-left`, and in Hebrew the layout then does
 * not mirror. This gate scans every stylesheet, every inline style object and
 * every Tailwind class string under src/ (scripts/lib/logicalCss.mjs says
 * exactly what counts) and compares the count per file with
 * scripts/logical-css.baseline.json:
 *
 *   - a file above its baseline count fails (a new file starts at 0), so
 *     adding `margin-left` anywhere fails the gate;
 *   - a file below its baseline count fails too, until the baseline is
 *     lowered with `--update`: every PR that removes physical properties
 *     records the new, lower number (the W6.25 ratchet);
 *   - `--update` only lowers. It refuses while any file is above its count —
 *     raising the baseline is an owner decision (`--write`, never in a PR).
 *
 * An intentional physical property (coordinates from getBoundingClientRect,
 * CodeMirror's caret border) takes `logical-allow: <reason>` (or 9.3's
 * `hygiene-allow: <reason>`) in a comment on its line or the line above.
 *
 * Usage:
 *   node scripts/check-logical-css.mjs            the gate
 *   node scripts/check-logical-css.mjs --list     every finding with its fix
 *   node scripts/check-logical-css.mjs --update   lower the baseline to today
 *   node scripts/check-logical-css.mjs --root <dir>  scan another tree (tests)
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanFile, compareBaseline } from "./lib/logicalCss.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = "scripts/logical-css.baseline.json";

const SKIP_DIR = /^(node_modules|__tests__|__mocks__|generated|dist)$/;
const SKIP_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIR.test(name)) walk(full, out);
    } else if (/\.(css|tsx?|jsx)$/.test(name) && !SKIP_FILE.test(name)) out.push(full);
  }
  return out;
}

/** Scan a tree: `{ files: number, counts: {rel: n}, findings: {file, line, kind, text, fix}[] }`. */
export function scanTree(root) {
  const src = join(root, "src");
  if (!existsSync(src)) return { files: 0, counts: {}, findings: [] };
  const files = walk(src);
  const counts = {};
  const findings = [];
  for (const f of files) {
    const rel = relative(root, f).split("\\").join("/");
    const found = scanFile(f, readFileSync(f, "utf8"));
    if (found.length) {
      counts[rel] = found.length;
      for (const x of found) findings.push({ file: rel, ...x });
    }
  }
  return { files: files.length, counts, findings };
}

export function readBaseline(root) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return { total: 0, files: {} };
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { total: j.total ?? 0, files: j.files ?? {} };
}

export function writeBaseline(root, counts) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  const body = {
    $comment:
      "Plan W13.H2 — physical CSS properties (margin-left, right:, paddingRight, ml-2, text-left…) per file under src/, frozen when the gate landed. Only goes down: fix the file, then `node scripts/check-logical-css.mjs --update`.",
    total,
    files: sorted,
  };
  writeFileSync(join(root, BASELINE_PATH), JSON.stringify(body, null, 1) + "\n");
  return total;
}

/**
 * The gate. Returns `{ code, lines }`.
 * @param {string} root
 * @param {{ update?: boolean, write?: boolean, list?: boolean }} [opts]
 */
export function run(root, opts = {}) {
  const lines = [];
  const { files, counts, findings } = scanTree(root);
  if (files === 0) return { code: 1, lines: [`✖ logical CSS: no source files under ${join(root, "src")} — nothing was checked.`] };
  const base = readBaseline(root);
  const { over, under } = compareBaseline(counts, base.files);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (opts.list) for (const f of findings) lines.push(`${f.file}:${f.line}  [${f.kind}] ${f.text}  → ${f.fix}`);
  if (opts.write) {
    const t = writeBaseline(root, counts);
    lines.push(`logical CSS: baseline written from scratch — ${t} (owner decision only).`);
    return { code: 0, lines };
  }
  if (over.length) {
    lines.push(`✖ logical CSS: ${over.length} file(s) above the baseline (${BASELINE_PATH}):`);
    const byFile = new Map(over.map((o) => [o.file, o]));
    for (const f of findings) {
      const o = byFile.get(f.file);
      if (o) lines.push(`  ${f.file}:${f.line}  [${f.kind}] ${f.text}  → ${f.fix}`);
    }
    for (const o of over) lines.push(`  ${o.file}: ${o.now} now, ${o.was} allowed`);
    lines.push("Use the logical property shown, or add `/* logical-allow: <reason> */` (`// logical-allow: <reason>` in TS) on the line or the one above.");
    if (opts.update) lines.push("--update only lowers the baseline; it does not raise it.");
    return { code: 1, lines };
  }
  if (under.length) {
    if (opts.update) {
      const t = writeBaseline(root, counts);
      lines.push(`logical CSS: baseline lowered ${base.total} → ${t}.`);
      return { code: 0, lines };
    }
    lines.push(`✖ logical CSS: ${under.length} file(s) below the baseline — record the lower number:`);
    for (const u of under) lines.push(`  ${u.file}: ${u.now} now, baseline ${u.was}`);
    lines.push("Run `node scripts/check-logical-css.mjs --update` and commit scripts/logical-css.baseline.json.");
    return { code: 1, lines };
  }
  lines.push(`logical CSS: ${files} files scanned; ${total} physical properties, all in the baseline (${base.total}).`);
  return { code: 0, lines };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf("--root");
  const root = ri >= 0 ? resolve(argv[ri + 1]) : resolve(HERE, "..");
  const { code, lines } = run(root, { update: argv.includes("--update"), write: argv.includes("--write"), list: argv.includes("--list") });
  for (const l of lines) (code ? console.error : console.log)(l);
  process.exit(code);
}
