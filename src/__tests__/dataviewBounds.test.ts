/**
 * Review 11, M3 and L4 (#1043): a Dataview query is bounded, and the page
 * cache sees an edit that keeps the time and the size.
 *
 * - A chained FLATTEN grows about 20× per step: past MAX_ROWS rows it throws
 *   a DataviewLimitError (a DataviewError) instead of building millions.
 * - Nested lambdas: past EVAL_BUDGET evaluations, the same.
 * - padleft / padright past MAX_TEXT: the same.
 * - The block shows a friendly message in English and Hebrew.
 * - The cache is keyed by the text's hash too: the same mtime and length with
 *   other front matter is a new page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataviewError, DataviewLimitError, EVAL_BUDGET, MAX_ROWS, parseDataview, runDataview } from "../search/dataview";

const ROOT = resolve(__dirname, "../..");
const notes = Array.from({ length: 50 }, (_, i) => ({ path: `n${i}.md`, name: `n${i}.md`, modified: 1, content: `# n${i}\n` + Array.from({ length: 20 }, (_, j) => `[[l${j}]]`).join(" ") }));
const run = (src: string) => runDataview(parseDataview(src), notes, 0);

function limitOf(src: string): { error: unknown; ms: number } {
  const t0 = performance.now();
  try {
    run(src);
    return { error: null, ms: performance.now() - t0 };
  } catch (e) {
    return { error: e, ms: performance.now() - t0 };
  }
}

describe("Dataview bounds (review 11, M3)", () => {
  it("the bounds are what the review asked for", () => {
    expect(MAX_ROWS).toBe(100_000);
    expect(EVAL_BUDGET).toBeLessThanOrEqual(2_000_000);
  });

  it("two FLATTEN steps still run (20,000 rows)", () => {
    expect(run("LIST FLATTEN file.outlinks AS a FLATTEN file.outlinks AS b").rows).toHaveLength(20_000);
  });

  it("a third FLATTEN (400,000 rows) throws a DataviewLimitError, quickly", () => {
    const { error, ms } = limitOf("LIST FLATTEN file.outlinks AS a FLATTEN file.outlinks AS b FLATTEN file.outlinks AS c LIMIT 5");
    expect(error).toBeInstanceOf(DataviewLimitError);
    expect(error).toBeInstanceOf(DataviewError);
    expect((error as DataviewLimitError).kind).toBe("rows");
    expect(ms).toBeLessThan(5000);
  });

  it("four nested maps (160,000 calls per note) run out of the evaluation budget", () => {
    const { error } = limitOf("TABLE length(map(file.outlinks, (a) => map(file.outlinks, (b) => map(file.outlinks, (c) => map(file.outlinks, (d) => a))))) AS n");
    expect(error).toBeInstanceOf(DataviewLimitError);
    expect((error as DataviewLimitError).kind).toBe("budget");
    // Three still run: 8,000 calls per note.
    expect(run("TABLE length(map(file.outlinks, (a) => map(file.outlinks, (b) => map(file.outlinks, (c) => a)))) AS n").rows).toHaveLength(50);
  });

  it("padleft to 100 million characters is refused", () => {
    const { error } = limitOf('TABLE padleft("x", 100000000) AS p LIMIT 1');
    expect(error).toBeInstanceOf(DataviewLimitError);
    expect((error as DataviewLimitError).kind).toBe("string");
    expect(run('TABLE padleft("x", 5, "0") AS p LIMIT 1').rows[0].cells[0]).toBe("0000x");
  });

  it("the budget is per run: a run after a refused one starts afresh", () => {
    expect(limitOf("LIST FLATTEN file.outlinks AS a FLATTEN file.outlinks AS b FLATTEN file.outlinks AS c").error).toBeInstanceOf(DataviewLimitError);
    expect(run("LIST").rows).toHaveLength(50);
  });

  it("the block shows a friendly message for it, in English and Hebrew", () => {
    const en = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/lazy/queryBlock.json"), "utf8")) as Record<string, string>;
    const he = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/he/common.json"), "utf8")) as Record<string, string>;
    expect(en["query.tooLarge"]).toMatch(/too many rows|too long/);
    expect(he["query.tooLarge"]).toMatch(/[֐-׿]/);
    const block = readFileSync(resolve(ROOT, "src/views/QueryBlock.tsx"), "utf8");
    expect(block).toMatch(/instanceof DataviewLimitError \? t\("query\.tooLarge"\)/);
  });
});

describe("the page cache sees an edit that keeps the time and the size (review 11, L4)", () => {
  it("same path, mtime and length, other front matter: the new value", () => {
    const q = parseDataview('LIST WHERE status = "open"');
    const a = [{ path: "x.md", name: "x.md", modified: 5, content: "---\nstatus: open\n---\n" }];
    const b = [{ path: "x.md", name: "x.md", modified: 5, content: "---\nstatus: done\n---\n" }];
    expect(a[0].content.length).toBe(b[0].content.length);
    expect(runDataview(q, a, 0).rows).toHaveLength(1);
    expect(runDataview(q, b, 0).rows).toHaveLength(0);
    expect(runDataview(q, a, 0).rows).toHaveLength(1);
  });
});
