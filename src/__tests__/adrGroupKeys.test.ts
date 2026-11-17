/**
 * Plan W13.S3 — the group-key ADR is published with numbers from the
 * prototype, and makes one decision (adopt / wait / no) with conditions to
 * reopen it. The tables in the ADR are recomputed here from
 * scripts/experiments/group-keys/proto.mjs: a change to either fails until
 * both agree, and an ADR without its tables or decision fails too.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — a plain .mjs experiment, no types
import { SIZES, concurrent, sharedRemove, treekemRemove } from "../../scripts/experiments/group-keys/proto.mjs";

const ROOT = resolve(__dirname, "..", "..");
const ADR = join(ROOT, "docs/adr/005-group-keys.md");

function section(md: string, heading: string): string {
  const at = md.indexOf(`## ${heading}`);
  expect(at, `section "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = md.slice(at + heading.length + 3);
  const next = rest.indexOf("\n## ");
  return next < 0 ? rest : rest.slice(0, next);
}

/** Rows of the Markdown tables in `text`: arrays of cell strings, header and separator rows dropped. */
function tables(text: string): string[][][] {
  const out: string[][][] = [];
  let cur: string[][] | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("|")) {
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (!cur) {
        cur = [];
        out.push(cur);
        continue; // header
      }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      cur.push(cells);
    } else cur = null;
  }
  return out;
}

describe("ADR-005 group keys", () => {
  const md = existsSync(ADR) ? readFileSync(ADR, "utf8") : "";

  it("exists and makes exactly one decision: adopt, wait or no", () => {
    expect(md.length).toBeGreaterThan(2000);
    const decisions = [...md.matchAll(/^\*\*Decision:\*\* (\w+)\s*$/gm)].map((m) => m[1]);
    expect(decisions).toHaveLength(1);
    expect(["adopt", "wait", "no"]).toContain(decisions[0]);
    expect(md).toMatch(/^\*\*Status:\*\* Accepted/m);
  });

  it("names when to reopen it: at least three concrete triggers", () => {
    const triggers = section(md, "Reopen when").split("\n").filter((l) => /^\d+\. /.test(l));
    expect(triggers.length).toBeGreaterThanOrEqual(3);
  });

  it("compares the three options on the four axes", () => {
    const [axes] = tables(section(md, "Comparison on the four axes"));
    expect(axes.map((r) => r[0].toLowerCase())).toEqual([
      expect.stringContaining("remove a member"),
      expect.stringContaining("concurrent"),
      expect.stringContaining("update size"),
      expect.stringContaining("maturity"),
    ]);
    for (const r of axes) expect(r).toHaveLength(4);
  });

  it("the removal table is the prototype's output, for every size it measures", () => {
    const [remove, conc] = tables(section(md, "The numbers (scripts/experiments/group-keys/proto.mjs)"));
    expect(remove.map((r) => Number(r[0]))).toEqual(SIZES);
    for (const r of remove) {
      const n = Number(r[0]);
      expect(Number(r[1]), `shared n=${n}`).toBe(sharedRemove(n).bytes);
      expect(Number(r[2]), `tree n=${n}`).toBe(treekemRemove(n).bytes);
    }
    expect(conc.length).toBeGreaterThanOrEqual(3);
    for (const r of conc) {
      const n = Number(r[0]);
      const c = concurrent(n, 4);
      expect(r.slice(1).map(Number), `concurrent n=${n}`).toEqual([c.treekem.updatesBytes, c.beekem.updatesBytes, c.treekem.removeAfter, c.beekem.removeAfter]);
    }
  });

  it("the prototype's model behaves as the ADR says: shared O(n), trees O(log n), BeeKEM merges what TreeKEM redoes", () => {
    expect(sharedRemove(1024).bytes / sharedRemove(32).bytes).toBeGreaterThan(30);
    expect(treekemRemove(1024).bytes / treekemRemove(32).bytes).toBeLessThan(3);
    const c = concurrent(256, 4);
    expect(c.treekem.redone).toBe(3);
    expect(c.beekem.redone).toBe(0);
    expect(c.beekem.updatesBytes).toBeLessThan(c.treekem.updatesBytes);
    // The prototype is an experiment: nothing in the app imports it.
    expect(readFileSync(join(ROOT, "src/sync/e2ee/keyring.ts"), "utf8")).not.toContain("experiments/group-keys");
  });
});
