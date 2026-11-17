/**
 * W10.C9: ROUGE-L in eval:summarize. The scores match the published
 * definitions (Lin 2004 §3.1–3.2) and the values Google's rouge-score package
 * prints for the same inputs; Hebrew text is tokenised instead of dropped;
 * the eval's report carries ROUGE-L per document and as a mean.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lcsLength, rougeL, rougeLsum, rougeSentences, rougeTokens } from "../../scripts/eval/lib/rouge";
import { loadSplit, scoreSummary, summaryMarkdown, summaryTotals, type SummaryRow } from "../../scripts/eval/lib/summaryReport";

describe("ROUGE-L", () => {
  it("matches rouge-score's README example (rougeL P 0.625, R 0.556, F 0.588)", () => {
    const s = rougeL("The quick brown dog jumps on the log.", "The quick brown fox jumps over the lazy dog");
    expect(s.precision).toBeCloseTo(5 / 8, 6);
    expect(s.recall).toBeCloseTo(5 / 9, 6);
    expect(s.f1).toBeCloseTo((2 * (5 / 8) * (5 / 9)) / (5 / 8 + 5 / 9), 6);
  });

  it("is a subsequence, not a substring, measure (Lin's S1/S2/S3 example)", () => {
    // Lin 2004 §3.1: S1 = police killed the gunman; S2 = police kill the gunman; S3 = the gunman kill police.
    const s1 = "police killed the gunman";
    expect(rougeL("police kill the gunman", s1).f1).toBeCloseTo(0.75, 6);
    expect(rougeL("the gunman kill police", s1).f1).toBeCloseTo(0.5, 6);
  });

  it("scores identical text 1 and disjoint or empty text 0", () => {
    expect(rougeL("a b c", "a b c").f1).toBe(1);
    expect(rougeL("x y", "a b").f1).toBe(0);
    expect(rougeL("", "a b").f1).toBe(0);
    expect(lcsLength([], ["a"])).toBe(0);
  });

  it("summary level uses the union LCS (Lin 2004 §3.2: r = w1..w5, c1 = w1 w2 w6 w7 w8, c2 = w1 w3 w8 w9 w5 → recall 4/5)", () => {
    const ref = "w1 w2 w3 w4 w5";
    const cand = "w1 w2 w6 w7 w8\nw1 w3 w8 w9 w5";
    const s = rougeLsum(cand, ref);
    expect(s.recall).toBeCloseTo(4 / 5, 6);
    expect(s.precision).toBeCloseTo(4 / 10, 6);
    // Order across sentences: whole-text LCS of "w3 w5 / w1 w2" against "w1 w2 w3 w5" is 2, the union is 4.
    expect(rougeL("w3 w5\nw1 w2", "w1 w2 w3 w5").recall).toBeCloseTo(2 / 4, 6);
    expect(rougeLsum("w3 w5\nw1 w2", "w1 w2 w3 w5").recall).toBe(1);
  });

  it("clips union hits so a token is never counted more than it occurs", () => {
    // The reference has "a" once; both candidate sentences match it.
    const s = rougeLsum("a b.\na c.", "a d.");
    expect(s.recall).toBeCloseTo(1 / 2, 6);
    expect(s.precision).toBeCloseTo(1 / 4, 6);
  });

  it("tokenises Hebrew (rouge-score's default tokenizer drops it): niqqud off, geresh kept, prefixes optional", () => {
    expect(rougeTokens("הַמֶּמְשָׁלָה אישרה את ארה״ב")).toEqual(["הממשלה", "אישרה", "את", "ארה״ב"]);
    expect(rougeL("הממשלה אישרה את התקציב", "הממשלה אישרה את התקציב").f1).toBe(1);
    expect(rougeL("והממשלה אישרה", "הממשלה אישרה").f1).toBeCloseTo(0.5, 6);
    expect(rougeL("והממשלה אישרה", "הממשלה אישרה", { hebrewPrefixes: true }).f1).toBe(1);
    expect(rougeL("בממשלה", "הממשלה", { hebrewPrefixes: true }).f1).toBe(0);
    expect(rougeLsum("והממשלה אישרה.", "הממשלה אישרה.", { hebrewPrefixes: true }).f1).toBe(1);
    // At least three letters stay: "בית" never matches "ית".
    expect(rougeL("בית", "ית", { hebrewPrefixes: true }).f1).toBe(0);
  });

  it("splits sentences on newlines first, else after . ! ? and sof pasuq", () => {
    expect(rougeSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
    expect(rougeSentences("a. b\nc")).toEqual(["a. b", "c"]);
    expect(rougeSentences("אחת׃ שתיים")).toEqual(["אחת׃", "שתיים"]);
  });
});

describe("eval:summarize report with ROUGE-L", () => {
  const row = (id: string, engine: string, rouge: number | null): SummaryRow => ({ id, engine, produced: 3, grounded: 3, keywords: "1/4", ms: 1000, rougeL: rouge, rougeLsum: rouge });

  it("scores a summary against the item's reference, with the Hebrew prefix rule for Hebrew references", () => {
    const en = scoreSummary({ id: "a", document: "", reference: "The quick brown fox jumps over the lazy dog", keywords: ["fox", "cat"] }, "The quick brown dog jumps on the log.");
    expect(en.keywords).toBe("0/2");
    expect(en.rougeL).toBeCloseTo(0.588235, 5);
    const he = scoreSummary({ id: "b", document: "", reference: "הממשלה אישרה את התקציב" }, "והממשלה אישרה את התקציב");
    expect(he.rougeL).toBe(1);
    expect(scoreSummary({ id: "c", document: "" }, "x").rougeL).toBeNull();
  });

  it("averages ROUGE-L over model summaries only and prints it per row and in the headline", () => {
    const rows = [row("a", "ollama", 0.5), row("b", "ollama", 0.3), row("c", "extractive", 0.9), row("d", "ollama", null)];
    const t = summaryTotals(rows);
    expect(t.rougeL).toBeCloseTo(0.4, 6);
    expect(t.rougeScored).toBe(2);
    const md = summaryMarkdown("qwen2.5:7b", "2026-11-17", rows);
    expect(md).toContain("ROUGE-L F1 against the reference (mean of 2 model summaries): **0.400**");
    expect(md).toContain("| id | engine | grounded | key words | ROUGE-L | ROUGE-Lsum | s |");
    expect(md).toContain("| a | ollama | 3/3 | 1/4 | 0.500 | 0.500 | 1.0 |");
    expect(md).toContain("| d | ollama | 3/3 | 1/4 | — | — | 1.0 |");
  });

  it("loads the committed sotu split, and a HebSummaries-style folder of *.json", () => {
    const sotu = loadSplit("eval/golden/summarize/dev");
    expect(sotu.length).toBe(5);
    expect(sotu.every((i) => i.reference && i.document)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "hebsum-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ items: [{ id: "no" }] }));
    writeFileSync(join(dir, "part-a.json"), JSON.stringify({ items: [{ id: "h1", document: "מסמך", reference: "סיכום" }] }));
    expect(loadSplit(dir).map((i) => i.id)).toEqual(["h1"]);
    const empty = mkdtempSync(join(tmpdir(), "hebsum-"));
    expect(() => loadSplit(empty)).toThrow(/no items/);
  });
});
