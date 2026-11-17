/** Plan W7.9: a note's language tag from its front matter, or Yiddish from its text. */
import { describe, expect, it } from "vitest";
import { canonicalTag, noteLanguage, wantsHebrewFont } from "../text/noteLanguage";
import { mayHaveLanguage } from "../text/noteLanguageLoader";

describe("note language tags (W7.9)", () => {
  it("reads lang: from the front matter, with its direction", () => {
    expect(noteLanguage("---\nlang: yi\n---\nאַ ליד")).toEqual({ tag: "yi", dir: "rtl", source: "frontmatter" });
    expect(noteLanguage("---\nlanguage: lad-Latn\n---\nKe haber?")).toEqual({ tag: "lad-Latn", dir: "ltr", source: "frontmatter" });
    expect(noteLanguage("---\nlang: LAD_hebr\n---\nקי חאבֿיר")?.tag).toBe("lad-Hebr");
    expect(noteLanguage("---\nlang: he\n---\nשלום")?.dir).toBe("rtl");
    expect(noteLanguage("---\nlang: fr\n---\nBonjour")?.dir).toBe("ltr");
  });

  it("resolves plain lad by the note's script", () => {
    expect(noteLanguage("---\nlang: lad\n---\nAki Yerushalayim")?.tag).toBe("lad-Latn");
    expect(noteLanguage("---\nlang: lad\n---\nאקי ירושלים")?.tag).toBe("lad-Hebr");
  });

  it("detects a Yiddish note without front matter, and leaves Hebrew and English alone", () => {
    expect(noteLanguage("# ייִדיש\n\nמיר וווינען אין דער שטאָט און לייענען ביכער אויף ייִדיש.")).toEqual({ tag: "yi", dir: "rtl", source: "detected" });
    expect(noteLanguage("# שלום\n\nאני גר בעיר הגדולה ואוהב לקרוא ספרים.")).toBeNull();
    expect(noteLanguage("# Hello\n\nPlain English.")).toBeNull();
  });

  it("refuses what is not a language tag", () => {
    expect(canonicalTag("yi")).toBe("yi");
    expect(canonicalTag("not a tag")).toBeNull();
    expect(noteLanguage("---\nlang: <script>\n---\nx")).toBeNull();
  });

  it("loads the language module only when a note may have one, and the Hebrew face only for Hebrew-letter Jewish languages", () => {
    expect(mayHaveLanguage("# Hello")).toBe(false);
    expect(mayHaveLanguage("---\nlang: lad\n---\n")).toBe(true);
    expect(mayHaveLanguage("שלום")).toBe(true);
    expect(wantsHebrewFont("yi")).toBe(true);
    expect(wantsHebrewFont("lad-Hebr")).toBe(true);
    expect(wantsHebrewFont("lad-Latn")).toBe(false);
    expect(wantsHebrewFont("he")).toBe(false);
  });
});

describe("note language tags and tagged blocks (W7.9)", () => {
  const yiddishLine = "מיר וווינען אין דער שטאָט און לייענען ביכער אויף ייִדיש.";
  it("does not tag an English note yi because it quotes Yiddish", () => {
    expect(noteLanguage(`# Family letters\n\nAn English note about the letters our grandmother wrote, with one line:\n\n${yiddishLine}`)).toBeNull();
  });

  it("leaves a block tagged with its own lang out of the note's detection", () => {
    expect(noteLanguage(`# Letters\n\n<div lang="yi">\n\n${yiddishLine}\n\n</div>\n\nשלום, זו פסקה בעברית.`)).toBeNull();
    expect(noteLanguage(`# ייִדיש\n\n${yiddishLine}\n\nA line in English inside a Yiddish note.`)?.tag).toBe("yi");
  });
});

describe("the pointed Hebrew face for a tagged block (W7.9)", () => {
  it("is wanted for a yi or lad-Hebr block, not for other tags", async () => {
    const { hasPointedBlock } = await import("../text/noteLanguageLoader");
    expect(hasPointedBlock('<div lang="yi">\n\nאַ ליד\n\n</div>')).toBe(true);
    expect(hasPointedBlock("<p lang='lad-Hebr'>קי חאבֿיר</p>")).toBe(true);
    expect(hasPointedBlock('<div lang="lad-Latn">Ke haber</div>')).toBe(false);
    expect(hasPointedBlock('<div lang="yiddish-ish">x</div>')).toBe(false);
    expect(hasPointedBlock('<p lang="yi-Latn">mir voynen</p>')).toBe(false);
  });
});
