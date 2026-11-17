/**
 * 12.1 — code health without a baseline:
 *  - every swallowed error says why: an empty `catch` block, or an empty
 *    function passed to `.catch(…)`, holds a `why:` comment (the same check
 *    as the `lumen/empty-catch-why` ESLint rule, so it also runs without ESLint);
 *  - no production file is longer than 800 lines (as ESLint `max-lines`
 *    counts), with no baseline and no exception (W10.E31: the files that
 *    were grandfathered were split, and the baseline was deleted);
 *  - eslint-suppressions.json records neither rule, so neither can be baselined.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { RETIRED_BASELINE_PATH, checkMaxLines, countLines, describeProblems, productionLineCounts } from "../../scripts/lib/maxLines.mjs";

const SRC = join(__dirname, "..");
const MAX_LINES = 800;
const WHY = /^\s*why:\s*\S/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

/** Comment texts between two offsets, with leading spaces and stars removed. */
function commentsBetween(text: string, start: number, end: number): string[] {
  const out: string[] = [];
  const re = /\/\/([^\n]*)|\/\*([\s\S]*?)\*\//g;
  const inner = text.slice(start, end);
  for (let m = re.exec(inner); m; m = re.exec(inner)) out.push((m[1] ?? m[2]).replace(/^[\s*]+/, ""));
  return out;
}

/**
 * The code a template literal ships as a string (a worker or iframe source
 * such as liveJsWorkerSource.ts or sandbox.ts's boot page), with each `${…}`
 * replaced by a placeholder identifier, or null when it holds no `catch`.
 */
function shippedCode(n: ts.Node): string | null {
  let code: string;
  if (ts.isNoSubstitutionTemplateLiteral(n)) code = n.text;
  else if (ts.isTemplateExpression(n)) code = n.head.text + n.templateSpans.map((s) => "__x" + s.literal.text).join("");
  else return null;
  if (/<script\b/i.test(code)) {
    // An HTML page: only its inline scripts are code. Everything else becomes
    // its line breaks, so line numbers still match.
    const lines = (s: string) => s.replace(/[^\n]/g, "");
    let scripts = "";
    let last = 0;
    for (const m of code.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script>|$)/gi)) {
      scripts += lines(code.slice(last, m.index + m[1].length)) + m[2];
      last = m.index + m[0].length;
    }
    code = scripts;
  }
  // `catch` alone is often prose ("we catch it later"), and so is `try` (a BIP-39 word list has both,
  // W11.S9's bip39.ts); code has a `try {` block or a `.catch(` call.
  return /\btry\s*\{/.test(code) || /\.catch\s*\(/.test(code) ? code : null;
}

/**
 * Empty catch blocks / `.catch()` handlers without a `why:` comment in one
 * piece of source. `label(line)` names a 1-based line of `text`. Template
 * literals that ship code as a string are scanned the same way, so a worker
 * kept in a string is held to the same rule as the module around it.
 */
function swallowedIn(text: string, label: (line: number) => string, kind: ts.ScriptKind = ts.ScriptKind.TS): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("scan." + (kind === ts.ScriptKind.TSX ? "tsx" : "ts"), text, ts.ScriptTarget.Latest, true, kind);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const empty = (b: ts.Block) => b.statements.length === 0 && !commentsBetween(text, b.getStart(sf) + 1, b.end - 1).some((c) => WHY.test(c));
  const visit = (n: ts.Node): void => {
    if (ts.isCatchClause(n) && empty(n.block)) out.push(`${label(line(n))} catch`);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch") {
      const h = n.arguments[0];
      if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) && ts.isBlock(h.body) && empty(h.body)) out.push(`${label(line(h))} .catch()`);
    }
    const code = shippedCode(n);
    if (code !== null) {
      // The literal's text starts on the line of its opening backtick; the
      // cooked text keeps the line breaks, so inner line k is outer line + k - 1.
      const at = line(n);
      out.push(...swallowedIn(code, (k) => label(at + k - 1), ts.ScriptKind.JS));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function swallowedWithoutWhy(): string[] {
  const out: string[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("catch")) continue;
    out.push(...swallowedIn(text, (l) => `${relative(SRC, file)}:${l}`, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  }
  return out;
}

/**
 * W10.A8 (audit r3): in storage and sync a handled error is never silent — a
 * catch block or `.catch()` handler does something (reports with
 * `swallowed()`/`log`, records, rethrows, falls back); a `why:` comment alone
 * is not enough there.
 */
function silentIn(text: string, label: (line: number) => string, kind: ts.ScriptKind = ts.ScriptKind.TS): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile("scan." + (kind === ts.ScriptKind.TSX ? "tsx" : "ts"), text, ts.ScriptTarget.Latest, true, kind);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (ts.isCatchClause(n) && n.block.statements.length === 0) out.push(`${label(line(n))} catch`);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch") {
      const h = n.arguments[0];
      if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) && ts.isBlock(h.body) && h.body.statements.length === 0) out.push(`${label(line(h))} .catch()`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("code health (12.1)", () => {
  it("W10.A8: no silent catch in storage or sync — every one reports, records, rethrows or falls back", () => {
    const silent: string[] = [];
    for (const dir of ["storage", "sync"]) {
      for (const file of files(join(SRC, dir))) {
        if (/[\\/]__tests__[\\/]|\.test\.tsx?$/.test(file)) continue;
        const text = readFileSync(file, "utf8");
        if (text.includes("catch")) silent.push(...silentIn(text, (l) => `${relative(SRC, file)}:${l}`, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
      }
    }
    expect(silent).toEqual([]);
    // The check itself: a why-only catch is silent, a reporting one is not.
    const at = (l: number) => `f.ts:${l}`;
    expect(silentIn("try { a(); } catch { /* why: x */ }\np.catch(() => {\n  // why: y\n});\n", at)).toEqual(["f.ts:1 catch", "f.ts:2 .catch()"]);
    expect(silentIn('try { a(); } catch (e) { /* why: x */ swallowed("f: x", e); }\np.catch((e) => { throw e; });\n', at)).toEqual([]);
  });


  it("every empty catch and empty .catch() handler says why, also in code shipped as a string", () => {
    expect(swallowedWithoutWhy()).toEqual([]);
  });

  it("scans worker and iframe sources kept in template literals", () => {
    const at = (l: number) => `f.ts:${l}`;
    // A worker in a plain template literal, and one with a substitution.
    const plain = "export const W = `\nself.onmessage = function() {\n  try { go(); } catch (e) {}\n};\n`;\n";
    expect(swallowedIn(plain, at)).toEqual(["f.ts:3 catch"]);
    const withSub = "const u = 1;\nexport const H = `<script>\nimport(${u}).catch(function() {});\ntry { x(); } catch {}\n</script>`;\n";
    expect(swallowedIn(withSub, at)).toEqual(["f.ts:3 .catch()", "f.ts:4 catch"]);
    // A `why:` comment inside the string counts, as it does in a module.
    const why = "export const W = `try { go(); } catch (e) { /* why: the worker is closing */ }`;\n";
    expect(swallowedIn(why, at)).toEqual([]);
    // Prose that mentions catch is not code.
    expect(swallowedIn("export const T = `we catch it later`;\n", at)).toEqual([]);
    // Nor is a word list that has both words (bip39.ts): no `try {` block, no `.catch(` call.
    expect(swallowedIn("export const W = `cat catalog catch\ncategory try tube`;\n", at)).toEqual([]);
  });

  describe(`no production file is longer than ${MAX_LINES} lines (W6.25; W10.E31: no baseline)`, () => {
    const ROOT = join(SRC, "..");

    it("no production file passes 800 lines", () => {
      expect(describeProblems(checkMaxLines(productionLineCounts(ROOT)))).toEqual([]);
    });

    it("there is no baseline to grandfather a file", () => {
      expect(existsSync(join(ROOT, RETIRED_BASELINE_PATH))).toBe(false);
    });

    it("the check flags every file over 800, and nothing else", () => {
      expect(checkMaxLines({ "src/a.ts": 800, "src/c.ts": 1200, "src/b.ts": 801 })).toEqual({
        tooLong: [{ file: "src/b.ts", lines: 801 }, { file: "src/c.ts", lines: 1200 }],
      });
      expect(describeProblems(checkMaxLines({ "src/x.ts": 900 }))).toEqual(["src/x.ts: 900 lines, over 800 (split it into smaller modules)"]);
    });

    it("counts lines as ESLint max-lines does", () => {
      expect([countLines(""), countLines("a"), countLines("a\n"), countLines("a\nb"), countLines("a\r\nb\n\n"), countLines("\n")]).toEqual([0, 1, 1, 2, 3, 1]);
    });
  });

  it("the ESLint baseline records neither rule", () => {
    const suppressions = JSON.parse(readFileSync(join(SRC, "..", "eslint-suppressions.json"), "utf8")) as Record<string, Record<string, unknown>>;
    const baselined = Object.entries(suppressions).flatMap(([f, rules]) =>
      Object.keys(rules)
        .filter((r) => r === "lumen/empty-catch-why" || r === "max-lines")
        .map((r) => `${f} ${r}`),
    );
    expect(baselined).toEqual([]);
  });
});
