// @vitest-environment node
/**
 * W10.E71–E74 (W9.8): row-by-row proof for the code rows of the delegated
 * decisions (plan/decisions-2026-11-14.md, #618) in the groups of #469,
 * #316, #483 and #602. Every row of those groups marked needs-code "y" has
 * an entry here: the test that pins the decision in the code, which must
 * name the row; or, for an owner act, the part a cloud run can check.
 * A new needs-code row in these groups fails this test until it has its proof.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const GROUPS = ["#469", "#316", "#483", "#602"];

/** step → how it is proven. */
const PROOF: Record<string, { tests: string[]; owner?: string; names?: false }> = {
  // PRIVACY.he.md's DPIA says what #469's collab Worker does: 90 days, no IP logs, encrypted rooms only.
  "2.46": { tests: ["src/__tests__/singleVaultRelay.test.ts", "src/__tests__/privacyDoc.test.ts"] },
  // The Web Clipper page (en + he) no longer says the extension doesn't save, and names both ways in.
  "2.92": { tests: ["src/__tests__/webClipperDocs.test.ts"] },
  // The relay routes: the coordinator's port of #469 keeps edge-workers/vault-relay as the one public
  // relay (logs off, ciphertext only) instead of a second copy inside the collab Worker.
  "5.16": { tests: ["src/__tests__/singleVaultRelay.test.ts"], owner: "deploy the Workers and set VITE_SYNC_RELAY_URL in Vercel" },
  // The table itself needs the models and a machine to run them: an owner act.
  "2.78": { tests: ["src/__tests__/embedCompete.test.ts"], names: false, owner: "npm run eval:embed-compete, then eval:embed-ingest, on a machine with the models" },
};

interface Row {
  step: string;
  pr: string;
  needsCode: string;
}
function rows(): Row[] {
  return read("plan/decisions-2026-11-14.md")
    .split("\n")
    .filter((l) => /^\| \d+\.\d+ \|/.test(l))
    .map((l) => l.split(" | "))
    .map((c) => ({ step: c[0].replace(/^\| /, ""), pr: c[1], needsCode: c[5] }));
}

describe("#618 decisions, groups #469 #316 #483 #602: every code row has its proof (W10.E71–E74)", () => {
  it("the rows of the four groups that need code are exactly the ones proven here", () => {
    const mine = rows().filter((r) => GROUPS.includes(r.pr) && r.needsCode === "y").map((r) => r.step);
    expect(mine.sort()).toEqual(Object.keys(PROOF).sort());
  });

  for (const [step, proof] of Object.entries(PROOF)) {
    it(`${step}: its test exists and names the decision`, () => {
      for (const t of proof.tests) {
        expect(existsSync(t), t).toBe(true);
        if (proof.names !== false) expect(read(t), t).toMatch(new RegExp(`decision ${step.replace(".", "\\.")}\\b`, "i"));
      }
    });
  }

  it("2.78, the part a cloud run checks: 100 cross-lingual questions (W5.28 added the other 50), and the competition's rules", () => {
    const set = JSON.parse(read("eval/synthetic/retrieval-hard/crosslingual.json")) as { items: Array<{ id: string }> };
    expect(new Set(set.items.map((q) => q.id)).size).toBe(100);
    const probe = JSON.parse(read("eval/probes/crosslingual-he-en.json")) as { items: Array<{ id: string; relevant: string[] }>; corpus: Array<{ id: string }> };
    expect(probe.items).toHaveLength(100);
    // Every question points at a passage of the corpus.
    const corpus = new Set(probe.corpus.map((p) => p.id));
    expect(probe.items.every((q) => q.relevant.length > 0 && q.relevant.every((id) => corpus.has(id)))).toBe(true);
    // The ceilings are the page's, unchanged: 5 points on the held-out part, 150 ms on 10,000 notes, 3 for the reranker.
    const page = read("docs/src/content/docs/ai/embedding-competition.md");
    expect(page).toContain("at least **5 points**");
    expect(page).toContain("at most **150 ms** on 10,000 notes");
    expect(page).toContain("at least **3 points**");
  });
});
