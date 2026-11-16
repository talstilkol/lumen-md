// @vitest-environment node
/**
 * Plan W10.B7: scripts/eval/der.mjs scores a real hypothesis against a
 * human RTTM, and says "NOT measured" (exit 3) when pyannote can't run.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain JavaScript
import { score } from "../../scripts/eval/der.mjs";

const REF = "SPEAKER clip 1 0.000 10.000 <NA> <NA> A <NA> <NA>\nSPEAKER clip 1 10.000 10.000 <NA> <NA> B <NA> <NA>\n";

describe("scripts/eval/der.mjs (W10.B7)", () => {
  it("scores an RTTM hypothesis with the same DER as the golden tool", () => {
    expect(score(REF, REF.replace(/ A /, " S2 ").replace(/ B /, " S1 "), 0).der).toBe(0);
    expect(score(REF, "SPEAKER clip 1 0.000 20.000 <NA> <NA> S1 <NA> <NA>\n", 0).der).toBe(0.5);
  });

  it("without pyannote, DER is NOT measured (exit 3), never a number", () => {
    const dir = mkdtempSync(join(tmpdir(), "der-test-"));
    const ref = join(dir, "ref.rttm");
    const wav = join(dir, "a.wav");
    writeFileSync(ref, REF);
    writeFileSync(wav, "not audio");
    const r = spawnSync(process.execPath, ["scripts/eval/der.mjs", "--audio", wav, "--ref", ref], { encoding: "utf8", env: { ...process.env, PYTHON: "/nonexistent/python3" } });
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/DER NOT measured/);
    expect(r.stdout).not.toMatch(/DER \d/);
  });

  it("diarize.test.ts makes no DER claim about the stand-in networks", () => {
    const src = readFileSync("src/__tests__/diarize.test.ts", "utf8");
    expect(src).not.toMatch(/it\("[^"]*DER under/);
    expect(src).toMatch(/DER is not measured yet/);
  });
});
