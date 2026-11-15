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

function swallowedWithoutWhy(): string[] {
  const out: string[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("catch")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (n: ts.Node) => `${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const empty = (b: ts.Block) => b.statements.length === 0 && !commentsBetween(text, b.getStart(sf) + 1, b.end - 1).some((c) => WHY.test(c));
    const visit = (n: ts.Node): void => {
      if (ts.isCatchClause(n) && empty(n.block)) out.push(`${where(n)} catch`);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch") {
        const h = n.arguments[0];
        if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) && ts.isBlock(h.body) && empty(h.body)) out.push(`${where(h)} .catch()`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("code health (12.1)", () => {
  it("every empty catch and empty .catch() handler says why", () => {
    expect(swallowedWithoutWhy()).toEqual([]);
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
