/**
 * Plan W13.R2 — readability highlights (Hemingway) as a display layer:
 * long and very long sentences, passive voice, adverbs and complex words in
 * Hebrew and English; the style coach's suggestions (W13.W3, the W13.W1
 * contract) mapped onto the same kinds; colour plus underline style; and the
 * note never changes.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { analyzeReadability, countByKind, fromSuggestions, proseOnly, HW_STYLES, HEMINGWAY_KINDS, type HemingwayFinding } from "../reading/hemingway";
import { layerFindings, setFocusLayer } from "../editor/focusLayer";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const kinds = (text: string) => analyzeReadability(text).map((f) => `${f.kind}:${text.slice(f.from, f.to)}`);

describe("English rules", () => {
  it("passive, adverb, complex word with its simpler one", () => {
    const t = "The report was written by the team. She quickly utilized the tool in order to finish.";
    const k = kinds(t);
    expect(k).toContain("passive:was written");
    expect(k).toContain("adverb:quickly");
    expect(k).toContain("complex:utilized");
    expect(k).toContain("complex:in order to");
    const f = analyzeReadability(t).find((x) => t.slice(x.from, x.to) === "in order to");
    expect(f?.simpler).toBe("to");
  });

  it("words ending in -ly that are not adverbs are left alone", () => {
    expect(kinds("The family will apply early in July.")).toEqual([]);
  });

  it("long (> 20 words) and very long (> 30 words) sentences", () => {
    const long = Array.from({ length: 22 }, (_, i) => `word${i}`).join(" ") + ".";
    const veryLong = Array.from({ length: 32 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(analyzeReadability(long).map((f) => f.kind)).toEqual(["long"]);
    expect(analyzeReadability(veryLong).map((f) => f.kind)).toEqual(["veryLong"]);
    expect(analyzeReadability("Short and sweet.")).toEqual([]);
  });
});

describe("Hebrew rules", () => {
  it("passive with על ידי, passive verbs, adverbial phrases, bureaucratic words", () => {
    const t = "המכתב נכתב על ידי המנהל. בוצעה בדיקה. הוא עבד באופן יסודי במסגרת הפרויקט על מנת לסיים.";
    const k = kinds(t);
    expect(k).toContain("passive:נכתב על ידי");
    expect(k).toContain("passive:בוצעה");
    expect(k).toContain("adverb:באופן יסודי");
    expect(k).toContain("complex:במסגרת");
    expect(k).toContain("complex:על מנת ל");
  });

  it("long Hebrew sentences use the lower limits (16 / 25 words)", () => {
    const s = (n: number) => Array.from({ length: n }, () => "מילה").join(" ") + ".";
    expect(analyzeReadability(s(15))).toEqual([]);
    expect(analyzeReadability(s(18)).map((f) => f.kind)).toEqual(["long"]);
    expect(analyzeReadability(s(27)).map((f) => f.kind)).toEqual(["veryLong"]);
  });

  it("niqqud does not hide a word", () => {
    expect(kinds("הַדָּבָר נַעֲשָׂה בְּאֹפֶן מְהִיר.")).toEqual([]);
    expect(kinds("הדבר הוחלט על ידי הוועדה.")).toContain("passive:הוחלט על ידי");
  });
});

describe("not prose", () => {
  it("code, inline code, frontmatter and link targets are skipped, offsets kept", () => {
    const t = "---\ntitle: was written\n---\n```\nx was created quickly\n```\nUse `utilize` and [x](http://a.b/quickly).";
    expect(proseOnly(t).length).toBe(t.length);
    expect(analyzeReadability(t)).toEqual([]);
  });
});

describe("the style coach's suggestions (W13.W3, W13.W1 contract)", () => {
  it("map onto the same kinds; other kinds are left out", () => {
    const text = "x".repeat(50);
    const got = fromSuggestions(
      [
        { range: { from: 0, to: 5 }, kind: "passive" },
        { range: { from: 6, to: 9 }, kind: "nominalization", replacement: "decide" },
        { range: { from: 10, to: 12 }, kind: "hedge" },
        { range: { from: 13, to: 14 }, kind: "spelling" },
      ],
      text,
    );
    expect(got).toEqual([
      { from: 0, to: 5, kind: "passive", simpler: undefined },
      { from: 6, to: 9, kind: "complex", simpler: "decide" },
      { from: 10, to: 12, kind: "adverb", simpler: undefined },
    ]);
  });
});

describe("the layer in the editor", () => {
  it("draws each kind with a class and an underline style, and counts them", () => {
    const doc = "The report was written by the team. She quickly utilized it.";
    const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    setFocusLayer(view, { unit: null, hemingway: true });
    const marks = [...view.contentDOM.querySelectorAll("[data-hw]")].map((e) => `${e.getAttribute("data-hw")}:${e.textContent}`);
    expect(marks).toEqual(expect.arrayContaining(["passive:was written", "adverb:quickly", "complex:utilized"]));
    const counts = countByKind(layerFindings(view.state));
    expect(counts).toMatchObject({ passive: 1, adverb: 1, complex: 1 });
    view.destroy();
  });

  it("the style coach's findings replace the local rules when given", () => {
    const doc = "Plain text here.";
    const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    const coach = (): HemingwayFinding[] => [{ from: 0, to: 5, kind: "complex", simpler: "Simple" }];
    setFocusLayer(view, { unit: null, hemingway: true, findings: coach });
    expect([...view.contentDOM.querySelectorAll("[data-hw]")].map((e) => e.textContent)).toEqual(["Plain"]);
    view.destroy();
  });

  it("never changes the note: the hash is the same and no transaction changed the document", () => {
    const doc = "המכתב נכתב על ידי המנהל. She quickly utilized the tool.\n\nAnother paragraph that is here.";
    const before = sha(doc);
    let changed = 0;
    const view = new EditorView({ state: EditorState.create({ doc, extensions: EditorView.updateListener.of((u) => (changed += u.docChanged ? 1 : 0)) }), parent: document.body });
    setFocusLayer(view, { unit: "sentence", hemingway: true });
    view.dispatch({ selection: { anchor: 30 } });
    setFocusLayer(view, { unit: "paragraph", hemingway: true });
    setFocusLayer(view, { unit: null, hemingway: false });
    expect(changed).toBe(0);
    expect(sha(view.state.doc.toString())).toBe(before);
    view.destroy();
  });

  it("every kind has a distinct underline style (not colour alone)", () => {
    const styles = HEMINGWAY_KINDS.map((k) => HW_STYLES[k].style);
    expect(new Set(styles).size).toBe(HEMINGWAY_KINDS.length);
  });

  it("fast: a 2,000-paragraph note is analysed in well under 150 ms per paragraph", () => {
    const para = "The report was written by the team, and she quickly utilized the tool in order to finish the work that was required. המכתב נכתב על ידי המנהל באופן יסודי.";
    const text = Array.from({ length: 2000 }, () => para).join("\n\n");
    const t0 = performance.now();
    const found = analyzeReadability(text);
    const ms = performance.now() - t0;
    expect(found.length).toBeGreaterThan(2000 * 4);
    expect(ms / 2000).toBeLessThan(150);
    expect(ms).toBeLessThan(5000);
  });
});
