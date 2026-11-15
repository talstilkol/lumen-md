/**
 * Plan W11.S16: the CRDT decision (docs/adr/004-crdt-yjs13-rooms.md) has
 * measurable criteria and a next review date, and the dependency it decides
 * on stays where it says until a new ADR replaces it.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const adr = readFileSync("docs/adr/004-crdt-yjs13-rooms.md", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("ADR-004: Yjs 13 for live rooms, no Loro or Automerge", () => {
  it("is accepted, dated, and names its next review date", () => {
    expect(adr).toMatch(/\*\*Status:\*\* Accepted/);
    const review = /\*\*Next review:\*\* (\d{4}-\d{2}-\d{2})/.exec(adr)?.[1];
    const date = /\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/.exec(adr)?.[1];
    expect(review && date && review > date).toBe(true);
  });

  it("each trigger to revisit says how it is measured", () => {
    const table = adr.slice(adr.indexOf("## Criteria to revisit"), adr.indexOf("## Consequences"));
    const rows = table.split("\n").filter((l) => l.startsWith("| **"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r.split("|").filter((c) => c.trim()).length, r).toBe(3);
    for (const s of ["Yjs 14 is GA", "Keyhive", "150 ms p95", "90%", "B4", "2× faster"]) expect(adr).toContain(s);
  });

  it("the decision holds in the code: yjs stays at major 13 until a new ADR", () => {
    const yjs = pkg.dependencies?.yjs ?? pkg.devDependencies?.yjs;
    expect(yjs, "yjs moved: write the ADR that replaces docs/adr/004-crdt-yjs13-rooms.md").toMatch(/^\^?13\./);
    for (const lib of ["loro-crdt", "@automerge/automerge"]) expect(pkg.dependencies?.[lib], `${lib}: see ADR-004`).toBeUndefined();
  });
});
