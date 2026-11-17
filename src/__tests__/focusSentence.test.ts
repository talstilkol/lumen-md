/**
 * Plan W13.R2 — focus mode keeps the line, the sentence or the paragraph at
 * the cursor bright (Intl.Segmenter, Hebrew and English) and dims the rest.
 */
import { describe, it, expect } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { focusSpan, lineAt, paragraphAt, sentencesIn, langOf } from "../reading/focusUnits";
import { dimRanges, focusSpanIn, setFocusLayer } from "../editor/focusLayer";

const at = (text: string, needle: string) => text.indexOf(needle) + 1;
const spanText = (text: string, s: { from: number; to: number }) => text.slice(s.from, s.to);

describe("units", () => {
  const en = "First sentence here. Dr. Smith wrote e.g. this one! Is it a third?\nStill the same paragraph.\n\nA new paragraph.";
  it("sentence (English): abbreviations do not end a sentence", () => {
    expect(spanText(en, focusSpan(en, at(en, "Smith"), "sentence"))).toBe("Dr. Smith wrote e.g. this one!");
    expect(spanText(en, focusSpan(en, at(en, "third"), "sentence"))).toBe("Is it a third?");
    expect(spanText(en, focusSpan(en, at(en, "Still"), "sentence"))).toBe("Still the same paragraph.");
  });

  it("paragraph and line", () => {
    expect(spanText(en, focusSpan(en, at(en, "Smith"), "paragraph"))).toBe("First sentence here. Dr. Smith wrote e.g. this one! Is it a third?\nStill the same paragraph.");
    expect(spanText(en, focusSpan(en, at(en, "Still"), "line"))).toBe("Still the same paragraph.");
    expect(spanText(en, focusSpan(en, at(en, "new"), "paragraph"))).toBe("A new paragraph.");
  });

  it("sentence (Hebrew): ? ! . and the sof pasuq end sentences; gershayim do not", () => {
    const he = "צה״ל הודיע הבוקר. מה קרה אתמול? בְּרֵאשִׁית בָּרָא אֱלֹהִים׃ וְהָאָרֶץ הָיְתָה תֹהוּ!";
    expect(langOf(he)).toBe("he");
    expect(spanText(he, focusSpan(he, at(he, "הודיע"), "sentence"))).toBe("צה״ל הודיע הבוקר.");
    expect(spanText(he, focusSpan(he, at(he, "אתמול"), "sentence"))).toBe("מה קרה אתמול?");
    expect(spanText(he, focusSpan(he, at(he, "בָּרָא"), "sentence"))).toBe("בְּרֵאשִׁית בָּרָא אֱלֹהִים׃");
    expect(spanText(he, focusSpan(he, at(he, "תֹהוּ"), "sentence"))).toBe("וְהָאָרֶץ הָיְתָה תֹהוּ!");
  });

  it("Markdown blocks stand alone: heading, list items, quote, code fence", () => {
    const md = "# Title here\nBody line one. Body two.\n- item one. more\n- item two\n> quoted\n\n```js\nconst a = 1;\nconst b = 2;\n```\nAfter.";
    expect(spanText(md, paragraphAt(md, at(md, "Title")))).toBe("# Title here");
    expect(spanText(md, paragraphAt(md, at(md, "Body two")))).toBe("Body line one. Body two.");
    expect(spanText(md, paragraphAt(md, at(md, "item two")))).toBe("- item two");
    expect(spanText(md, paragraphAt(md, at(md, "const b")))).toBe("```js\nconst a = 1;\nconst b = 2;\n```");
    // A lower-case word after a full stop continues the sentence (an abbreviation, not a new one).
    expect(spanText(md, focusSpan(md, at(md, "more"), "sentence"))).toBe("- item one. more");
  });

  it("edges: empty text, cursor at the end, a blank line", () => {
    expect(focusSpan("", 0, "sentence")).toEqual({ from: 0, to: 0 });
    const t = "One. Two.";
    expect(spanText(t, focusSpan(t, t.length, "sentence"))).toBe("Two.");
    expect(lineAt("a\n\nb", 2)).toEqual({ from: 2, to: 2 });
    expect(sentencesIn("   ", { from: 0, to: 3 })).toEqual([]);
  });
});

describe("dimming in the editor", () => {
  it("everything outside the focus span is dimmed", () => {
    const t = "One here. Two there. Three.";
    expect(dimRanges(t, at(t, "Two"), "sentence")).toEqual([
      { from: 0, to: t.indexOf("Two") },
      { from: t.indexOf("Two") + "Two there.".length, to: t.length },
    ]);
  });

  it("the layer draws .cm-focus-dim around the sentence and follows the cursor", () => {
    const doc = "שלום לכם. מה שלומכם היום? להתראות.";
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: at(doc, "שלומכם") } }), parent: document.body });
    setFocusLayer(view, { unit: "sentence", hemingway: false });
    const bright = () => [...view.contentDOM.querySelectorAll(".cm-line")].map((l) => [...l.childNodes].filter((n) => !(n instanceof HTMLElement && n.classList.contains("cm-focus-dim"))).map((n) => n.textContent).join("")).join("");
    expect(bright()).toBe("מה שלומכם היום?");
    view.dispatch({ selection: { anchor: at(doc, "להתראות") } });
    expect(bright().trim()).toBe("להתראות.");
    setFocusLayer(view, { unit: null, hemingway: false });
    expect(view.contentDOM.querySelectorAll(".cm-focus-dim").length).toBe(0);
    view.destroy();
  });
});

describe("review 13 M4: the focus span on a long note", () => {
  it("is read from a window around the caret — the same span, without turning the document into one string", () => {
    const para = "The report was long. It was written by the team. הדו״ח היה ארוך. הוא נכתב על ידי הצוות.\n\n";
    const full = para.repeat(8000);
    const doc = Text.of(full.split("\n"));
    let whole = 0;
    const spy = { length: doc.length, sliceString: (a: number, b?: number) => doc.sliceString(a, b), toString: () => (whole++, doc.toString()) };
    for (const pos of [0, 37, Math.floor(full.length / 2), full.length - 5]) {
      for (const unit of ["line", "sentence", "paragraph"] as const) expect(focusSpanIn(spy, pos, unit)).toEqual(focusSpan(full, pos, unit));
    }
    expect(whole).toBe(0);
  });
});

