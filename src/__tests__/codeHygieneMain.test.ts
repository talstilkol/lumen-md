// @vitest-environment node
/**
 * Audit r3 (W10.C30 follow-up): `npm run hygiene` must run the taken-domain
 * check, not only export it. The script runs in a small temp tree (its own
 * copy, TypeScript linked from the repo and an empty stand-in for postcss,
 * which only parses stylesheets and the tree has none): clean, it exits 0; with the
 * taken domain in a README, it exits 1 and names it. A main() that stopped
 * calling takenDomainViolations would pass the first run and the second.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
// Built, so this file never names it itself.
const TAKEN = ["lumen", "md"].join(".");

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-main-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  cpSync(join(ROOT, "scripts/check-code-hygiene.mjs"), join(dir, "scripts/check-code-hygiene.mjs"));
  for (const f of ["skipAudit.mjs", "takenDomain.mjs"]) cpSync(join(ROOT, "scripts/lib", f), join(dir, "scripts/lib", f));
  mkdirSync(join(dir, "node_modules/postcss"), { recursive: true });
  symlinkSync(join(ROOT, "node_modules/typescript"), join(dir, "node_modules/typescript"), "dir");
  writeFileSync(join(dir, "node_modules/postcss/package.json"), JSON.stringify({ name: "postcss", type: "module", main: "index.js" }));
  writeFileSync(join(dir, "node_modules/postcss/index.js"), "export default { parse() { throw new Error('no stylesheet in this tree'); } };\n");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "e2e"), { recursive: true });
  writeFileSync(join(dir, "src/ok.ts"), "export const ok = 1;\n");
  // The allow-listed vault-layer files, as they are (an entry with no file would be "stale").
  const script = readFileSync(join(ROOT, "scripts/check-code-hygiene.mjs"), "utf8");
  const allow = /DIRECT_FS_ALLOWLIST = \{([\s\S]*?)\n\};/.exec(script)![1];
  for (const [, f] of allow.matchAll(/^\s*"(src\/[^"]+)":/gm)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  writeFileSync(join(dir, "README.md"), "# App\n\nOpen https://lumen-md.vercel.app.\n");
  return dir;
}
const run = (dir: string) => spawnSync(process.execPath, [join(dir, "scripts/check-code-hygiene.mjs")], { cwd: dir, encoding: "utf8" });

describe("check-code-hygiene main() runs the taken-domain check", () => {
  it("a clean tree passes; the taken domain in a README fails with [taken-domain]", () => {
    const dir = tree();
    try {
      const clean = run(dir);
      expect(clean.stderr).toMatch(/✓ code hygiene/);
      expect(clean.status).toBe(0);
      writeFileSync(join(dir, "README.md"), `# App\n\nNot ${TAKEN}: that one is taken.\n`);
      const bad = run(dir);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/README\.md:3 {2}\[taken-domain\]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
