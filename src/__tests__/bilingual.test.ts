/**
 * W13.R12: pairing a text with its translation. A Sefaria source note's two
 * official versions pair by verse (100% on the synthetic bilingual chapter
 * in e2e/fixtures/interlinear); a sidecar pairs by paragraph and, where the
 * sentence counts agree, by sentence. The view in Chromium:
 * e2e/interlinear.spec.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromSidecar, fromSourceNote, pairSentences, readMode, saveMode, sentencesOf } from "../reading/bilingual/bilingual";
import { serializeSidecar } from "../ai/mt/sideBySide";
import { hash } from "../srs/cards";

const CHAPTER = readFileSync(join(__dirname, "..", "..", "e2e", "fixtures", "interlinear", "bilingual-chapter.md"), "utf8");

describe("official versions, by verse", () => {
  it("every verse pairs with its own translation (12/12)", () => {
    const b = fromSourceNote(CHAPTER)!;
    expect(b.kind).toBe("official");
    expect(b.rows).toHaveLength(12);
    expect(b.unmatched).toBe(0);
    for (const r of b.rows) {
      expect(r.source).toContain(`פָּסוּק ${r.n}.`);
      expect(r.target).toContain(`Verse ${r.n}.`);
    }
    expect(b.source).toMatchObject({ lang: "he", dir: "rtl" });
    expect(b.target).toMatchObject({ lang: "en", dir: "ltr", license: "Public Domain" });
    expect(b.rows[9].label).toBe("י׳");
  });
  it("a link-only version is not offered; one version alone is no pair", () => {
    const linkOnly = CHAPTER.replace(/(language: "en"[\s\S]*?copied: )true/, "$1false");
    expect(fromSourceNote(linkOnly)).toBeNull();
  });
  it("versions of different lengths: the extra verses are counted, not shifted", () => {
    const short = CHAPTER.replace(/\nThe .*Verse 12\.\n/, "\n");
    const b = fromSourceNote(short)!;
    expect(b.unmatched).toBe(1);
    expect(b.rows[11].target).toBeNull();
    expect(b.rows[10].target).toContain("Verse 11.");
  });
  it("not a source note: null", () => {
    expect(fromSourceNote("# just a note\n\ntext")).toBeNull();
  });
});

describe("a sidecar translation, by paragraph and sentence", () => {
  const source = "---\nx: 1\n---\nשלום עולם. מה שלומך?\n\nפסקה שנייה בלבד.\n\nפסקה שלישית.\n";
  const paras = ["שלום עולם. מה שלומך?", "פסקה שנייה בלבד.", "פסקה שלישית."];
  const sidecar = serializeSidecar({ of: "a.md", lang: "en", layer: "opus", entries: [
    { hash: hash(paras[0]), text: "Hello world. How are you?" },
    { hash: hash(paras[1]), text: "Only the second paragraph. With an extra sentence." },
  ] });
  it("paragraph rows; sentences paired where the counts agree; a missing one is marked", () => {
    const b = fromSidecar(source, sidecar, "he", "a");
    expect(b.kind).toBe("machine");
    expect(b.target).toMatchObject({ lang: "en", title: "opus" });
    expect(b.rows.map((r) => r.target)).toEqual(["Hello world. How are you?", "Only the second paragraph. With an extra sentence.", null]);
    expect(b.rows[0].sentences).toEqual([["שלום עולם.", "Hello world."], ["מה שלומך?", "How are you?"]]);
    expect(b.rows[1].sentences).toBeNull();
    expect(b.unmatched).toBe(1);
  });
  it("sentences: Hebrew and English", () => {
    expect(sentencesOf("אחת. שתיים! שלוש?", "he")).toHaveLength(3);
    expect(pairSentences("A. B.", "א. ב.", "en", "he")).toEqual([["A.", "א."], ["B.", "ב."]]);
    expect(pairSentences("One only.", "אחת.", "en", "he")).toBeNull();
  });
});

describe("the remembered layout", () => {
  it("columns by default; a valid choice comes back", () => {
    localStorage.clear();
    expect(readMode()).toBe("columns");
    saveMode("interlinear");
    expect(readMode()).toBe("interlinear");
    localStorage.setItem("lumen-bilingual-mode", "nope");
    expect(readMode()).toBe("columns");
  });
});
