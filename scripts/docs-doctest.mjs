#!/usr/bin/env node
/**
 * Runnable examples in the docs (plan W13.D4, like Python's doctest).
 *
 * A code block whose info string carries the word `run` is executed:
 *   ```sh run       every non-comment line, one at a time, in the repo root
 *   ```bash run     (a leading "$ " is dropped); each must exit 0
 *   ```js run       the block as an ES module (node), in the repo root
 * A line `# expect: <text>` (sh) or `// expect: <text>` (js) also requires
 * <text> in the output. A block marked `illustrative` is an example to read,
 * never run. A command block (sh, bash, js, ts) with neither mark is
 * counted as a warning: say which it is.
 *
 *   node scripts/docs-doctest.mjs            every run block, a line each
 *   node scripts/docs-doctest.mjs --summary  one line (docs-audit prints it)
 *   node scripts/docs-doctest.mjs --list     the blocks, nothing run
 *
 * The same command in an English page and its Hebrew twin runs once.
 * Exit 1 when a run block fails — or when there is none (a doctest with
 * nothing to check proves nothing).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pages } from "./lib/docsMeta.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs/src/content/docs");
const COMMAND_LANGS = new Set(["sh", "bash", "shell", "console", "js", "mjs", "ts"]);

/** Fenced blocks of a Markdown text: { lang, meta, code, line }. */
export function extractBlocks(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(```+|~~~+)\s*([\w-]*)\s*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[2];
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(lines[j]); j++) body.push(lines[j]);
    out.push({ lang: open[3].toLowerCase(), meta: open[4].trim(), code: body.join("\n"), line: i + 1 });
    i = j;
  }
  return out;
}

/** "run", "illustrative" or null, from a block's info string. */
export function markOf(meta) {
  const words = meta.split(/\s+/);
  if (words.includes("run")) return "run";
  if (words.includes("illustrative")) return "illustrative";
  return null;
}

/** Run one block; returns { ok, detail }. */
export function runBlock(b, { cwd = ROOT, timeout = 120_000 } = {}) {
  const expects = [...b.code.matchAll(/(?:#|\/\/)\s*expect:\s*(.+)$/gm)].map((m) => m[1].trim());
  let output = "";
  try {
    if (b.lang === "js" || b.lang === "mjs") {
      const dir = mkdtempSync(join(tmpdir(), "doctest-"));
      const file = join(dir, "block.mjs");
      writeFileSync(file, b.code);
      try {
        output = execFileSync("node", [file], { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } else {
      for (const raw of b.code.split("\n")) {
        const line = raw.replace(/^\$\s+/, "").replace(/\s+#.*$/, "").trim();
        if (!line || line.startsWith("#")) continue;
        // stderr counts as output too (many checks report there).
        output += execFileSync("bash", ["-c", `${line} 2>&1`], { cwd, encoding: "utf8", timeout, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      }
    }
  } catch (e) {
    return { ok: false, detail: `exit ${e.status ?? "?"}: ${String(e.stderr ?? e.message).trim().split("\n").slice(-3).join(" / ")}` };
  }
  const missing = expects.filter((x) => !output.includes(x));
  return missing.length ? { ok: false, detail: `output lacks: ${missing.join(" | ")}` } : { ok: true, detail: "" };
}

export function collect(dir = DOCS) {
  const runs = new Map();
  let unmarked = 0;
  let illustrative = 0;
  for (const rel of pages(dir)) {
    for (const b of extractBlocks(readFileSync(join(dir, rel), "utf8"))) {
      const mark = markOf(b.meta);
      if (mark === "run") {
        const key = `${b.lang}\n${b.code}`;
        if (!runs.has(key)) runs.set(key, { ...b, where: `${rel}:${b.line}` });
      } else if (mark === "illustrative") illustrative++;
      else if (COMMAND_LANGS.has(b.lang)) unmarked++;
    }
  }
  return { runs: [...runs.values()], unmarked, illustrative };
}

function main(argv) {
  const { runs, unmarked, illustrative } = collect();
  if (argv.includes("--list")) {
    for (const r of runs) console.log(`${r.where}  ${r.lang}  ${r.code.split("\n")[0]}`);
    console.log(`${runs.length} run block(s), ${illustrative} illustrative, ${unmarked} unmarked`);
    return 0;
  }
  const failed = [];
  for (const r of runs) {
    const res = runBlock(r);
    if (!argv.includes("--summary")) console.log(`${res.ok ? "✓" : "✗"} ${r.where}  ${r.code.split("\n")[0]}${res.ok ? "" : `  — ${res.detail}`}`);
    if (!res.ok) failed.push({ ...r, ...res });
  }
  const warn = unmarked ? ` · ⚠ ${unmarked} command block(s) marked neither run nor illustrative` : "";
  if (!runs.length) {
    console.error("✗ docs-doctest: no run blocks — nothing was checked");
    return 1;
  }
  if (failed.length) {
    for (const f of failed) console.error(`✗ ${f.where}: ${f.detail}`);
    console.error(`✗ docs-doctest: ${failed.length} of ${runs.length} runnable example(s) failed${warn}`);
    return 1;
  }
  console.log(`✓ docs-doctest: ${runs.length}/${runs.length} runnable examples pass (${illustrative} illustrative)${warn}`);
  return 0;
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
