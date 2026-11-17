#!/usr/bin/env node
/**
 * Plan W11.I22 — `npm run skills:validate [dir …]`: skills-ref validate
 * (src/agents/skills/skillsRef.ts, a port of the reference validator) on
 * every skill folder under the given directories; default
 * packages/lumen-skills/skills. Lumen's starter skills are checked by
 * src/__tests__/skillsRef.test.ts. Exit 1 on any error; warnings print only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkill } from "../src/agents/skills/skillsRef.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["packages/lumen-skills/skills"];
let bad = 0;
let n = 0;
for (const d of dirs) {
  const base = resolve(ROOT, d);
  for (const e of existsSync(base) ? readdirSync(base, { withFileTypes: true }) : []) {
    if (!e.isDirectory()) continue;
    n++;
    const md = ["SKILL.md", "skill.md"].map((f) => join(base, e.name, f)).find(existsSync);
    const r = md ? validateSkill(readFileSync(md, "utf8"), e.name) : { errors: ["Missing required file: SKILL.md"], warnings: [] };
    const where = relative(ROOT, join(base, e.name));
    if (r.errors.length) bad++;
    console.log(`${r.errors.length ? "✗" : "✓"} ${where}${[...r.errors, ...r.warnings.map((w) => `warning: ${w}`)].map((x) => `\n    ${x}`).join("")}`);
  }
}
console.log(`skills:validate: ${n - bad}/${n} valid`);
process.exit(bad ? 1 : 0);
