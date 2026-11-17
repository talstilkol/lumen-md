/**
 * Review 13 M7: of the wave-13 dialogs in e2e/dialogs.registry.mjs, 9 were `fixme` (listed, not opened).
 * Those that need only an open note, a step through the Reading mode menu or the e2e hook are opened now:
 * the registry seeds the note (`seed`), clicks through (`steps`) or calls the hook (`hook`), and the spec
 * (e2e/a11y-dialogs.spec.ts) does each. Still fixme, with their reason: ExplainChangeDialog (needs an older
 * version in the history) and SetGraphDialog (opened from a Base or a query block).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs module without types
import { DIALOGS } from "../../e2e/dialogs.registry.mjs";

type Entry = { file: string; command?: string; seed?: string; steps?: string[]; hook?: string; fixme?: string };
const ROOT = join(__dirname, "../..");
const OPENED = ["src/reading/CompareView.tsx", "src/reading/bilingual/openBilingual.tsx", "src/reading/daf/openDaf.tsx", "src/ui/AbstractDialog.tsx", "src/ui/ImmersiveReader.tsx", "src/ui/RsvpReader.tsx", "src/ui/WritingChecksDialog.tsx"];

describe("the wave-13 dialogs are opened by the a11y spec (review 13 M7)", () => {
  const byFile = new Map((DIALOGS as Entry[]).map((d) => [d.file, d]));

  it("seven are no longer fixme, and each says how it is opened", () => {
    for (const f of OPENED) {
      const d = byFile.get(f);
      expect(d, f).toBeDefined();
      expect([f, d!.fixme]).toEqual([f, undefined]);
      expect(!!(d!.hook || d!.command), f).toBe(true);
    }
  });

  it("a seed fixture exists, and the steps are the Reading mode menu's own test ids", () => {
    for (const d of DIALOGS as Entry[]) if (d.seed?.startsWith("file:")) expect(readFileSync(join(ROOT, d.seed.slice(5)), "utf8").length, d.file).toBeGreaterThan(100);
    const menu = readFileSync(join(ROOT, "src/ui/ReadingModeMenu.tsx"), "utf8");
    for (const d of DIALOGS as Entry[]) for (const id of d.steps ?? []) expect(menu.includes(`data-testid="${id}"`) || (id.startsWith("rm-mode-") && menu.includes("data-testid={`rm-mode-${m.id}`}")), id).toBe(true);
  });

  it("the spec seeds the note, follows the steps and runs the hook", () => {
    const spec = readFileSync(join(ROOT, "e2e/a11y-dialogs.spec.ts"), "utf8");
    expect(spec).toMatch(/if \(d\.seed\) await seedNote\(page, d\.seed\)/);
    expect(spec).toMatch(/for \(const id of d\.steps \?\? \[\]\)/);
    expect(spec).toMatch(/if \(d\.hook\) await page\.evaluate\(d\.hook\)/);
  });
});
