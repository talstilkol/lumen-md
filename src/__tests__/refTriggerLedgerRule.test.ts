/**
 * W10.C24: src/editor/refTrigger.ts passes pr:check's privacy-ledger rule
 * (scripts/lib/prGate.mjs, unregisteredNetworkCalls) as it stands. A doc
 * comment that read "fetch (with consent …)" matched the rule's call pattern
 * and failed pr:check on every PR stacked on this one; the comment now says
 * the same thing without that shape. The rule itself is unchanged.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- plain .mjs script, no types
import { unregisteredNetworkCalls } from "../../scripts/lib/prGate.mjs";

const LEDGER = readFileSync(join(__dirname, "../ai/privacyLedger.ts"), "utf8");
const FILE = "src/editor/refTrigger.ts";

describe("refTrigger.ts and the privacy-ledger rule", () => {
  it("no line of the file is flagged when every line counts as added", () => {
    const lines = readFileSync(join(__dirname, "../editor/refTrigger.ts"), "utf8").split("\n");
    const added = { [FILE]: lines.map((text, i) => ({ line: i + 1, text, before: lines.slice(Math.max(0, i - 2), i) })) };
    expect(unregisteredNetworkCalls(added, LEDGER)).toEqual([]);
  });

  it("the rule passes the old wording as prose (W10.D17 on the train) and still flags the same shape in code", () => {
    // Since W10.D17 the rule skips comments, so the old doc comment no longer fails pr:check either;
    // the call shape outside a comment still does, so the rule itself is not weaker.
    const old = "  /** Insert was chosen: fetch (with consent given by the click) and replace the typed reference. */";
    expect(unregisteredNetworkCalls({ [FILE]: [{ line: 93, text: old, before: [] }] }, LEDGER)).toEqual([]);
    const code = "  await fetch(target, { signal }); // replace the typed reference";
    expect(unregisteredNetworkCalls({ [FILE]: [{ line: 93, text: code, before: [] }] }, LEDGER)).toHaveLength(1);
  });
});
