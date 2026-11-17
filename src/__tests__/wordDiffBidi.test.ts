/**
 * Plan W13.R8 — word diff that is right for Hebrew and mixed-direction text
 * (src/reading/wordDiffBidi.ts), and the compare view built on it
 * (src/reading/CompareView.tsx).
 *
 * The acceptance set: 50 golden pairs in Hebrew and English
 * (fixtures/wordDiffGolden.json), each written by hand with what a reader
 * expects to see marked — prefix changes (ה→ו) mark only the prefix, a
 * niqqud-only change is a niqqud change, geresh and gershayim stay inside
 * their word, ignoring niqqud and spaces works. The bidi order of the
 * rendered marks and axe are checked in a real browser:
 * e2e/compare-view.spec.ts (owed on the Mac).
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { changeRuns, myers, notation, prefixChange, rows, stripNiqqud, tokenize, wordDiff, type DiffOptions } from "../reading/wordDiffBidi";
import { CompareView } from "../reading/CompareView";
import { recentAnnouncements } from "../a11y/announce";

type Golden = { a: string; b: string; opts?: DiffOptions; expect: string; why: string };
const golden = JSON.parse(readFileSync(join(__dirname, "fixtures/wordDiffGolden.json"), "utf8")) as Golden[];

/** The new text back from a diff, and the old one. */
const sides = (a: string, b: string, opts?: DiffOptions) => {
  let o = "";
  let n = "";
  for (const p of wordDiff(a, b, opts)) {
    if (p.type === "equal") {
      o += p.oldText ?? p.text;
      n += p.text;
    } else if (p.type === "delete") o += p.text;
    else if (p.type === "insert") n += p.text;
    else if (p.type === "prefix") {
      o += p.oldPrefix + p.oldStem;
      n += p.newPrefix + p.stem;
    } else {
      o += p.oldText;
      n += p.text;
    }
  }
  return { o, n };
};

describe("50 golden pairs, Hebrew and English", () => {
  it("there are 50, about half Hebrew", () => {
    expect(golden.length).toBe(50);
    expect(golden.filter((g) => /[א-ת]/.test(g.a + g.b)).length).toBeGreaterThanOrEqual(25);
  });
  for (const g of golden) {
    it(g.why, () => {
      expect(notation(wordDiff(g.a, g.b, g.opts))).toBe(g.expect);
      // Nothing is lost: both texts come back from the pieces exactly.
      const { o, n } = sides(g.a, g.b, g.opts);
      expect(n).toBe(g.b);
      expect(o).toBe(g.a);
    });
  }
});

describe("tokens", () => {
  it("geresh and gershayim stay inside a Hebrew word; niqqud stays on its letter", () => {
    expect(tokenize("צה״ל ג'ירפה, שָׁלוֹם")).toEqual(["צה״ל", " ", "ג'ירפה", ",", " ", "שָׁלוֹם"]);
    expect(tokenize("ת\"א")).toEqual(['ת"א']);
  });
  it("the tokens are the text", () => {
    for (const g of golden) expect(tokenize(g.a).join("")).toBe(g.a);
  });
  it("niqqud stripping keeps the maqaf and sof pasuq", () => {
    expect(stripNiqqud("בְּרֵאשִׁית־בָּרָא׃")).toBe("בראשית־ברא׃");
  });
  it("a prefix change needs a stem of two letters or more", () => {
    expect(prefixChange("הבית", "ובית")).toMatchObject({ oldPrefix: "ה", newPrefix: "ו", stem: "בית" });
    expect(prefixChange("של", "כל")).toBeNull();
    expect(prefixChange("cat", "bat")).toBeNull();
  });
});

describe("myers", () => {
  it("finds the shortest edit", () => {
    const ops = myers("abcabba".split(""), "cbabac".split(""));
    const d = ops.filter((o) => o.type !== "equal").reduce((s, o) => s + o.n, 0);
    expect(d).toBe(5);
  });
  it("a 2 MB note with a handful of edits: under 3 s, the edits found", () => {
    const para = (i: number) => `פסקה ${i} עם טקסט בעברית ו-English words, ${"מילה ".repeat(8)}\n\n`;
    let a = "";
    for (let i = 0; a.length < 2_000_000; i++) a += para(i);
    const b = a.replace("פסקה 100 עם", "פסקה 100 בלי").replace("פסקה 20000 עם", "והפסקה 20000 עם");
    const t0 = performance.now();
    const pieces = wordDiff(a, b);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(notation(pieces.filter((p) => p.type !== "equal"))).toBe("[-עם-]{+בלי+}{+וה+}פסקה");
  }, 30_000);
});

describe("rows for the two columns", () => {
  it("paragraphs line up; an added paragraph has an empty cell on the old side", () => {
    const r = rows(wordDiff("one\n\ntwo\n\nthree", "one\n\nnew\n\ntwo\n\nthree"));
    const text = (ps: { type: string; text?: string }[]) => ps.map((p) => (p.type === "delete" || p.type === "insert" || p.type === "equal" ? p.text : "")).join("");
    expect(r.map((x) => [text(x.old).trim(), text(x.new).trim()])).toEqual([
      ["one", "one"],
      ["", "new"],
      ["two", "two"],
      ["three", "three"],
    ]);
  });
  it("with niqqud ignored, each column still shows its own text", () => {
    const r = rows(wordDiff("שָׁלוֹם עוֹלָם", "שלום עולם", { ignoreNiqqud: true }));
    expect(r[0].old.map((p) => (p as { text: string }).text).join("")).toBe("שָׁלוֹם עוֹלָם");
    expect(r[0].new.map((p) => (p as { text: string }).text).join("")).toBe("שלום עולם");
  });
  it("changes are counted once each", () => {
    expect(changeRuns(wordDiff("a b c d", "a x c y")).length).toBe(2);
  });
});

describe("the compare view", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.dir = "";
    localStorage.clear();
  });
  const left = { label: "ישן", text: "הבית גדול.\n\nפסקה שנייה.\n\nשלישית." };
  const right = { label: "חדש", text: "ובית גדול.\n\nפסקה שנייה ארוכה.\n\nשלישית." };

  it("old column first (on the right in RTL); F7 / Shift+F7 go through the changes and announce each", () => {
    document.documentElement.dir = "rtl";
    render(createElement(CompareView, { left, right, onClose: () => {} }));
    const view = screen.getByTestId("compare-view");
    expect(view.getAttribute("data-changes")).toBe("2");
    const cells = view.querySelectorAll(".cmp-row:not(.cmp-labels) .cmp-cell");
    expect(cells[0].classList.contains("cmp-old")).toBe(true);
    expect(cells[0].querySelector("del")?.textContent).toBe("ה");
    expect(cells[1].querySelector("ins")?.textContent).toBe("ו");
    act(() => {
      fireEvent.keyDown(view, { key: "F7" });
    });
    expect(screen.getByTestId("compare-count").textContent).toContain("1");
    act(() => {
      fireEvent.keyDown(view, { key: "F7" });
    });
    expect(view.querySelectorAll(".cmp-current").length).toBeGreaterThan(0);
    act(() => {
      fireEvent.keyDown(view, { key: "F7", shiftKey: true });
    });
    expect(screen.getByTestId("compare-count").textContent).toMatch(/1.*2/);
  });

  it("inline view and the ignore options; the choice is kept", () => {
    render(createElement(CompareView, { left: { label: "a", text: "שָׁלוֹם  עולם" }, right: { label: "b", text: "שלום עולם" }, onClose: () => {} }));
    fireEvent.click(screen.getByTestId("compare-inline"));
    expect(screen.getByTestId("compare-body").classList.contains("cmp-inline")).toBe(true);
    fireEvent.click(screen.getByTestId("compare-ignore-niqqud"));
    fireEvent.click(screen.getByTestId("compare-ignore-space"));
    expect(screen.getByTestId("compare-view").getAttribute("data-changes")).toBe("0");
    expect(JSON.parse(localStorage.getItem("lumen.compare") ?? "{}")).toMatchObject({ layout: "inline", ignoreNiqqud: true, ignoreWhitespace: true });
  });

  it("long unchanged stretches fold", () => {
    const many = Array.from({ length: 40 }, (_, i) => `פסקה ${i}.`).join("\n\n");
    render(createElement(CompareView, { left: { label: "a", text: many }, right: { label: "b", text: many.replace("פסקה 20.", "פסקה עשרים.") }, onClose: () => {} }));
    const folds = screen.getAllByRole("button", { name: /unchanged|לא השתנו/ });
    expect(folds.length).toBe(2);
    expect(screen.getByTestId("compare-view").querySelectorAll("[data-row]").length).toBeLessThan(10);
    fireEvent.click(folds[0]);
    expect(screen.getByTestId("compare-view").querySelectorAll("[data-row]").length).toBeGreaterThan(20);
  });

  it("no differences says so", () => {
    render(createElement(CompareView, { left: { label: "a", text: "same" }, right: { label: "b", text: "same" }, onClose: () => {} }));
    fireEvent.keyDown(screen.getByTestId("compare-view"), { key: "F7" });
    expect(recentAnnouncements().join(" ")).toMatch(/No differences/);
  });
});
