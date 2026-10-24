// @vitest-environment node
/**
 * #225 P1: scripts/golden/owner.mjs runs in a public Actions log, so a
 * malformed owner bundle must fail without printing any of its content:
 * no JSON.parse fragment, no owner ID, no filename.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("owner.mjs keeps the owner's material out of the log", () => {
  it("malformed parts fail with the rule or the error type only", () => {
    const base = mkdtempSync(join(tmpdir(), "golden-owner-"));
    try {
      const bundle = join(base, "bundle");
      const part = (set: string, id: string) => {
        const d = join(bundle, set, id);
        mkdirSync(d, { recursive: true });
        return d;
      };
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, "CONSENT.md"), "CC0");
      // A JSON error: Node's message quotes the text around the bad token.
      writeFileSync(join(part("retrieval", "owner"), "queries.json"), '[{"id":"q1","query":"HELDOUT-PROMPT-XYZ" oops}]');
      // A rule error that used to interpolate the owner's ID.
      writeFileSync(join(part("asr-he", "owner"), "transcripts.tsv"), "SECRET-SPEAKER-ID\tשלום\n");
      writeFileSync(join(part("injection", "hebrew"), "hebrew.json"), JSON.stringify([{ id: "SECRET-CASE", vector: "nope" }]));
      const r = spawnSync(process.execPath, ["scripts/golden/owner.mjs", "--in", bundle, "--out", join(base, "out")], { encoding: "utf8" });
      const log = `${r.stdout}\n${r.stderr}`;
      expect(r.status).toBe(1);
      for (const secret of ["HELDOUT-PROMPT-XYZ", "oops", "SECRET-SPEAKER-ID", "SECRET-CASE"]) expect(log).not.toContain(secret);
      expect(log).toContain("retrieval/owner: a JSON file of the part is not valid JSON");
      expect(log).toContain("asr-he/owner: every transcript line needs an audio file and a transcript");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
