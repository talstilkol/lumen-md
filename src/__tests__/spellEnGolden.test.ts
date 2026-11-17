// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("englishSpell — acceptance on the spell-en dev split (plan 6.10)", () => {
  it("recall ≥ 90% on the injected errors, false positives ≤ 3% of the clean words", async () => {
    // @ts-expect-error — plain .mjs module without types
    const { score, devItems, TARGETS } = await import("../../scripts/golden/evals/spell-en.mjs");
    const s = await score({ items: devItems() });
    expect(s.detection_recall).toBeGreaterThanOrEqual(TARGETS.detection_recall);
    expect(s.fp_word_rate).toBeLessThanOrEqual(TARGETS.fp_word_rate);
  }, 60_000);
});

describe("englishSpell — the everyday-misspellings set (plan 6.10, a second error model)", () => {
  type Item = { id: string; noisy: string; clean: string; edits: Array<{ start: number; end: number; wrong: string; right: string }> };
  const items: Item[] = JSON.parse(readFileSync(join(process.cwd(), "src/__tests__/fixtures/spell-en-common.json"), "utf8")).items;

  it("the set is well formed: ≥ 60 sentences, every edit at its offset, noisy = clean with the edits", () => {
    expect(items.length).toBeGreaterThanOrEqual(60);
    for (const it of items) {
      let rebuilt = it.noisy;
      for (const e of [...it.edits].sort((a, b) => b.start - a.start)) {
        expect(it.noisy.slice(e.start, e.end), it.id).toBe(e.wrong);
        rebuilt = rebuilt.slice(0, e.start) + e.right + rebuilt.slice(e.end);
      }
      expect(rebuilt, it.id).toBe(it.clean);
    }
  });

  it("recall ≥ 90% and false positives ≤ 3% through the shipped path (paragraph routing, then nspell)", async () => {
    // @ts-expect-error — plain .mjs module without types
    const { score, commonItems, TARGETS } = await import("../../scripts/golden/evals/spell-en.mjs");
    const s = await score({ items: commonItems() });
    expect(s.detection_recall).toBeGreaterThanOrEqual(TARGETS.detection_recall);
    expect(s.fp_word_rate).toBeLessThanOrEqual(TARGETS.fp_word_rate);
  }, 60_000);

  it("every sentence is routed to the English checker: none is blanked as another language", async () => {
    // "Please let me know when you receive the signed contract." was French
    // (confident) to the trigram model, so its misspelling was never checked.
    const { englishOnly } = await import("../ai/englishSpellService");
    const blanked: string[] = [];
    for (const it of items) for (const t of [it.clean, it.noisy]) if ((await englishOnly(t)) !== t) blanked.push(it.id);
    expect(blanked).toEqual([]);
  }, 60_000);
});
