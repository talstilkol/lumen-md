/**
 * W12.A1 — "Ask the vault" cites a paragraph, not a line: every paragraph
 * has an anchor (its Obsidian `^id`, or a virtual `p-<hash>` until the
 * user pins a link), a citation resolves to the paragraph that holds its
 * quote word for word, the click selects that whole paragraph, and a claim
 * without a verified quote is marked unsupported.
 *
 * The model answers below are FAKE and labelled as such: they stand in for
 * the model so the checking code runs on its real path (the real model runs
 * on the Mac, W12.M1).
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { noteParagraphs, paragraphLink, resolveParagraphAnchor, virtualAnchor } from "../ai/paragraphAnchors";
import { pinParagraphAnchor } from "../ai/paragraphPin";
import { claimSupport, markUnsupportedClaims, verifyVaultCitations } from "../ai/vaultCitations";
import { headingChunks } from "../ai/headingChunks";
import { revealSelection } from "../editor/revealLine";

/** A small test vault: one Hebrew note, one English note. */
const VAULT = [
  {
    path: "פרויקטים/השקה.md",
    content: [
      "---",
      "tags: [launch]",
      "---",
      "# השקה",
      "",
      "ההשקה נדחתה ליום שלישי",
      "בגלל הבדיקות של צוות האיכות.",
      "",
      "התקציב לא השתנה. ^budget1",
      "",
      "- פריט ראשון ברשימה",
      "- פריט שני ברשימה",
      "",
    ].join("\n"),
  },
  {
    path: "meetings/2026-10.md",
    content: [
      "# Weekly",
      "",
      "The launch moved to Tuesday after the review.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "^table9",
      "",
      "```js",
      "const x = 1;",
      "",
      "const y = 2;",
      "```",
      "",
      "Marketing wants a demo video before the launch.",
      "",
    ].join("\n"),
  },
];

describe("paragraphs and their anchors", () => {
  it("front matter is no paragraph; a heading, each list item and a code block are paragraphs of their own", () => {
    const ps = noteParagraphs(VAULT[0].content);
    expect(ps.map((p) => p.text)).toEqual(["# השקה", "ההשקה נדחתה ליום שלישי\nבגלל הבדיקות של צוות האיכות.", "התקציב לא השתנה.", "- פריט ראשון ברשימה", "- פריט שני ברשימה"]);
    expect(ps.map((p) => [p.startLine, p.endLine])).toEqual([[4, 4], [6, 7], [9, 9], [11, 11], [12, 12]]);
    const code = noteParagraphs(VAULT[1].content).find((p) => p.text.startsWith("```"));
    expect(code?.text).toBe("```js\nconst x = 1;\n\nconst y = 2;\n```");
  });

  it("a ^id at the end of the paragraph, or on its own line after a block, is the anchor; otherwise a virtual one", () => {
    const ps = noteParagraphs(VAULT[0].content);
    expect(ps[2]).toMatchObject({ blockId: "budget1", anchor: "^budget1" });
    expect(ps[1].blockId).toBeNull();
    expect(ps[1].anchor).toMatch(/^p-[0-9a-f]{8}$/);
    const table = noteParagraphs(VAULT[1].content).find((p) => p.text.startsWith("| a"));
    expect(table).toMatchObject({ blockId: "table9", startLine: 5, endLine: 8 });
    expect(table?.text).not.toContain("^table9");
  });

  it("a virtual anchor survives edits elsewhere in the note and goes away when its own paragraph changes", () => {
    const p = noteParagraphs(VAULT[0].content)[1];
    const edited = VAULT[0].content.replace("# השקה", "# השקה\n\nפסקה חדשה בראש הפתק.");
    const again = resolveParagraphAnchor(edited, p.anchor);
    expect(again?.text).toBe(p.text);
    expect(again?.startLine).toBe(p.startLine + 2);
    expect(resolveParagraphAnchor(VAULT[0].content.replace("יום שלישי", "יום רביעי"), p.anchor)).toBeNull();
    // Formatting does not move the anchor.
    expect(virtualAnchor("The **launch** moved")).toBe(virtualAnchor("The launch moved"));
  });

  it("two identical paragraphs get different anchors", () => {
    const ps = noteParagraphs("same words\n\nsame words\n");
    expect(new Set(ps.map((p) => p.anchor)).size).toBe(2);
  });

  it("Pin link writes a real Obsidian ^id only on request, and the link then resolves to the same paragraph", () => {
    const p = noteParagraphs(VAULT[0].content)[1];
    const pinned = pinParagraphAnchor(VAULT[0].content, p.anchor, () => "abc123");
    expect(pinned?.id).toBe("abc123");
    expect(pinned?.content).toContain("בגלל הבדיקות של צוות האיכות. ^abc123");
    const after = resolveParagraphAnchor(pinned!.content, "^abc123");
    expect(after?.text).toBe(p.text);
    expect(paragraphLink("פרויקטים/השקה.md", after!)).toBe("[[פרויקטים/השקה#^abc123]]");
    // A paragraph that already has one is left as it is.
    expect(pinParagraphAnchor(VAULT[0].content, "^budget1")).toEqual({ content: VAULT[0].content, id: "budget1" });
  });

  it("heading chunks carry the anchors of the paragraphs that start in them (W11.I14 + W12.A1)", () => {
    const chunks = headingChunks(VAULT[0].content, { min: 1 });
    const all = chunks.flatMap((c) => c.paragraphs);
    expect(all).toEqual(noteParagraphs(VAULT[0].content).map((p) => p.anchor));
  });
});

describe("citations resolve to a paragraph", () => {
  // FAKE model answer (labelled): a Hebrew answer that cites the English note, and an English claim citing the Hebrew note.
  const FAKE_ANSWER =
    'ההשקה זזה ליום שלישי [2] "The launch moved to Tuesday after the review". The budget did not change [1] "התקציב לא השתנה". Marketing also wants a press tour [2] "Marketing wants a press tour".';

  it("on the test vault, the answer has verified citations and each one names its paragraph", () => {
    const { citations, verifiedCount } = verifyVaultCitations(FAKE_ANSWER, VAULT);
    expect(verifiedCount).toBeGreaterThanOrEqual(1);
    expect(citations[0]).toMatchObject({ path: "meetings/2026-10.md", verified: true, line: 3, paragraph: { startLine: 3, endLine: 3, index: 1 } });
    expect(citations[1]).toMatchObject({ path: "פרויקטים/השקה.md", verified: true, paragraph: { anchor: "^budget1", blockId: "budget1", startLine: 9 } });
    expect(citations[2]).toMatchObject({ verified: false, paragraph: null });
  });

  it("the click selects exactly the cited paragraph in the editor's document", () => {
    const src = VAULT[0].content;
    const { citations } = verifyVaultCitations('[1] "ההשקה נדחתה ליום שלישי בגלל הבדיקות"', VAULT);
    const p = citations[0].paragraph!;
    expect(p).toMatchObject({ startLine: 6, endLine: 7 });
    const doc = EditorState.create({ doc: src }).doc;
    const sel = revealSelection(doc, p.startLine, p.endLine);
    expect(doc.sliceString(sel.anchor, sel.head)).toBe("ההשקה נדחתה ליום שלישי\nבגלל הבדיקות של צוות האיכות.");
    expect(revealSelection(doc, p.startLine, p.endLine, false)).toEqual({ anchor: sel.head });
    // Clamped to the document.
    expect(revealSelection(doc, 2, 999).head).toBe(doc.length);
  });

  it("a quote that is in the note but not inside one paragraph is not verified (words picked from two places)", () => {
    // FAKE model answer (labelled): the quote joins the end of one paragraph to the start of the next.
    const { citations } = verifyVaultCitations('[1] "צוות האיכות. התקציב לא השתנה"', VAULT);
    expect(citations[0]).toMatchObject({ verified: false, paragraph: null });
  });

  it("each claim without a verified citation is marked unsupported in the answer; one that says the notes don't cover it is not a claim", () => {
    const { citations } = verifyVaultCitations(FAKE_ANSWER, VAULT);
    const claims = claimSupport(FAKE_ANSWER, citations);
    expect(claims.map((c) => c.supported)).toEqual([true, true, false]);
    const marked = markUnsupportedClaims(FAKE_ANSWER, claims, "unsupported");
    expect(marked.match(/⚠️ \*unsupported\*/g)).toHaveLength(1);
    expect(marked.endsWith('[2] "Marketing wants a press tour". ⚠️ *unsupported*')).toBe(true);
    // A claim with no citation at all is unsupported too.
    expect(claimSupport("The launch is on Friday.", []).map((c) => c.supported)).toEqual([false]);
    expect(claimSupport("This is not in the notes.", [])).toEqual([]);
  });
});
