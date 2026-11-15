/**
 * W11.Q6: the product journey for screen readers (sr/productJourney.ts), which
 * the Guidepup specs run under VoiceOver (nightly `sr` kind, on the Mac) and
 * NVDA (owner, Windows). This checks the journey's data against the app's
 * real strings; what a reader actually says is only known on those hosts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { missingIn, productTasks, s, spokeHebrew, VAULT, type Action } from "../../sr/productJourney";

const RLM = "‏";

describe("the screen-reader product journey (W11.Q6)", () => {
  for (const locale of ["he", "en"] as const) {
    const tasks = productTasks(locale);

    it(`${locale}: has 10 steps, in order, each expecting something`, () => {
      expect(tasks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const t of tasks) {
        expect(t.actions.length).toBeGreaterThan(0);
        expect(t.expect.length).toBeGreaterThan(0);
        for (const e of t.expect.flat()) expect(e.trim().length).toBeGreaterThan(1);
      }
    });

    it(`${locale}: covers the task's journey — vault, new note, heading, palette, search, Settings with Escape, WYSIWYG, link, export`, () => {
      const titles = tasks.map((t) => t.title).join(" | ");
      for (const w of ["vault", "new note", "heading", "palette", "search", "Settings open", "Escape closes Settings", "WYSIWYG", "link", "export"]) expect(titles).toContain(w);
    });

    it(`${locale}: what a step expects after a clear cannot come from what was typed before it`, () => {
      for (const t of tasks) {
        const lastClear = t.actions.map((a) => "clear" in a).lastIndexOf(true);
        if (lastClear < 0) continue;
        const typedBefore = t.actions.slice(0, lastClear).filter((a): a is Extract<Action, { type: string }> => "type" in a).map((a) => a.type);
        for (const e of t.expect.flat()) for (const typed of typedBefore) expect(typed.includes(e), `step ${t.id}: "${e}" was typed`).toBe(false);
      }
      // Search and Settings clear the log after typing the command's name, before Enter.
      for (const id of [5, 6]) expect(tasks.find((t) => t.id === id)!.actions.some((a) => "clear" in a)).toBe(true);
    });

    it(`${locale}: the link step looks for a note that is in the vault`, () => {
      const link = tasks.find((t) => t.id === 9)!;
      expect(VAULT[locale].map((f) => f.path.replace(/\.md$/, ""))).toContain(link.expect[0]);
    });
  }

  it("expects the app's own strings, in each language", () => {
    expect(s("he", "palette.placeholder")).toBe("הקלד פקודה, או חפש");
    expect(s("en", "palette.placeholder")).toBe("Type a command, or search");
    expect(s("he", "editor.wysiwygAriaLabel")).toBe("עורך WYSIWYG");
    expect(() => s("he", "no.such.string")).toThrow(/no string/);
    const he = productTasks("he").flatMap((t) => t.expect.flat());
    expect(he.filter((x) => /[֐-׿]/.test(x)).length).toBeGreaterThanOrEqual(8);
  });

  it("matches spoken text across direction marks and spacing, and reports what was not said", () => {
    const palette = productTasks("he").find((t) => t.id === 4)!;
    expect(missingIn(palette, [`${RLM}הקלד  פקודה, או חפש…${RLM}`, "שדה טקסט"])).toEqual([]);
    expect(missingIn(palette, ["תיבת דו-שיח"])).toEqual(["הקלד פקודה, או חפש"]);
    expect(spokeHebrew(["heading level 1", "כותרת"])).toBe(true);
    expect(spokeHebrew(["heading level 1"])).toBe(false);
  });

  it("the WYSIWYG editor has the name step 8 listens for, and the specs run both languages", () => {
    expect(readFileSync("src/editor/WysiwygEditor.tsx", "utf8")).toMatch(/"aria-label": t\("editor\.wysiwygAriaLabel"\)/);
    for (const f of ["sr/voiceover.sr.ts", "sr/nvda.sr.ts"]) {
      const spec = readFileSync(f, "utf8");
      expect(spec).toContain('for (const locale of ["he", "en"] as const)');
      expect(spec).toContain("runProductJourney(");
    }
    expect(readFileSync("sr/voiceover.sr.ts", "utf8")).toContain("Carmit");
  });
});
