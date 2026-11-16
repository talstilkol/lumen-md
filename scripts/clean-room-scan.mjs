#!/usr/bin/env node
/**
 * Clean-room scan (plan W12.E1/E8: "clean reimplementation; design
 * reference only until R12.1"): does any file under <ours…> share a long run
 * of code tokens with a file under <reference>?
 *
 *   node scripts/clean-room-scan.mjs --ref <dir> [--ref <dir>…] [--k 40] [--json] <our path…>
 *
 * Both sides are cut into tokens with comments and string contents dropped
 * (identifiers, keywords, numbers and punctuation kept) and every k-token
 * window is hashed. A window that both sides hold is a shared run; runs
 * that touch each other are merged and reported with file and line. Short
 * idioms (`for (let i = 0; i < n; i++) {`) are far below k = 40 tokens, and a
 * window needs 8 distinct non-keyword identifiers to count. The
 * reference is only read, never copied; nothing leaves the machine.
 *
 * Exit 1 when a shared run is found, 0 when none, 2 on bad usage.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CODE = /\.(m?[jt]sx?|py|cjs|mts)$/;
const SKIP_ALWAYS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
/** In the reference: its data and research are not read at all (owner rule), only code. */
const SKIP_REF = new Set([...SKIP_ALWAYS, "data", "history", "gold", "research", "docs", "vendor", "fixtures"]);
/** Generated or minified files (a line over 2,000 characters) are not anyone's hand-written code. */
const generated = (src) => src.split("\n").some((l) => l.length > 2000);
const KEYWORDS = new Set("S const let var function return if else for while of in new import export from as async await this true false null undefined def self None True False class elif not and or is pass lambda with try except finally raise yield typeof void".split(" "));
/**
 * A window is code worth reporting only when it holds at least 8 distinct
 * identifiers that are not keywords: a run of strings, numbers and
 * punctuation (a list literal, a table) or a stock idiom is not a copy.
 */
const distinctive = (toks) => new Set(toks.filter((x) => /^[A-Za-z_$\u0590-\u05FF]/.test(x.t) && !KEYWORDS.has(x.t)).map((x) => x.t)).size >= 8;

/** Tokens of a JS/TS/Python source, with comments and string contents dropped. Each token keeps its line. */
export function tokenize(src, file = "") {
  const py = file.endsWith(".py");
  const out = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    // comments
    if (!py && c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (!py && c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (py && c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // strings: one token "S", contents dropped (docstrings included)
    if (c === '"' || c === "'" || c === "`") {
      const triple = py && src.startsWith(c.repeat(3), i);
      const end = triple ? c.repeat(3) : c;
      i += end.length;
      while (i < n && !src.startsWith(end, i)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "\n") {
          line++;
          if (!triple && c !== "`") break;
        }
        i++;
      }
      i += end.length;
      out.push({ t: "S", line });
      continue;
    }
    const w = /^[A-Za-z_$֐-׿][\w$֐-׿]*|^\d[\d_.xXa-fA-FeE]*/.exec(src.slice(i, i + 200));
    if (w) {
      out.push({ t: w[0], line });
      i += w[0].length;
      continue;
    }
    const op = /^(===|!==|\*\*=|\.\.\.|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|::|->)/.exec(src.slice(i, i + 4));
    const t = op ? op[0] : c;
    out.push({ t, line });
    i += t.length;
  }
  return out;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function* walk(p, skip) {
  const st = statSync(p);
  if (st.isFile()) {
    if (CODE.test(p)) yield p;
    return;
  }
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory() && skip.has(e.name)) continue;
    yield* walk(path.join(p, e.name), skip);
  }
}

/** Windows of k tokens of one file: hash → first token index. */
function windows(tokens, k) {
  const m = new Map();
  for (let i = 0; i + k <= tokens.length; i++) {
    if (!distinctive(tokens.slice(i, i + k))) continue;
    const key = hash(tokens.slice(i, i + k).map((x) => x.t).join("\u0001"));
    if (!m.has(key)) m.set(key, i);
  }
  return m;
}

/**
 * Shared runs between our files and the reference files.
 * @param {{ ours: Array<{file: string, src: string}>, refs: Array<{file: string, src: string}>, k?: number }} o
 */
export function scan({ ours, refs, k = 40 }) {
  const refIndex = new Map(); // hash → [{file, tokens, at}]
  for (const r of refs) {
    const toks = tokenize(r.src, r.file);
    for (const [h, at] of windows(toks, k)) {
      const list = refIndex.get(h) ?? [];
      list.push({ file: r.file, tokens: toks, at });
      refIndex.set(h, list);
    }
  }
  const runs = [];
  for (const o of ours) {
    const toks = tokenize(o.src, o.file);
    let cur = null;
    for (let i = 0; i + k <= toks.length; i++) {
      const key = hash(toks.slice(i, i + k).map((x) => x.t).join("\u0001"));
      const hit = refIndex.get(key);
      // Check the real tokens (a hash collision is not a copy).
      const real = hit?.find((h) => h.tokens.slice(h.at, h.at + k).every((x, j) => x.t === toks[i + j].t));
      if (real) {
        if (cur && cur.refFile === real.file && i <= cur.endTok) cur.endTok = i + k;
        else {
          if (cur) runs.push(cur);
          cur = { file: o.file, startTok: i, endTok: i + k, refFile: real.file, refAt: real.at, refTokens: real.tokens };
        }
      }
    }
    if (cur) runs.push(cur);
    for (const r of runs.filter((x) => x.file === o.file && x.fromLine === undefined)) {
      r.fromLine = toks[r.startTok].line;
      r.toLine = toks[r.endTok - 1].line;
      r.tokens = r.endTok - r.startTok;
      r.refLine = r.refTokens[r.refAt].line;
      delete r.refTokens;
    }
  }
  return runs.map(({ file, fromLine, toLine, tokens, refFile, refLine }) => ({ file, fromLine, toLine, tokens, refFile, refLine }));
}

function main(argv) {
  const refs = [];
  const ours = [];
  let k = 40;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") refs.push(argv[++i]);
    else if (argv[i] === "--k") k = Number(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else ours.push(argv[i]);
  }
  if (!refs.length || !ours.length || !(k >= 8)) {
    console.error("usage: node scripts/clean-room-scan.mjs --ref <dir> [--ref <dir>…] [--k 40] [--json] <our path…>");
    return 2;
  }
  const read = (dirs, skip) => dirs.flatMap((d) => [...walk(d, skip)]).map((file) => ({ file, src: readFileSync(file, "utf8") }));
  const o = read(ours, SKIP_ALWAYS);
  const r = read(refs, SKIP_REF).filter((x) => !generated(x.src));
  const runs = scan({ ours: o, refs: r, k });
  if (json) console.log(JSON.stringify({ k, ourFiles: o.length, refFiles: r.length, runs }, null, 2));
  else {
    console.log(`clean-room scan: ${o.length} of our files against ${r.length} reference files, windows of ${k} tokens`);
    for (const x of runs) console.log(`  SHARED ${x.tokens} tokens: ${x.file}:${x.fromLine}-${x.toLine}  ~  ${x.refFile}:${x.refLine}`);
    console.log(runs.length ? `clean-room scan: ${runs.length} shared run(s)` : "clean-room scan: no shared run");
  }
  return runs.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
