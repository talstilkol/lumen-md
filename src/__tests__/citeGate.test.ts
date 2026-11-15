/**
 * R12.9: the cite-or-delete gate. Every sentence is tied to an exact quote
 * the verifier picked, or it is deleted; no quote is shown that is not the
 * source's own slice. The adversarial cases are written as a model that
 * lies would write them: invented quotes, flipped polarity, changed numbers,
 * unread sources, unmarked claims.
 */
import { describe, expect, it } from "vitest";
import { alignForm, alignQuote, alignmentHolds } from "../agents/cite/align";
import { citeOrDelete, deletedLine, numbersOf, splitSentences, supportOf, type GateSource } from "../agents/cite/gate";

const ROSES = "Prune roses in early spring, when buds swell. Clean shears prevent the spread of disease. Never prune in a frost.";
const src = (text: string, n = 1, note = false): GateSource => ({ n, id: note ? `[[n${n}]]` : `https://s${n}.example/`, text, note });

/** No quote is shown that is not its source's slice at its offsets. */
function noFabricatedQuote(r: ReturnType<typeof citeOrDelete>, sources: GateSource[]) {
  for (const e of r.evidence) {
    const s = sources.find((x) => x.n === e.n)!;
    expect(alignmentHolds(e, s.text)).toBe(true);
    expect(s.text.slice(e.start, e.end)).toBe(e.text);
  }
}

describe("align: exact offsets after one fixed normalisation", () => {
  it("finds a quote through niqqud, final letters, quote marks, emphasis and line breaks, and returns the source's own slice", () => {
    const s = "פתיחה.\nהַפְּגִישָׁה **נדחתה** ליום\nשלישי, כך נאמר ב„פרוטוקול“.";
    const a = alignQuote('הפגישה נדחתה ליום שלישי, כך נאמר ב"פרוטוקול"', s)!;
    expect(a).not.toBeNull();
    expect(s.slice(a.start, a.end)).toBe(a.text);
    expect(a.text.startsWith("הַפְּגִישָׁה")).toBe(true);
    // Quote marks around the whole quote are the model's, not part of the match.
    expect(a.text.endsWith("פרוטוקול")).toBe(true);
  });

  it("forgives nothing else: a dropped word, a changed number, a missing 'not' or a part-word is not found", () => {
    expect(alignQuote("Alice approved the budget", "Alice never approved the budget.")).toBeNull();
    expect(alignQuote("the grant was 3 million", "the grant was 2.5 million")).toBeNull();
    expect(alignQuote("roses in early spring", "Prune roses in early spring")).not.toBeNull();
    expect(alignQuote("ate the cake slowly", "she late the cake slowly")).toBeNull();
    // Too short to stand as evidence.
    expect(alignQuote("roses", ROSES)).toBeNull();
  });

  it("alignForm keeps a map back to the original for every character", () => {
    const f = alignForm("  שָׁלוֹם   **עולם** ");
    expect(f.text).toBe("שלומ עולמ");
    expect(f.map).toHaveLength(f.text.length + 1);
  });
});

describe("support: words, numbers, polarity", () => {
  it("numbers are canonical and must all be in the quote", () => {
    expect(numbersOf("1,200 people and 2.50 shekels, 40%")).toEqual(["1200", "2.5", "40"]);
    expect(supportOf("The grant was 3 million shekels.", "The grant was 2.5 million shekels.").reject).toBe("number-mismatch");
  });
  it("a 'not' on one side only is a contradiction, in English and Hebrew", () => {
    expect(supportOf("Alice approved the budget.", "Alice never approved the budget.").reject).toBe("polarity-mismatch");
    expect(supportOf("הוועדה אישרה את התקציב.", "הוועדה לא אישרה את התקציב.").reject).toBe("polarity-mismatch");
    expect(supportOf("הוועדה לא אישרה את התקציב.", "הוועדה לא אישרה את התקציב.").reject).toBeNull();
  });
  it("Hebrew prefix letters are tolerated: לשלישי is backed by ליום שלישי", () => {
    expect(supportOf("הפגישה נדחתה לשלישי.", "הַפְּגִישָׁה נדחתה ליום שלישי.").score).toBe(1);
  });
});

describe("splitSentences", () => {
  it("keeps markers with their sentence, and does not split 2.5 or e.g.", () => {
    expect(splitSentences("It costs 2.5 shekels.[^1] Shears, e.g. bypass ones, matter.[^2] Tail")).toEqual(["It costs 2.5 shekels.[^1]", "Shears, e.g. bypass ones, matter.[^2]", "Tail"]);
  });
});

describe("citeOrDelete", () => {
  it("keeps a supported sentence with the verifier's quote, even when the model's quote was invented", () => {
    const sources = [src(ROSES)];
    const r = citeOrDelete("Roses are pruned in early spring.[^1]", sources, { modelQuotes: new Map([[1, ["Roses love being pruned in winter"]]]) });
    expect(r.deletedCount).toBe(0);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toMatchObject({ n: 1, text: "Prune roses in early spring", pickedFrom: "source" });
    expect(r.body).toBe("Roses are pruned in early spring.{{cite:0}}");
    noFabricatedQuote(r, sources);
  });

  it("adversarial: every lie is deleted, with its reason, and the count is returned", () => {
    const sources = [src(ROSES), src("The grant was 2.5 million shekels in 2024. Alice never approved the budget.", 2)];
    const answer = [
      "# Roses",
      "",
      "Prune roses in early spring.[^1] Roses are blue and sing at night.[^1] You should prune in a frost.[^1]",
      "Clean shears prevent disease, this claim has no marker.",
      "Bananas are pruned in July.[^7]",
      "",
      "## Money",
      "",
      "The grant was 3 million shekels in 2024.[^2]",
      "- Alice approved the budget.[^2]",
      "",
      "```js",
      "prune(roses)",
      "```",
    ].join("\n");
    const r = citeOrDelete(answer, sources);
    expect(r.kept.map((u) => u.claim)).toEqual(["Prune roses in early spring."]);
    expect(r.deleted.map((u) => u.reason)).toEqual(["no-support", "polarity-mismatch", "no-citation", "source-not-read", "number-mismatch", "polarity-mismatch", "no-citation"]);
    expect(r.deletedCount).toBe(7);
    // The heading with nothing left under it goes too; the one with content stays.
    expect(r.body).toBe("# Roses\n\nPrune roses in early spring.{{cite:0}}");
    noFabricatedQuote(r, sources);
  });

  it("Hebrew: niqqud in the note, prefixes in the answer; the paragraph anchor of a note comes with the evidence", () => {
    const note = "# פגישה\n\nהַפְּגִישָׁה נדחתה ליום שלישי בשעה 10. ^meet\n\nהתקציב לא אושר.";
    const sources = [src(note, 1, true)];
    const r = citeOrDelete("הפגישה נדחתה לשלישי בשעה 10.[^1] התקציב אושר.[^1]", sources);
    expect(r.kept).toHaveLength(1);
    expect(r.evidence[0].anchor).toBe("^meet");
    expect(r.evidence[0].text).toBe("הַפְּגִישָׁה נדחתה ליום שלישי בשעה 10");
    expect(r.deleted[0].reason).toBe("polarity-mismatch");
    noFabricatedQuote(r, sources);
  });

  it("adversarial: a model quote cut just after 'Do not' is read with its clause; Hebrew negations with final letters count", () => {
    const sources = [src("Do not add the yolks to hot butter. Water tomatoes at the base, not on the leaves. אין לקרר את הבצק. העגבניות אינן אוהבות עלים רטובים.")];
    const r = citeOrDelete(
      "Add the yolks to hot butter.[^1] Water the tomatoes at the base.[^1] Water the tomatoes on the leaves.[^1] מותר לקרר את הבצק.[^1] העגבניות אוהבות עלים רטובים.[^1]",
      sources,
      { modelQuotes: new Map([[1, ["add the yolks to hot butter", "", "on the leaves", "לקרר את הבצק", "העגבניות אינן אוהבות עלים רטובים"]]]) },
    );
    expect(r.kept.map((u) => u.claim)).toEqual(["Water the tomatoes at the base."]);
    expect(r.deleted.map((u) => u.reason)).toEqual(["polarity-mismatch", "polarity-mismatch", "polarity-mismatch", "polarity-mismatch"]);
    noFabricatedQuote(r, sources);
  });

  it("ask-the-vault citations `[n] \"quote\"` (#879) are gated the same way", () => {
    const sources = [src("The launch moved to Tuesday after the review.", 1, true)];
    const r = citeOrDelete('The launch moved to Tuesday. [1] "The launch moved to Tuesday" The launch was cancelled. [1] "The launch was cancelled"', sources);
    expect(r.kept.map((u) => u.claim)).toEqual(["The launch moved to Tuesday."]);
    expect(r.evidence[0].pickedFrom).toBe("model");
    expect(r.deletedCount).toBe(1);
  });

  it("a table row is one unit; the header stays only with a kept row", () => {
    const sources = [src("The grant was 2.5 million shekels in 2024.")];
    const r = citeOrDelete("| year | grant |\n|---|---|\n| 2024 | 2.5 million shekels grant [^1] |\n| 2025 | 9 million shekels grant [^1] |", sources);
    expect(r.kept).toHaveLength(1);
    expect(r.body.split("\n")).toHaveLength(3);
    expect(r.deleted[0].reason).toBe("number-mismatch");
  });

  it("the count line is always there, in English and Hebrew", () => {
    expect(deletedLine(0, 3, "en")).toContain("0 sentences removed");
    expect(deletedLine(2, 1, "en")).toBe("2 sentences were removed: no exact quote in the sources backs them.");
    expect(deletedLine(1, 0, "he")).toContain("משפט אחד נמחק");
    expect(deletedLine(0, 1, "he")).toContain("0 משפטים נמחקו");
  });
});
