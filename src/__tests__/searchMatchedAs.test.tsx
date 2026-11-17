/**
 * Plan R12.16: the "matched as …" line under a search result, in English and
 * (from the Hebrew locale file) in Hebrew. Synthetic one-line notes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import "../ui/searchDialogStrings";
import { MatchedAsLine, matchedAsPart } from "../ui/searchSnippet";

/** The line without its bidi isolates (FSI U+2068, PDI U+2069). */
const plain = (s: string | null) => (s ?? "").replace(/[\u2068\u2069]/g, "");

const hit = (snippet: string, name = "note") => ({ path: `${name}.md`, name, score: 1, snippet });

describe("MatchedAsLine", () => {
  it("explains a transliteration: Kohen → כהן", () => {
    render(<MatchedAsLine query="Kohen" hit={hit("הרב כהן אמר דברים")} />);
    expect(plain(screen.getByTestId("search-matched-as").textContent)).toBe("Matched as transliteration: Kohen → כהן");
  });

  it("explains a prefix: ולפיד → לפיד (ו)", () => {
    render(<MatchedAsLine query="ולפיד" hit={hit("לפיד הודיע הבוקר")} />);
    expect(plain(screen.getByTestId("search-matched-as").textContent)).toBe("Matched as without the prefix (ו): ולפיד → לפיד");
  });

  it("isolates both words, so a Latin query beside a Hebrew word keeps its order", () => {
    render(<MatchedAsLine query="Kohen" hit={hit("הרב כהן אמר דברים")} />);
    const el = screen.getByTestId("search-matched-as");
    expect(el.textContent).toContain("\u2068Kohen\u2069 → \u2068כהן\u2069");
    expect(el.getAttribute("dir")).toBe("ltr");
  });

  it("points the arrow along the reading direction: ← in an RTL interface", () => {
    expect(matchedAsPart("תעתיק", "Kohen", "כהן", true)).toBe("תעתיק: \u2068Kohen\u2069 ← \u2068כהן\u2069");
    expect(matchedAsPart("transliteration", "Kohen", "כהן", false)).toBe("transliteration: \u2068Kohen\u2069 → \u2068כהן\u2069");
  });

  it("says nothing for an exact match", () => {
    const { container } = render(<MatchedAsLine query="garden" hit={hit("my garden notes")} />);
    expect(container.textContent).toBe("");
  });

  it("the Hebrew strings say תעתיק and בלי תחילית", () => {
    const he = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/he/files.json"), "utf8")) as Record<string, string>;
    expect(he["searchDialog.matchedAs.translit"]).toBe("תעתיק");
    expect(he["searchDialog.matchedAs.prefix"].replace("{prefix}", "ו")).toBe("בלי תחילית (ו)");
    expect(he["searchDialog.matchedAs"]).toContain("{how}");
  });
});
