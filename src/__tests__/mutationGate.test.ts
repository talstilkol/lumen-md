/**
 * Plan 0.15: the mutation gate's bookkeeping (scripts/mutation-gate.mjs):
 * stable survivor keys, per-module scores, new survivors and stale
 * baseline entries. The Stryker run itself is in the PR description.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
// @ts-expect-error -- plain .mjs script, no types
import { judge, mutantKey, summarize } from "../../scripts/mutation-gate.mjs";

const ROOT = join(__dirname, "../..");
const SRC = "export function f(a, b) {\n  return a > b ? a : b;\n}\n";
const loc = (line: number, c1: number, c2: number) => ({ start: { line, column: c1 }, end: { line, column: c2 } });

function report(statuses: string[]) {
  const mutants = statuses.map((status, i) => ({ id: String(i), mutatorName: i % 2 ? "EqualityOperator" : "ConditionalExpression", replacement: i % 2 ? "a >= b" : "true", location: loc(2, 10, 15), status }));
  return { files: { [join(ROOT, "src/lib/x.ts")]: { source: SRC, mutants } } };
}

describe("mutation gate", () => {
  it("keys a mutant by file, mutator and text, not by line number", () => {
    const m = { mutatorName: "EqualityOperator", replacement: "a >= b", location: loc(2, 10, 15) };
    expect(mutantKey("src/lib/x.ts", SRC, m)).toBe("src/lib/x.ts · EqualityOperator · a > b → a >= b");
    // The same mutant two lines lower keeps its key.
    expect(mutantKey("src/lib/x.ts", "// a\n// b\n" + SRC, { ...m, location: loc(4, 10, 15) })).toBe("src/lib/x.ts · EqualityOperator · a > b → a >= b");
  });

  it("scores killed + timeout over covered mutants, per module", () => {
    const files = summarize(report(["Killed", "Survived", "Timeout", "NoCoverage"]));
    expect(files["src/lib/x.ts"]).toMatchObject({ killed: 2, covered: 3, total: 4 });
    expect(files["src/lib/x.ts"].score).toBeCloseTo(66.67, 1);
  });

  it("fails a new survivor and a module under 70 %, passes a known survivor, reports stale entries", () => {
    const files = summarize(report(["Killed", "Survived", "Killed", "Killed"]));
    const key = files["src/lib/x.ts"].survivors[0];
    expect(judge(files, { survivors: [] })).toMatchObject({ ok: false, fresh: [key] });
    expect(judge(files, { survivors: [key] })).toMatchObject({ ok: true, fresh: [], stale: [] });
    const gone = "src/lib/x.ts · BooleanLiteral · true → false";
    expect(judge(files, { survivors: [key, gone] }).stale).toEqual([gone]);
    const weak = summarize(report(["Killed", "Survived", "Survived", "Survived"]));
    expect(judge(weak, { survivors: weak["src/lib/x.ts"].survivors }).lowScore).toEqual([{ file: "src/lib/x.ts", score: 25 }]);
  });
});
