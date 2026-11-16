/**
 * Plan W7.1 acceptance 2 — the judge of the Claude Code trials
 * (agents/skills/baseTrials.ts): a .base an outside agent wrote counts only
 * if Lumen's engine parses it and runs every view with no error, and the
 * run passes only with ≥ 10 tries that all opened. The pack's own examples
 * pass; broken files, a missing file and too few tries do not.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_TRIAL_PROMPTS, checkBaseTrials, checkBaseTry } from "../agents/skills/baseTrials";

const EXAMPLES = join(__dirname, "../../packages/lumen-skills/skills/lumen-bases/examples");
const examples = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".base"))
  .map((f) => ({ name: f, text: readFileSync(join(EXAMPLES, f), "utf8") }));

describe("W7.1 .base trials judge", () => {
  it("ten prompts, one per try", () => {
    expect(BASE_TRIAL_PROMPTS).toHaveLength(10);
    expect(new Set(BASE_TRIAL_PROMPTS).size).toBe(10);
  });

  it("the pack's own examples open", () => {
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const e of examples) expect(checkBaseTry(e)).toMatchObject({ ok: true });
  });

  it("ten good tries pass; the report is JSON with the counts", () => {
    const tries = Array.from({ length: 10 }, (_, i) => ({ ...examples[i % examples.length], name: `try-${i + 1}.base` }));
    const r = checkBaseTrials(tries);
    expect(r).toMatchObject({ task: "W7.1", tries: 10, opened: 10, pass: true });
    expect(JSON.parse(JSON.stringify(r)).results).toHaveLength(10);
  });

  it("a broken file, a YAML list, a missing file, an unknown function: each fails its try", () => {
    expect(checkBaseTry({ name: "yaml", text: "views:\n  - type: table\n   name: [" })).toMatchObject({ ok: false });
    expect(checkBaseTry({ name: "list", text: "- just\n- a list\n" })).toMatchObject({ ok: false });
    expect(checkBaseTry({ name: "none", text: null })).toMatchObject({ ok: false, error: "no .base file was written" });
    const bad = checkBaseTry({ name: "fn", text: "views:\n  - type: table\n    name: T\n    filters: 'nosuchfunction(status)'\n" });
    expect(bad.ok).toBe(false);
  });

  it("one bad try in ten, or fewer than ten tries, is not a pass", () => {
    const good = Array.from({ length: 9 }, (_, i) => ({ ...examples[0], name: `try-${i + 1}.base` }));
    expect(checkBaseTrials([...good, { name: "try-10.base", text: null }])).toMatchObject({ tries: 10, opened: 9, pass: false });
    expect(checkBaseTrials(good)).toMatchObject({ tries: 9, opened: 9, pass: false });
  });
});
