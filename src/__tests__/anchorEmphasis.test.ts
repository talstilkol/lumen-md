/**
 * Plan W13.R4 — anchor emphasis: the first 40% of each word, in Latin and
 * Hebrew script, never cutting a letter from its niqqud; drawn as a CSS
 * highlight, so the DOM (and the note) are untouched. Off by default.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { anchorLetters, anchorRanges, applyAnchor, clearAnchor, collectAnchorRanges, anchorRoots, ANCHOR_HIGHLIGHT } from "../reading/anchorEmphasis";
import { DEFAULT_PROFILE } from "../reading/settings";

const parts = (text: string) => anchorRanges(text).map(([a, b]) => text.slice(a, b));

// Genesis 1:1–5 with niqqud and cantillation: the hardest case for a cut.
const GENESIS =
  "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ וְחֹ֖שֶׁךְ עַל־פְּנֵ֣י תְה֑וֹם וְר֣וּחַ אֱלֹהִ֔ים מְרַחֶ֖פֶת עַל־פְּנֵ֥י הַמָּֽיִם׃ וַיֹּ֥אמֶר אֱלֹהִ֖ים יְהִ֣י א֑וֹר וַֽיְהִי־אֽוֹר׃ וַיַּ֧רְא אֱלֹהִ֛ים אֶת־הָא֖וֹר כִּי־ט֑וֹב וַיַּבְדֵּ֣ל אֱלֹהִ֔ים בֵּ֥ין הָא֖וֹר וּבֵ֥ין הַחֹֽשֶׁךְ׃ וַיִּקְרָ֨א אֱלֹהִ֤ים ׀ לָאוֹר֙ י֔וֹם וְלַחֹ֖שֶׁךְ קָ֣רָא לָ֑יְלָה וַֽיְהִי־עֶ֥רֶב וַֽיְהִי־בֹ֖קֶר י֥וֹם אֶחָֽד׃";

describe("how much of a word", () => {
  it("40% of the letters, at least one", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10, 15].map(anchorLetters)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 4, 6]);
    expect(anchorLetters(0)).toBe(0);
  });

  it("Latin: word starts, punctuation not counted", () => {
    expect(parts("Reading is fun, isn't it? (Yes!)")).toEqual(["Rea", "i", "f", "is", "i", "Y"]);
    expect(parts("e-mail 2026")).toEqual(["e-m", "20"]);
  });

  it("Hebrew: whole letters with their niqqud", () => {
    expect(parts("בְּרֵאשִׁית בָּרָא")).toEqual(["בְּרֵ", "בָּ"]);
    expect(parts("צה״ל אמר")).toEqual(["צ", "א"]);
  });

  it("no cut ever leaves a mark without its letter (Genesis 1:1–5, niqqud and cantillation)", () => {
    const ranges = anchorRanges(GENESIS);
    expect(ranges.length).toBeGreaterThan(50);
    for (const [from, to] of ranges) {
      // The next character is not a combining mark (niqqud, dagesh, shin dot, cantillation).
      expect(/\p{M}/u.test(GENESIS[to] ?? "")).toBe(false);
      expect(/\p{M}/u.test(GENESIS[from])).toBe(false);
    }
  });
});

describe("on the page", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    clearAnchor();
  });

  function page(): HTMLElement {
    const root = document.createElement("div");
    root.className = "prose-lumen";
    root.innerHTML = "<p>Reading <em>is</em> fun.</p><pre><code>const reading = 1;</code></pre><p>שָׁלוֹם <kbd>Ctrl</kbd></p>";
    document.body.appendChild(root);
    const editor = document.createElement("div");
    editor.className = "prose-lumen";
    editor.contentEditable = "true";
    editor.textContent = "editable words";
    document.body.appendChild(editor);
    return root;
  }

  it("only read-only prose: code, keys and editors are left alone", () => {
    page();
    const roots = anchorRoots();
    expect(roots.length).toBe(1);
    const got = collectAnchorRanges(roots).map((r) => r.toString());
    expect(got).toEqual(["Rea", "i", "f", "שָׁל"]);
  });

  it("registers one highlight and never changes the DOM", () => {
    const root = page();
    const before = document.body.innerHTML;
    const registry = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    }
    const win = document.defaultView as Window;
    const w = win as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: unknown };
    const real = { CSS: w.CSS, Highlight: w.Highlight };
    // The browser's own API when it has one (Chromium), a stand-in otherwise.
    if (!w.Highlight || !w.CSS?.highlights) {
      Object.defineProperty(win, "Highlight", { value: FakeHighlight, configurable: true });
      Object.defineProperty(win, "CSS", { value: { ...(real.CSS ?? {}), highlights: registry }, configurable: true });
    }
    try {
      expect(applyAnchor()).toBe(4);
      const hl = (win as unknown as { CSS: { highlights: Map<string, { size?: number; ranges?: Range[] }> } }).CSS.highlights.get(ANCHOR_HIGHLIGHT);
      expect(hl?.ranges?.length ?? hl?.size).toBe(4);
      expect(document.body.innerHTML).toBe(before);
      expect(root.querySelectorAll("b, strong").length).toBe(0);
      clearAnchor();
      expect((win as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights.has(ANCHOR_HIGHLIGHT)).toBe(false);
    } finally {
      if (!real.Highlight) Object.defineProperty(win, "Highlight", { value: real.Highlight, configurable: true });
      if (!real.CSS?.highlights) Object.defineProperty(win, "CSS", { value: real.CSS, configurable: true });
    }
  });

  it("is off by default", () => {
    expect(DEFAULT_PROFILE.anchor).toBe(false);
  });
});

describe("from the reading profile", () => {
  it("anchor: true turns it on, false off again", async () => {
    const { applyProfile } = await import("../reading/profileStore");
    const { anchorOn } = await import("../reading/anchorEmphasis");
    await applyProfile({ ...DEFAULT_PROFILE, anchor: true });
    expect(anchorOn()).toBe(true);
    await applyProfile({ ...DEFAULT_PROFILE, anchor: false });
    expect(anchorOn()).toBe(false);
  });
});
