// @vitest-environment node
/**
 * Plan W11.I22 — Agent Skills conformance: skills-ref validate (a port,
 * src/agents/skills/skillsRef.ts) on every skill in packages/lumen-skills
 * and on Lumen's starter skills; the cases of skills-ref's own
 * tests/test_validator.py; and progressive disclosure: only an activated
 * skill's body reaches a system prompt.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { skillsPrompt, validateSkill } from "../agents/skills/skillsRef";
import { STARTER_SKILL_FILES, starterSkills } from "../agents/skills/starters";
import { skillAgent } from "../agents/skills/run";

const PKG = resolve(__dirname, "..", "..", "packages/lumen-skills/skills");
const md = (fm: string, body = "# Body\n") => `---\n${fm}\n---\n${body}`;

describe("skills-ref validate on Lumen's skills", () => {
  const dirs = readdirSync(PKG, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  it.each(dirs)("packages/lumen-skills/skills/%s: 0 errors, name = folder", (dir: string) => {
    const r = validateSkill(readFileSync(join(PKG, dir, "SKILL.md"), "utf8"), dir);
    expect(r.errors).toEqual([]);
  });

  it.each(Object.keys(STARTER_SKILL_FILES))("starter %s: 0 errors, name = folder", (name: string) => {
    expect(validateSkill(STARTER_SKILL_FILES[name], name)).toEqual({ errors: [], warnings: [] });
  });

  it("covers all five package skills and six starters", () => {
    expect(dirs).toHaveLength(5);
    expect(Object.keys(STARTER_SKILL_FILES)).toHaveLength(6);
  });
});

describe("the reference validator's own cases (skills-ref tests/test_validator.py)", () => {
  const errs = (fm: string, dir = "my-skill") => validateSkill(md(fm), dir).errors;
  const d = "description: A test skill";

  it("accepts a valid skill, all fields, allowed-tools and i18n names", () => {
    expect(errs(`name: my-skill\n${d}`)).toEqual([]);
    expect(errs(`name: my-skill\n${d}\nlicense: MIT\nmetadata:\n  author: Test\n  version: "1.0"`)).toEqual([]);
    expect(errs(`name: my-skill\n${d}\nallowed-tools: Bash(jq:*) Bash(git:*)`)).toEqual([]);
    expect(errs(`name: 技能\n${d}`, "技能")).toEqual([]);
    expect(errs(`name: мой-навык\n${d}`, "мой-навык")).toEqual([]);
    expect(errs(`name: my-skill\n${d}\ncompatibility: Requires Python 3.11+`)).toEqual([]);
  });

  it("refuses what it refuses", () => {
    expect(errs(`name: MySkill\n${d}`, "MySkill").join()).toMatch(/lowercase/);
    expect(errs(`name: НАВЫК\n${d}`, "НАВЫК").join()).toMatch(/lowercase/);
    expect(errs(`name: ${"a".repeat(70)}\n${d}`, "a".repeat(70)).join()).toMatch(/exceeds 64 character limit/);
    expect(errs(`name: -my-skill\n${d}`, "-my-skill").join()).toMatch(/cannot start or end with a hyphen/);
    expect(errs(`name: my--skill\n${d}`, "my--skill").join()).toMatch(/consecutive hyphens/);
    expect(errs(`name: my_skill\n${d}`, "my_skill").join()).toMatch(/invalid characters/);
    expect(errs(`name: correct-name\n${d}`, "wrong-name").join()).toMatch(/must match skill name/);
    expect(errs(`name: my-skill\n${d}\nunknown_field: x`).join()).toMatch(/Unexpected fields in frontmatter: unknown_field/);
    expect(errs(`name: my-skill\ndescription: ${"x".repeat(1100)}`).join()).toMatch(/exceeds 1024/);
    expect(errs(`name: my-skill\n${d}\ncompatibility: ${"x".repeat(550)}`).join()).toMatch(/exceeds 500/);
    expect(errs(d).join()).toMatch(/Missing required field in frontmatter: name/);
    expect(validateSkill("# no frontmatter", "x").errors).toEqual(["SKILL.md must start with YAML frontmatter (---)"]);
  });

  it("normalizes names with NFKC, as the reference does", () => {
    const decomposed = "café";
    expect(errs(`name: ${decomposed}\n${d}`, "café")).toEqual([]);
  });

  it("warns when a body is past the spec's progressive-disclosure budget", () => {
    const r = validateSkill(md(`name: my-skill\n${d}`, "line\n".repeat(600)), "my-skill");
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/600|601/);
  });
});

describe("progressive disclosure", () => {
  const skills = starterSkills();

  it("the catalog block carries only names and descriptions (≈ 100 tokens a skill), never a body", () => {
    const block = skillsPrompt(skills);
    for (const s of skills) {
      expect(block).toContain(s.name);
      expect(block).not.toContain(s.body.split("\n").find((l) => l.trim().length > 20)!);
    }
    expect(block.length / 4 / skills.length).toBeLessThan(150);
  });

  it("an activated skill's system prompt has its own body and no other skill's", () => {
    const [a, ...rest] = skills;
    const system = skillAgent(a).system;
    expect(system).toContain(a.body);
    for (const b of rest) expect(system).not.toContain(b.body);
  });

  it("check-citations is tightened: only NFC and niqqud may differ, ✓ needs a location, ? only without a source", () => {
    const body = skills.find((s) => s.name === "check-citations")!.body;
    expect(body).not.toMatch(/מותר הבדל בניקוד ובפיסוק/);
    expect(body).toMatch(/NFC/);
    expect(body).toMatch(/אל תסמן ✓ בלי מיקום/);
    expect(body).toMatch(/מקור שקיים ואין בו הטקסט הוא ✗/);
  });
});
