// @vitest-environment node
/**
 * W10.F29 (audit r3): visual/ + playwright.visual.config.ts replace the old
 * visual-ci matrix (test/visual-ci 403aa654b7..38101ac039), so they must
 * cover what it covered: its ten surfaces (split, source, preview, wysiwyg,
 * palette, shortcuts, plugins, templates, ai-settings, ai-doctor) in its four
 * variants (en / he × dark / light), each compared with a baseline and
 * checked for horizontal overflow. Read from the spec sources (Playwright is
 * not loaded here).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const OLD_SURFACES = ["split", "source", "preview", "wysiwyg", "palette", "shortcuts", "plugins", "templates", "ai-settings", "ai-doctor"];
const OLD_VARIANTS = ["en-dark", "en-light", "he-dark", "he-light"];
const ids = (src: string, list: string) => {
  const at = src.indexOf(list);
  expect(at, list).toBeGreaterThan(-1);
  const block = src.slice(at, src.indexOf("\n];", at));
  return [...block.matchAll(/^\s*(?:\{\s*)?id: "([\w-]+)"/gm)].map((m) => m[1]);
};

describe("visual/ covers the old visual-ci matrix (W10.F29)", () => {
  it("the same ten surfaces × four variants, each a baseline shot with the overflow check", () => {
    const harness = read("visual/harness.ts");
    const surfaces = [...ids(harness, "export const SURFACES"), ...ids(read("visual/ported.visual.ts"), "export const PORTED_SURFACES")];
    expect(surfaces).toEqual(expect.arrayContaining(OLD_SURFACES));
    expect(ids(harness, "export const VARIANTS").sort()).toEqual([...OLD_VARIANTS].sort());
    for (const spec of ["visual/surfaces.visual.ts", "visual/ported.visual.ts"]) {
      const s = read(spec);
      expect(s, spec).toMatch(/for \(const v of VARIANTS\)/);
      expect(s, spec).toMatch(/toHaveScreenshot\(`\$\{s\.id\}--\$\{v\.id\}\.png`/);
      expect(s, spec).toMatch(/scrollWidth - window\.innerWidth\)\)\.toBeLessThanOrEqual\(1\)/);
    }
  });

  it("the config runs every *.visual.ts in visual/ and a missing baseline fails", () => {
    const cfg = read("playwright.visual.config.ts");
    expect(cfg).toMatch(/testDir: "\.\/visual"/);
    expect(cfg).toMatch(/testMatch: \/\.\*\\\.visual\\\.ts\$\//);
    expect(cfg).toMatch(/updateSnapshots: snapshotUpdateMode\(process\.env\)/);
  });

  it("the decision is recorded", () => {
    expect(read("plan/decisions-2026-11-14.md")).toMatch(/W10\.F29.*visual\/ and playwright\.visual\.config\.ts replace/);
  });
});
