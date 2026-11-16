#!/usr/bin/env node
/**
 * Plan 0.16 — unused-file gate (the "files" half of knip, with no dependency).
 *
 * Walks the import graph from every entry point and reports production files
 * under src/ that nothing reaches. Entry points:
 *   - <script type="module" src="/src/…"> in every *.html page (root, public/, bench/ …)
 *   - every code file outside src/ that is not a test: scripts/, eval/, the root
 *     configs, and the other executables and packages that reuse src/ (bin/,
 *     api-server/, mcp-server/, packages/, extension/ …) — anything they import is used.
 *     A script that bundles a source file by its path (`build("src/types/api.ts")`)
 *     reaches it too.
 *
 * Tests are NOT entry points (audit A3, round 2): a module that only its own test
 * imports is built and tested but unreachable from the app, and the gate reports
 * it. That covers *.test.* / *.spec.* / *.eval.*, __tests__/ and __mocks__/
 * anywhere, and the e2e/ and tests/ folders. The test graph is still walked, to
 * tell the two kinds of unreached file apart:
 *   - a file no test reaches either is dead code: delete it;
 *   - a file only tests reach must be wired into the app (a command, a menu, a
 *     view, a setting) — or, when it is a library on purpose (an eval harness, a
 *     measurement, a seam whose engine is owed), listed in
 *     scripts/unused-files.library.json with the reason. The gate fails on a
 *     listed file the app now reaches (take it off the list) and on one no test
 *     reaches (it is dead).
 * Edges: static `import … from`, `export … from`, side-effect `import "…"`,
 * `import("…")`, `require("…")`, `new URL("…", import.meta.url)` (workers) and
 * `import.meta.glob("…")`. Specifiers resolve relative to the file or through the
 * `@/` alias (tsconfig paths); Vite query suffixes (`?worker`, `?raw`, `?url`) are
 * dropped. Package imports are ignored.
 *
 * The scan is textual, not an AST: an import-looking string inside a comment or a
 * template counts as an edge. That errs towards "used" — the gate never fails a
 * file that is actually imported.
 *
 * Today's orphans are in scripts/unused-files.baseline.json; the gate fails on a
 * NEW orphan, and on a baseline entry that is no longer an orphan (it was imported
 * or deleted — run with --prune to drop it). The baseline only shrinks. A file
 * that only baseline orphans import (a dead module's strings module) is listed as
 * held by that entry rather than failing: it is the same dead code and goes with it.
 *
 * Usage:
 *   node scripts/check-unused-files.mjs            check (CI)
 *   node scripts/check-unused-files.mjs --prune    drop stale baseline entries
 *   node scripts/check-unused-files.mjs --write    rewrite the baseline from scratch (owner decision)
 *   node scripts/check-unused-files.mjs --json     machine-readable result
 *
 * Exports and unused dependencies (the rest of knip) need the knip package;
 * see plan 0.16.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = "scripts/unused-files.baseline.json";
export const LIBRARY = "scripts/unused-files.library.json";

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "coverage", ".vite", "playwright-report", "test-results"]);

const toPosix = (p) => p.split(sep).join("/");

/** Production source under src/: not a test, not a declaration file. */
export function isProduction(rel) {
  if (!rel.startsWith("src/") || !CODE_RE.test(rel)) return false;
  if (/\.d\.[cm]?ts$/.test(rel)) return false;
  if (/\.(test|spec|eval)\.[cm]?[jt]sx?$/.test(rel)) return false;
  if (/(^|\/)__tests__\//.test(rel) || /(^|\/)__mocks__\//.test(rel)) return false;
  return true;
}

function walk(root, dir, out) {
  if (!existsSync(join(root, dir))) return out;
  for (const name of readdirSync(join(root, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Every module specifier a source text refers to. `globs` holds one array per
 * import.meta.glob call (its patterns, negative ones with their leading "!").
 * @returns {{ specs: string[], globs: string[][] }}
 */
export function extractSpecifiers(text) {
  const specs = [];
  const globs = [];
  const add = (re, list = specs) => {
    for (const m of text.matchAll(re)) list.push(m[1]);
  };
  add(/\bfrom\s*["'`]([^"'`\n]+)["'`]/g);
  add(/\bimport\s*["'`]([^"'`\n]+)["'`]/g);
  add(/\bimport\s*\(\s*["'`]([^"'`$\n]+)["'`]/g);
  add(/\brequire\s*\(\s*["'`]([^"'`$\n]+)["'`]/g);
  add(/\bvi\.(?:mock|doMock|importActual)\s*\(\s*["'`]([^"'`$\n]+)["'`]/g);
  add(/new\s+URL\s*\(\s*["'`]([^"'`$\n]+)["'`]\s*,\s*import\.meta\.url/g);
  // A Vitest config's setupFiles: paths from the repository root ("src/…"), loaded before every test file
  // of that config (vitest.eval.config.ts runs src/agents/eval/reproducible.ts for the live evals, W7.15).
  for (const m of text.matchAll(/\bsetupFiles\s*:\s*\[([^\]]*)\]/g)) {
    for (const f of m[1].matchAll(/["'`]([^"'`$\n]+)["'`]/g)) specs.push(f[1].startsWith("src/") ? `/${f[1]}` : f[1]);
  }
  for (const m of text.matchAll(/import\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/g)) {
    globs.push([...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((g) => g[1]));
  }
  return { specs, globs };
}

/** `<script … src="/src/main.tsx">` in an HTML page → repo-relative paths. */
export function htmlEntries(text) {
  const out = [];
  for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)) {
    const src = m[1];
    if (/^(https?:)?\/\//.test(src)) continue;
    out.push(src.replace(/^\//, ""));
  }
  return out;
}

/** A glob (only `*`, `**`, `{a,b}`) → RegExp over repo-relative posix paths. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Resolve a specifier from `fromRel` to a repo-relative file, or null (package / missing). */
export function resolveSpecifier(spec, fromRel, files) {
  const clean = spec.split("?")[0].split("#")[0];
  let base;
  if (clean.startsWith("@/")) base = `src/${clean.slice(2)}`;
  else if (clean.startsWith("./") || clean.startsWith("../")) base = toPosix(join(dirname(fromRel), clean));
  else if (clean.startsWith("/src/")) base = clean.slice(1);
  else return null;
  base = toPosix(base).replace(/^\.\//, "");
  if (files.has(base)) return base;
  const noJs = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  for (const ext of EXTS) {
    if (files.has(noJs + ext)) return noJs + ext;
    if (files.has(base + ext)) return base + ext;
  }
  for (const ext of EXTS) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

/** A test or test support, anywhere: *.test.* / *.spec.* / *.eval.*, __tests__/, __mocks__/, e2e/, tests/. */
export const isTestFile = (rel) => /\.(test|spec|eval)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(__tests__|__mocks__)\//.test(rel) || /^(e2e|tests)\//.test(rel);

/** Every code file outside src/ that is not a test (bin/, api-server/, packages/, extension/, scripts/, configs …). */
export const isEntryFile = (rel) => CODE_RE.test(rel) && !/\.d\.[cm]?ts$/.test(rel) && !rel.startsWith("src/") && !isTestFile(rel);

/**
 * @param {{ root?: string, baseline?: string[], library?: string[] }} [opts]
 * @returns {{ orphans: string[], production: number, held: Record<string, string>, testOnly: string[] }}
 *   held: orphan → the baseline or library entry it is reached from (only those orphans import it)
 *   testOnly: the orphans some test reaches (built and tested, but not reachable from the app)
 */
export function findOrphans({ root = ROOT, baseline = [], library = [] } = {}) {
  const all = walk(root, "", []);
  const files = new Set(all.map(toPosix));
  const code = all.filter((f) => CODE_RE.test(f) && !/\.d\.[cm]?ts$/.test(f));
  const production = code.filter(isProduction);

  const seen = new Set();
  const queue = [];
  const reach = (rel) => {
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      queue.push(rel);
    }
  };
  // Every HTML page is an entry: the root pages, public/, and the ones in
  // folders of their own (bench/models.html → src/bench/page.ts, plan 7.8).
  for (const f of all) {
    if (/\.html$/.test(f)) for (const e of htmlEntries(readFileSync(join(root, f), "utf8"))) reach(resolveSpecifier(`/${e}`, f, files));
  }
  for (const f of code) if (isEntryFile(f)) {
    reach(f);
    if (!f.startsWith("src/")) for (const m of readFileSync(join(root, f), "utf8").matchAll(/["'`](src\/[^"'`$\s]+\.(?:ts|tsx|js|jsx|mjs))["'`]/g)) if (files.has(m[1])) reach(m[1]);
  }
  walkFrom(root, files, code, queue, reach);
  const orphans = production.filter((f) => !seen.has(f)).sort();

  // The tests' own graph, only to tell "only tests reach it" from "nothing does".
  const byTests = new Set(seen);
  const tq = [];
  const treach = (rel) => {
    if (rel && !byTests.has(rel)) {
      byTests.add(rel);
      tq.push(rel);
    }
  };
  for (const f of code) if (isTestFile(f)) treach(f);
  walkFrom(root, files, code, tq, treach);
  const testOnly = orphans.filter((f) => byTests.has(f));

  // A file that only baseline orphans import (a dead module's own strings
  // module, say) is part of that dead code, not a new orphan: it is "held"
  // by the baseline entry it hangs from, and goes when that entry goes.
  // A file nothing imports at all is never held.
  const held = {};
  const orphanSet = new Set(orphans);
  const parents = [...baseline, ...library];
  for (const parent of parents.filter((f) => orphanSet.has(f))) {
    const sub = new Set([parent]);
    const q = [parent];
    walkFrom(root, files, code, q, (rel) => {
      if (rel && orphanSet.has(rel) && !sub.has(rel)) {
        sub.add(rel);
        q.push(rel);
      }
    });
    for (const f of sub) if (f !== parent && !parents.includes(f) && !(f in held)) held[f] = parent;
  }
  return { orphans, production: production.length, held, testOnly };
}

/**
 * Every file reachable from the app's own pages (the HTML entries only — no
 * script, package or test): what a user of the app can reach. The
 * reachability test (appReachable.test.ts) checks the audit's modules on it.
 * @returns {Set<string>}
 */
export function reachFromPages({ root = ROOT, pages = ["index.html"] } = {}) {
  const all = walk(root, "", []);
  const files = new Set(all.map(toPosix));
  const code = all.filter((f) => CODE_RE.test(f) && !/\.d\.[cm]?ts$/.test(f));
  const seen = new Set();
  const queue = [];
  const reach = (rel) => {
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      queue.push(rel);
    }
  };
  for (const p of pages) for (const e of htmlEntries(readFileSync(join(root, p), "utf8"))) reach(resolveSpecifier(`/${e}`, p, files));
  walkFrom(root, files, code, queue, reach);
  return seen;
}

/** Breadth-first over the import edges from `queue`, calling `reach` on every target. */
function walkFrom(root, files, code, queue, reach) {
  while (queue.length) {
    const rel = queue.shift();
    const { specs, globs } = extractSpecifiers(readFileSync(join(root, rel), "utf8"));
    for (const s of specs) reach(resolveSpecifier(s, rel, files));
    // One import.meta.glob call = one pattern set: a negative pattern
    // ("!./x/dead.ts") excludes from the positive ones, as Vite does, so an
    // excluded file is not marked used by the broad pattern beside it.
    for (const set of globs) {
      const toRe = (g) => {
        const abs = g.startsWith("@/") ? `src/${g.slice(2)}` : g.startsWith("/") ? g.slice(1) : toPosix(join(dirname(rel), g));
        return globToRegExp(toPosix(abs));
      };
      const include = set.filter((g) => !g.startsWith("!")).map(toRe);
      const exclude = set.filter((g) => g.startsWith("!")).map((g) => toRe(g.slice(1)));
      for (const f of code) if (include.some((re) => re.test(f)) && !exclude.some((re) => re.test(f))) reach(f);
    }
  }
}

/**
 * Compare today's orphans with the baseline and the library list. `held` (from
 * findOrphans): orphans that only baseline or library entries import — not new,
 * not failing. `library`: path → reason; `testOnly`: the orphans a test reaches.
 * @returns {{ added: string[], stale: string[], libraryReached: string[], libraryDead: string[], libraryNoReason: string[] }}
 */
export function compare(orphans, baseline, held = {}, library = {}, testOnly = orphans) {
  const now = new Set(orphans);
  const base = new Set(baseline);
  const tested = new Set(testOnly);
  const lib = Object.keys(library);
  return {
    added: orphans.filter((f) => !base.has(f) && !(f in held) && !(f in library)),
    stale: baseline.filter((f) => !now.has(f)),
    libraryReached: lib.filter((f) => !now.has(f)),
    libraryDead: lib.filter((f) => now.has(f) && !tested.has(f)),
    libraryNoReason: lib.filter((f) => typeof library[f] !== "string" || library[f].trim().length < 20),
  };
}

const readBaseline = (root) => {
  const p = join(root, BASELINE);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).files ?? [] : [];
};
const readLibrary = (root) => {
  const p = join(root, LIBRARY);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).files ?? {} : {};
};
const writeBaseline = (root, files) =>
  writeFileSync(
    join(root, BASELINE),
    JSON.stringify(
      {
        $comment: "Plan 0.16 — production files under src/ that nothing imports, frozen when the gate landed. Only shrinks: delete the file or import it, then `node scripts/check-unused-files.mjs --prune`.",
        files,
      },
      null,
      1,
    ) + "\n",
  );

function main(argv) {
  const flags = new Set(argv);
  const baseline = readBaseline(ROOT);
  const library = readLibrary(ROOT);
  const { orphans, production, held, testOnly } = findOrphans({ baseline, library: Object.keys(library) });
  if (flags.has("--write")) {
    writeBaseline(ROOT, orphans.filter((f) => !(f in held) && !(f in library)));
    console.log(`unused-files: baseline written — ${orphans.length} of ${production} production files`);
    return 0;
  }
  const { added, stale, libraryReached, libraryDead, libraryNoReason } = compare(orphans, baseline, held, library, testOnly);
  const libFail = libraryReached.length + libraryDead.length + libraryNoReason.length;
  if (flags.has("--prune")) {
    writeBaseline(ROOT, baseline.filter((f) => !stale.includes(f)));
    console.log(`unused-files: pruned ${stale.length} stale baseline entr${stale.length === 1 ? "y" : "ies"}`);
    return added.length ? 1 : 0;
  }
  if (flags.has("--json")) {
    console.log(JSON.stringify({ production, orphans: orphans.length, baseline: baseline.length, library: Object.keys(library).length, held, added, stale, libraryReached, libraryDead, libraryNoReason }, null, 1));
  } else {
    const nHeld = Object.keys(held).length;
    console.log(`unused-files: ${production} production files, ${orphans.length} unreachable from the app (${baseline.length} in the baseline, ${Object.keys(library).length} listed as libraries${nHeld ? `, ${nHeld} only imported by them` : ""})`);
    for (const [f, parent] of Object.entries(held)) console.log(`  · ${f} — only ${parent} (baseline or library list) imports it; it goes with that file`);
    const testedSet = new Set(testOnly);
    for (const f of added)
      console.error(testedSet.has(f) ? `  ✗ ${f} — only tests reach it, nothing in the app. Wire it in (a command, a menu, a view, a setting), delete it, or list it in ${LIBRARY} with the reason.` : `  ✗ ${f} — nothing imports it, not even a test. Delete it, or import it from where it's used.`);
    for (const f of libraryReached) console.error(`  ✗ ${f} is in ${LIBRARY} but the app reaches it now — take it off the list.`);
    for (const f of libraryDead) console.error(`  ✗ ${f} is in ${LIBRARY} but no test reaches it either — it is dead: delete it.`);
    for (const f of libraryNoReason) console.error(`  ✗ ${f} is in ${LIBRARY} without a reason (one sentence: why it is a library, and what would wire it).`);
    for (const f of stale) console.error(`  ✗ ${f} is in ${BASELINE} but is no longer an orphan — run: node scripts/check-unused-files.mjs --prune`);
  }
  return added.length || stale.length || libFail ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
