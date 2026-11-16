// @vitest-environment node
/**
 * W11.S12 (audit r3): the 1,000,000-input fuzz run is published on the
 * security page, in English and Hebrew, from security/fuzz-results.json;
 * the register is checked, and a run that found something must name its
 * finding.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- plain .mjs script, no types
import { fuzzResultsProblems, renderSecurityPage } from "../../scripts/lib/securityPage.mjs";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const fuzz = JSON.parse(read("security/fuzz-results.json"));
const findings = JSON.parse(read("security/findings.json"));

describe("published fuzz results (W11.S12)", () => {
  it("the register holds the 1M CPU-clock Markdown run, clean, on a commit of the train", () => {
    expect(fuzzResultsProblems(fuzz)).toEqual([]);
    expect(fuzz.runs).toContainEqual(expect.objectContaining({ target: "markdown", inputs: 1_000_000, seed: 1, clock: "cpu", crashes: 0, hangs: 0, slow: 0, commit: "b6b7741e4e" }));
  });

  it("both pages show it (the generated pages in the repo, and a fresh render)", () => {
    for (const [lang, page, row] of [
      ["en", "docs/src/content/docs/security/index.md", "| 2026-11-16 | `b6b7741e4e` | markdown | 1,000,000 | 1 | CPU | 0 | 0 | 0 (> 200 ms) | 69 ms |"],
      ["he", "docs/src/content/docs/he/security/index.md", "| 2026-11-16 | `b6b7741e4e` | markdown | 1,000,000 | 1 | CPU | 0 | 0 | 0 (> 200 ms) | 69 ms |"],
    ] as const) {
      expect(read(page), page).toContain(row);
      expect(read(page), page).not.toMatch(/Results per release are not published|התוצאות לכל גרסה עוד לא מתפרסמות/);
      expect(renderSecurityPage(findings, [], lang, null, null, fuzz)).toContain(row);
    }
    // Without a register the page says so, as before.
    expect(renderSecurityPage(findings, [], "en")).toContain("Results per release are not published on this page yet.");
  });

  it("a run that found something names its finding; a malformed run is refused", () => {
    const run = fuzz.runs[0];
    expect(fuzzResultsProblems({ runs: [{ ...run, crashes: 2 }] })).toEqual(["security/fuzz-results.json runs[0]: a run with crashes, hangs or slow inputs names its finding (LUM-…)"]);
    expect(fuzzResultsProblems({ runs: [{ ...run, crashes: 2, finding: "LUM-2026-009" }] })).toEqual([]);
    expect(fuzzResultsProblems({ runs: [{ ...run, commit: "HEAD", inputs: "1M" }] })).toHaveLength(2);
    expect(fuzzResultsProblems({ runs: [] })).toHaveLength(1);
  });
});
