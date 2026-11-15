/**
 * W12.R4 — handwriting in search, only behind the W11.H14 gate.
 *
 * The transcript below is a label given in the test as the recogniser's
 * output for the fixture's ink block (there is no recogniser yet, W7.11);
 * it is not a measurement of anything.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyInkText, gateClosedReason, INK_GATE, inkTextEnabled, inkTexts, type InkRecognitionGate } from "../ink/inkText";
import { findInkBlocks, parseInk, toMarkdown } from "../ink/inkModel";
import { VaultIndex } from "../storage/vaultIndexCore";

const ROOT = resolve(__dirname, "../..");
const note = readFileSync(join(ROOT, "src/__tests__/fixtures/ink/he-block.md"), "utf8");
const passed: InkRecognitionGate = { plan: "W11.H14", status: "passed", evalCard: "evals/cards/w11-h14.json", cer: 0.09, maxCer: 0.15 };
/** The labelled transcript for the fixture's block (synthetic: given here, not recognised). */
const TRANSCRIPT = new Map([["he01blok", "חיפוש בינארי לוגריתמי"]]);

const search = (content: string, q: string) => {
  const idx = new VaultIndex();
  idx.upsert({ path: "lesson.md", name: "lesson.md", content, modified: 1 });
  idx.upsert({ path: "other.md", name: "other.md", content: "# אחר\n\nשום דבר כאן.", modified: 1 });
  return idx.search(q).map((h) => h.path);
};

describe("the gate", () => {
  it("is shut today: W11.H14 has no eval card and no CER, so the flag is off", () => {
    expect(INK_GATE.plan).toBe("W11.H14");
    expect(inkTextEnabled()).toBe(false);
    expect(gateClosedReason()).toMatch(/has not passed/);
  });

  it("opens only with status passed, an eval card and a CER at or under the gate", () => {
    expect(inkTextEnabled(passed)).toBe(true);
    expect(gateClosedReason({ ...passed, evalCard: null })).toMatch(/without an eval card/);
    expect(gateClosedReason({ ...passed, cer: null })).toMatch(/no measured CER/);
    expect(gateClosedReason({ ...passed, cer: 0.2 })).toMatch(/above the gate/);
    expect(inkTextEnabled({ ...passed, cer: 0.15 })).toBe(true);
    expect(inkTextEnabled({ ...passed, status: "failed" })).toBe(false);
  });
});

describe("hidden text in the ink block", () => {
  it("with the gate shut, nothing changes and search does not find the handwritten word", () => {
    const r = applyInkText(note, TRANSCRIPT);
    expect(r).toEqual({ markdown: note, changed: 0, blocked: expect.stringMatching(/W11\.H14/) });
    expect(search(r.markdown, "לוגריתמי")).toEqual([]);
  });

  it("with the gate open, search finds a word written by hand, and only that note", () => {
    const r = applyInkText(note, TRANSCRIPT, passed);
    expect(r.changed).toBe(1);
    expect(inkTexts(r.markdown)).toEqual(TRANSCRIPT);
    expect(search(r.markdown, "לוגריתמי")).toEqual(["lesson.md"]);
    // The text sits in one attribute of the opening tag; everything else is byte for byte the same.
    expect(r.markdown.replace(' data-ink-text="חיפוש בינארי לוגריתמי"', "")).toBe(note);
    expect(r.markdown.match(/data-ink-text=/g)).toHaveLength(1);
    // Applying the same text again is a no-op; empty text removes it.
    expect(applyInkText(r.markdown, TRANSCRIPT, passed).changed).toBe(0);
    const cleared = applyInkText(r.markdown, new Map([["he01blok", ""]]), passed);
    expect(cleared.markdown).not.toContain("data-ink-text");
  });

  it("the attribute round-trips through toMarkdown/parseInk, escaped", () => {
    // A stroke stored as its outline only, so no outline is recomputed.
    const ink = { ...parseInk(note.slice(findInkBlocks(note)[0].start, findInkBlocks(note)[0].end))!, strokes: [{ points: [], simulated: true, size: 0, color: "#000000", d: "M0,0Z" }] };
    const md = toMarkdown({ ...ink, text: 'א "ב" <ג> & ד' });
    expect(md).toContain('data-ink-text="א &quot;ב&quot; &lt;ג&gt; &amp; ד"');
    expect(parseInk(md)?.text).toBe('א "ב" <ג> & ד');
    expect(toMarkdown(ink)).not.toContain("data-ink-text");
  });
});
