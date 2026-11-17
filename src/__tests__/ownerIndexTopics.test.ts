/**
 * Review 12, L1: the owner index put each lane item under the first shared
 * action its decision names, so 6 items that ask for two (Buildkite and
 * Renovate, Sponsors and Percy, recruiting and the crypto review, …) were
 * missing from their second row. Now an item is listed under every topic
 * it names.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { TOPICS, group, loadOwnerPacks } from "../../scripts/mac-pack/owner-index.mjs";

const ROOT = resolve(__dirname, "../..");
type Item = { lane: string; id: string; decision?: string };
type Row = { key: string; items: Item[] };

describe("owner index: one item, several shared actions (review 12, L1)", () => {
  it("an item that names two topics is in both rows", () => {
    const rows: Row[] = group([{ lane: "L2", id: "x", decision: "Turn Buildkite on and install Renovate" }, { lane: "L3", id: "y", decision: "Open GitHub Sponsors" }]);
    const ids = (k: string) => rows.find((r) => r.key === k)?.items.map((i) => i.id);
    expect(ids("buildkite")).toEqual(["x"]);
    expect(ids("renovate")).toEqual(["x"]);
    expect(ids("sponsors")).toEqual(["y"]);
  });

  it("in the real packs, every item is under every topic its decision names", () => {
    const items: Item[] = loadOwnerPacks(ROOT);
    const rows: Row[] = group(items);
    const multi = items.filter((i) => TOPICS.filter((t: { re: RegExp }) => t.re.test(i.decision ?? "")).length > 1);
    expect(multi.length).toBeGreaterThan(0);
    for (const i of multi)
      for (const t of TOPICS.filter((tp: { re: RegExp }) => tp.re.test(i.decision ?? ""))) expect(rows.find((r) => r.key === t.key)?.items, `${i.id} under ${t.key}`).toContain(i);
  });
});
