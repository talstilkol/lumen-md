// @vitest-environment node
/**
 * Plan W13.V2 — the leak gate's own logic: the heap verdict (baseline + 10 %,
 * nothing closed still alive) and the detached-DOM count of a Chromium heap
 * snapshot (V8's `detachedness`, or the older "Detached …" names). The full
 * run is `node scripts/perf/leak.mjs --notes 500` (nightly: perf-leak).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { countDetached, HEAP_SLACK, render, verdict } from "../../scripts/perf/leak.mjs";

const ROOT = resolve(__dirname, "..", "..");
const MB = 2 ** 20;

describe("the heap verdict", () => {
  it("passes within 10 % of the baseline with nothing left alive", () => {
    expect(HEAP_SLACK).toBe(0.1);
    expect(verdict("x", 100 * MB, 109 * MB).ok).toBe(true);
    expect(verdict("x", 100 * MB, 111 * MB).ok).toBe(false);
    expect(verdict("x", 100 * MB, 90 * MB, 1).ok).toBe(false);
    expect(verdict("x", 100 * MB, 110 * MB)).toMatchObject({ beforeMB: 100, afterMB: 110, growthPct: 10 });
  });
});

describe("detached DOM in a heap snapshot", () => {
  const snap = (fields: string[], rows: Array<[string, number?]>) => {
    const strings: string[] = [];
    const nodes: number[] = [];
    for (const [name, det] of rows) {
      strings.push(name);
      const row = fields.map((f) => (f === "name" ? strings.length - 1 : f === "detachedness" ? (det ?? 0) : 0));
      nodes.push(...row);
    }
    return { snapshot: { meta: { node_fields: fields } }, nodes, strings };
  };

  it("counts V8's detachedness = 2", () => {
    const s = snap(["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"], [["HTMLDivElement", 2], ["HTMLDivElement", 1], ["Text", 2], ["Object", 0]]);
    expect(countDetached(s)).toEqual({ total: 2, byName: { HTMLDivElement: 1, Text: 1 } });
  });

  it("counts the older 'Detached …' names", () => {
    const s = snap(["type", "name", "id"], [["Detached HTMLDivElement"], ["HTMLDivElement"], ["Detached Text"]]);
    expect(countDetached(s).total).toBe(2);
  });
});

describe("the report and its wiring", () => {
  it("prints a row per phase with the object counts", () => {
    const out = render([{ ...verdict("editor", 2 * MB, 2.1 * MB), detached: { total: 0, byName: {} }, nodes: [12, 12], listeners: [0, 0] }]);
    expect(out).toMatch(/✓ editor .* detached DOM 0, DOM nodes 12→12, listeners 0→0/);
  });

  it("runs in the nightly plan and has an npm script", () => {
    expect(readFileSync(join(ROOT, "scripts/nightly/plan.mjs"), "utf8")).toMatch(/"scripts\/perf\/leak\.mjs", "--notes", "500"/);
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["perf:leak"]).toBe("node scripts/perf/leak.mjs --notes 500 --browser");
  });
});
