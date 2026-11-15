#!/usr/bin/env node
/**
 * Failure signatures for local train runs (R12.12).
 *
 * A red run is a pile of text. Here each failure in it gets a key that is
 * the same on the next run of the same failure, and different for a
 * different failure:
 *
 *   1. The log is cut into failure blocks. Understood: vitest ("FAIL  file >
 *      suite > test", "× test"), the offline shim v4 ("FAIL suite > test"),
 *      node --test TAP ("not ok N - name") and a bare stack ("Error: …").
 *   2. Each block is masked: ANSI colours, absolute paths (down to the repo
 *      path), line:col, hex ids, UUIDs, ISO times, durations and every other
 *      number become placeholders. What is left is what the failure *is*.
 *   3. The key is sha1(test name, error head, first in-repo stack frame), all
 *      masked: 12 hex digits. A timing change or another worktree path keeps
 *      the key; another error message or another throwing function changes it.
 *   4. Drain (He et al., ICWS 2017: a fixed-depth parse tree over token count
 *      and leading tokens, a similarity threshold, `<*>` for the tokens that
 *      differ) groups the error heads of many failures into templates, so the
 *      report says "12 failures, 3 kinds".
 *
 * Clean reimplementation; design reference only: israelconnect's
 * tools/control/fail_sig.py (AGPL), no code copied. Drain is the published
 * algorithm.
 *
 * CLI: node scripts/ci-doctor/failSig.mjs <log> [more logs…] [--json]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** The masked form of one line: what stays the same between two runs of one failure. */
export function maskLine(line) {
  return (
    line
      .replace(ANSI, "")
      // file:///abs/…/src/x.ts:12:3 and /abs/…/src/x.ts:12:3 → src/x.ts; paths outside a repo dir → <path>
      .replace(/(?:file:\/\/)?(?:\/[\w.@+-]+)+\/((?:src|scripts|e2e|mcp-server|desktop|tests?|docs|eval|plan|public)\/[\w./@+-]*)/g, "$1")
      .replace(/(?:file:\/\/)?(?:\/(?:home|tmp|private|var|Users|opt|root|usr)[\w./@+-]*)/g, "<path>")
      .replace(/(\.[cm]?[jt]sx?|\.mjs|\.json|\.md):\d+(?::\d+)?/g, "$1")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
      .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
      .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/gi, "<hex>")
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|m|min|µs|us|ns)\b/g, "<dur>")
      .replace(/(?<![A-Za-z])\d+(?:\.\d+)?(?![A-Za-z])/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* ─── Failure blocks ─────────────────────────────────────────────────── */

const HEADERS = [
  // vitest: " FAIL  src/__tests__/x.test.ts > suite > test" ; shim v4: "FAIL suite > test"
  { re: /^\s*FAIL\s+(.+?)\s*$/, kind: "vitest" },
  // vitest/jest list form: " × suite > test 12ms" / " ✗ test"
  { re: /^\s*[×✗✕]\s+(.+?)\s*(?:\d+\s?ms)?\s*$/, kind: "vitest" },
  // node --test TAP
  { re: /^\s*not ok \d+ - (.+?)\s*$/, kind: "tap" },
];
const END = /^\s*(?:Test Files|Tests|Duration|pass \d+ fail \d+|v4: (?:node|browser) pass|# (?:tests|pass|fail) |⎯{5,}|ok \d+ - )/;
const BARE_ERROR = /^(?:Uncaught )?(?:[A-Z]\w*(?:Error|Exception)|Error|TypeError|panic)(?:\s*\[[\w-]+\])?:\s/;

/**
 * Failure blocks of a log, in order: `{ test, lines, kind }`. A log with no
 * test header but an uncaught error gives one block named "(no test)".
 */
export function failureBlocks(log) {
  const lines = String(log).replace(/\r\n/g, "\n").replace(ANSI, "").split("\n");
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h = HEADERS.map((x) => ({ m: x.re.exec(line), kind: x.kind })).find((x) => x.m);
    // A vitest "FAIL file" line alone (no " > ") is a file header when the next lines name tests; keep it as a block anyway.
    if (h) {
      cur = { test: h.m[1], lines: [], kind: h.kind };
      blocks.push(cur);
      continue;
    }
    if (cur && END.test(line)) {
      cur = null;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (!blocks.length) {
    const at = lines.findIndex((l) => BARE_ERROR.test(l.trim()));
    if (at >= 0) blocks.push({ test: "(no test)", lines: lines.slice(at, at + 30), kind: "bare" });
  }
  // A file-level FAIL line followed by test-level ones adds nothing; drop it when its body is empty.
  return blocks.filter((b, i) => b.lines.some((l) => l.trim()) || !blocks.slice(i + 1).some((n) => n.test.startsWith(b.test)));
}

/** The first line that says what went wrong. */
function errorHead(block) {
  const ls = block.lines.map((l) => l.trim()).filter(Boolean);
  const named = ls.find((l) => BARE_ERROR.test(l) || /^(?:AssertionError|expect\(|Expected|Cannot|Unable|Timeout|Test timed out)/.test(l));
  return named ?? ls.find((l) => !/^(?:at |❯ |---|\.\.\.|- Expected|\+ Received)/.test(l)) ?? "";
}

/** The first stack frame in the repo's own code, as `file#function` without line numbers. */
function repoFrame(block) {
  for (const raw of block.lines) {
    const l = raw.trim();
    const m = /^(?:at\s+(?:async\s+)?(?:(.+?)\s+\()?|❯\s+(?:(.+?)\s+)?)(?:file:\/\/)?([^\s()]+?)(?::\d+){0,2}\)?$/.exec(l);
    if (!m) continue;
    const path = maskLine(m[3]);
    if (/node_modules|node:internal|^node:|<path>/.test(path) || !/\//.test(path)) continue;
    return `${path}#${(m[1] ?? m[2] ?? "").replace(/^(?:Object|Module)\./, "") || "?"}`;
  }
  return "";
}

/**
 * Signatures of every failure in a log. `key` is stable across runs of the
 * same failure; `head` is the masked error head that Drain clusters.
 */
export function signatures(log) {
  return failureBlocks(log).map((b) => {
    const test = maskLine(b.test);
    const head = maskLine(errorHead(b));
    const frame = repoFrame(b);
    const key = createHash("sha1").update(`${test}\n${head}\n${frame}`).digest("hex").slice(0, 12);
    return { key, test, head, frame, kind: b.kind };
  });
}

/* ─── Drain ──────────────────────────────────────────────────────────── */

const tokens = (s) => s.split(" ").filter(Boolean);
const hasDigit = (t) => /\d|<n>|<hex>|<uuid>|<dur>|<ts>|<path>/.test(t);

/** Share of positions where the template and the tokens agree (a `<*>` agrees with anything). */
function similarity(template, toks) {
  let same = 0;
  for (let i = 0; i < toks.length; i++) if (template[i] === toks[i] || template[i] === "<*>") same++;
  return same / toks.length;
}

/**
 * Drain clustering of masked lines. `depth` levels of leading tokens (a token
 * with a placeholder or digit goes under `<*>`), then the most similar
 * cluster in the leaf above `sim`, else a new one. Deterministic for a given
 * input order.
 */
export function drain(lines, { depth = 2, sim = 0.5, maxChildren = 100 } = {}) {
  const root = new Map(); // token count → nested Map → leaf array
  const clusters = [];
  for (const line of lines) {
    const toks = tokens(line);
    if (!toks.length) continue;
    let node = root.get(toks.length) ?? root.set(toks.length, new Map()).get(toks.length);
    for (let d = 0; d < Math.min(depth, toks.length); d++) {
      let t = hasDigit(toks[d]) ? "<*>" : toks[d];
      if (!node.has(t) && node.size >= maxChildren) t = "<*>";
      node = node.get(t) ?? node.set(t, new Map()).get(t);
    }
    const leaf = node.get("\u0000leaf") ?? node.set("\u0000leaf", []).get("\u0000leaf");
    let best = null;
    let bestSim = -1;
    for (const c of leaf) {
      const s = similarity(c.template, toks);
      if (s > bestSim) {
        best = c;
        bestSim = s;
      }
    }
    if (best && bestSim >= sim) {
      best.template = best.template.map((t, i) => (t === toks[i] ? t : "<*>"));
      best.members.push(line);
    } else {
      const c = { id: clusters.length + 1, template: toks.slice(), members: [line] };
      leaf.push(c);
      clusters.push(c);
    }
  }
  return clusters.map((c) => ({ id: c.id, template: c.template.join(" "), size: c.members.length }));
}

/** Signatures of many logs, grouped by Drain template of their error heads. */
export function report(logs) {
  const sigs = logs.flatMap((l) => signatures(l.text).map((s) => ({ ...s, log: l.name })));
  const clusters = drain(sigs.map((s) => s.head || s.test));
  return { failures: sigs.length, keys: [...new Set(sigs.map((s) => s.key))].length, clusters, signatures: sigs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error("usage: node scripts/ci-doctor/failSig.mjs <log> [more logs…] [--json]");
    process.exit(2);
  }
  const r = report(files.map((f) => ({ name: f, text: readFileSync(f, "utf8") })));
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`${r.failures} failure(s), ${r.keys} signature(s), ${r.clusters.length} kind(s)`);
    for (const s of r.signatures) console.log(`${s.key}  ${s.test}\n              ${s.head}${s.frame ? `\n              at ${s.frame}` : ""}`);
  }
}
