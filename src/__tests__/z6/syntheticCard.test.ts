import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs
import { makeCard, validateCard } from "../../../scripts/lib/evalCard.mjs";

/**
 * Review Z6-M5, the reviewer's repro. Since the fix, makeCard itself refuses the card (it runs validateCard), so the
 * refusal is read from either place.
 */
describe("Z6 synthetic card paths", () => {
  it("a heldout card on retrieval-hard named without the synthetic/ prefix or origin is refused", () => {
    let problems: string;
    try {
      const card = makeCard({ tag: "heldout", model: { name: "m", digest: "sha256:x" }, seed: 1, temperature: 0, dataset: { name: "retrieval-hard/heldout", version: "2", license: "CC-BY-4.0" }, scores: { ndcg: [1, 0, 1] } });
      problems = validateCard(card).join("\n");
    } catch (e) {
      problems = String(e);
    }
    expect(problems).toMatch(/synthetic/);
  });
});
