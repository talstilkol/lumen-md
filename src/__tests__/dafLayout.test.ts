/**
 * W13.R11: the page of the Talmud. The band plan (dafLayout.ts) against a
 * line model of the browser — every case of the Vilna page: the main text
 * outlasts the commentaries (it widens: "extend"), the commentaries outlast
 * it (they take their halves under it: "wrap"), one commentary is short or
 * missing — with no two texts sharing a region; the sides by amud; the
 * sources (commentary blocks, a Sefaria source note); the DOM's reading order.
 * The real layout, with a real Berakhot 2a, is checked in Chromium by
 * e2e/daf-view.spec.ts (0 overlapping line boxes, Rashi and Tosafot sides).
 */
import { describe, expect, it } from "vitest";
import { bandExtents, dafGeometry, floatsFor, planDaf, type DafBand, type DafSlot } from "../reading/daf/dafLayout";
import { amudOfRef, commentaryBlocks, commentaryFromNote, dafFromNote, defaultCommentaryPaths, plainParagraphs } from "../reading/daf/dafSources";
import { buildDaf } from "../reading/daf/dafDom";
import { renderSourceNote } from "../sources/sefaria/store";
import { parseSourceRef } from "../sources/sefaria/refs";

const g = dafGeometry(860, { commentaryLine: 20 });

/** A line model: a text of `area` px² fills each band's extent line by line (line height `lh`). */
function model(areas: Partial<Record<DafSlot, number>>, lh: Partial<Record<DafSlot, number>> = {}) {
  return (slot: DafSlot, bands: readonly DafBand[]): number => {
    let left = areas[slot] ?? 0;
    const h = lh[slot] ?? (slot === "main" ? 30 : 20);
    let y = 0;
    for (const b of bands) {
      const ext = b.extents[slot];
      const top = Math.max(b.y0, y);
      // A line starts on the line grid after the band starts.
      let lineTop = Math.ceil(top / h) * h;
      if (!ext) {
        y = Number.isFinite(b.y1) ? b.y1 : y;
        continue;
      }
      const w = ext[1] - ext[0];
      while (left > 0 && lineTop + h <= b.y1 + 0.001) {
        left -= w * h;
        lineTop += h;
      }
      if (left <= 0) return lineTop;
      y = b.y1;
    }
    return Infinity;
  };
}

/** No two texts own the same part of any band. */
function regionsDisjoint(bands: readonly DafBand[]): boolean {
  return bands.every((b) => {
    const xs = Object.values(b.extents).sort((p, q) => p![0] - q![0]);
    return xs.every((e, i) => i === 0 || xs[i - 1]![1] <= e![0]);
  });
}

describe("band extents", () => {
  const all = new Set<DafSlot>(["main", "inner", "outer"]);
  it("lead: the commentaries open the page, half each; the main text waits", () => {
    const e = bandExtents(all, "lead", g);
    expect(e.main).toBeUndefined();
    expect(e.inner![0]).toBe(0);
    expect(e.outer![1]).toBe(860);
    expect(e.inner![1]).toBeLessThanOrEqual(e.outer![0] - g.gap + 0.001);
  });
  it("body: the main text in the middle, narrow commentaries on its sides", () => {
    const e = bandExtents(all, "body", g);
    expect(e.main![1] - e.main![0]).toBeCloseTo(g.main);
    expect(e.inner![1] + g.gap).toBeCloseTo(e.main![0]);
    expect(e.main![1] + g.gap).toBeCloseTo(e.outer![0]);
  });
  it("extend: a commentary ends, the main text widens to that side; both end, the full width", () => {
    expect(bandExtents(new Set<DafSlot>(["main", "outer"]), "body", g).main![0]).toBe(0);
    expect(bandExtents(new Set<DafSlot>(["main", "inner"]), "body", g).main![1]).toBe(860);
    expect(bandExtents(new Set<DafSlot>(["main"]), "body", g).main).toEqual([0, 860]);
  });
  it("wrap: the main text ends, the commentaries take their halves under it", () => {
    const e = bandExtents(new Set<DafSlot>(["inner", "outer"]), "body", g);
    expect(e.inner).toEqual([0, (860 - g.gap) / 2]);
    expect(e.outer).toEqual([860 - (860 - g.gap) / 2, 860]);
  });
});

describe("planDaf", () => {
  const all = new Set<DafSlot>(["main", "inner", "outer"]);
  const cases: Array<[string, Partial<Record<DafSlot, number>>]> = [
    ["the main text outlasts both commentaries (extend)", { main: 420 * 30 * 40, inner: 200 * 20 * 30, outer: 200 * 20 * 26 }],
    ["the commentaries outlast the main text (wrap)", { main: 400 * 30 * 6, inner: 200 * 20 * 60, outer: 200 * 20 * 55 }],
    ["one commentary ends in the lead", { main: 400 * 30 * 20, inner: 300 * 20, outer: 200 * 20 * 40 }],
    ["equal lengths", { main: 400 * 30 * 20, inner: 200 * 20 * 40, outer: 200 * 20 * 40 }],
  ];
  for (const [name, areas] of cases) {
    it(`${name}: every text ends, regions never overlap, bands are contiguous`, () => {
      const plan = planDaf(all, g, model(areas));
      expect(Object.keys(plan.ends).sort()).toEqual(["inner", "main", "outer"]);
      expect(regionsDisjoint(plan.bands)).toBe(true);
      plan.bands.forEach((b, i) => {
        if (i) expect(b.y0).toBe(plan.bands[i - 1].y1);
        expect(b.y1).toBeGreaterThanOrEqual(b.y0);
      });
      expect(plan.height).toBe(Math.max(...Object.values(plan.ends).map(Number)));
      expect(plan.bands[0].phase).toBe("lead");
    });
  }
  it("extend: after the first commentary ends, the main text runs wider", () => {
    const plan = planDaf(all, g, model(cases[0][1]));
    const last = plan.bands[plan.bands.length - 1];
    expect(Object.keys(last.extents)).toEqual(["main"]);
    expect(last.extents.main).toEqual([0, 860]);
  });
  it("wrap: the last band has both commentaries at half width", () => {
    const plan = planDaf(all, g, model(cases[1][1]));
    expect(plan.ends.main!).toBeLessThan(plan.ends.inner!);
    const after = plan.bands.find((b) => b.y0 >= plan.ends.main! && b.extents.inner);
    expect(after!.extents.inner![1]).toBeCloseTo((860 - g.gap) / 2);
  });
  it("a note without commentaries is one full-width text; without a main text, two halves", () => {
    const solo = planDaf(new Set<DafSlot>(["main"]), g, model({ main: 860 * 30 * 10 }));
    expect(solo.bands).toHaveLength(1);
    expect(solo.bands[0].extents.main).toEqual([0, 860]);
    const pair = planDaf(new Set<DafSlot>(["inner", "outer"]), g, model({ inner: 400 * 20 * 3, outer: 400 * 20 * 5 }));
    expect(regionsDisjoint(pair.bands)).toBe(true);
    expect(pair.ends.outer!).toBeGreaterThan(pair.ends.inner!);
  });
});

describe("sides", () => {
  const bands: DafBand[] = [{ y0: 0, y1: 100, phase: "body", extents: bandExtents(new Set<DafSlot>(["main", "inner", "outer"]), "body", g) }];
  it("amud a: the inner commentary (Rashi) on the right — its float on the left is the rest of the page", () => {
    const [f] = floatsFor("inner", bands, g, "right");
    expect(f.right).toBe(0);
    expect(f.left).toBeCloseTo(860 - bands[0].extents.inner![1]);
  });
  it("amud b: Rashi on the left", () => {
    const [f] = floatsFor("inner", bands, g, "left");
    expect(f.left).toBe(0);
  });
  it("a text with no region in a band is floated out across the page", () => {
    const lead: DafBand[] = [{ y0: 0, y1: 80, phase: "lead", extents: bandExtents(new Set<DafSlot>(["main", "inner", "outer"]), "lead", g) }];
    expect(floatsFor("main", lead, g, "right")[0]).toEqual({ height: 80, left: 860, right: 0 });
  });
  it("the amud from a reference", () => {
    expect(amudOfRef("Berakhot 2a")).toBe("a");
    expect(amudOfRef("Shabbat 31b")).toBe("b");
    expect(amudOfRef("Berakhot 2a:3-5")).toBe("a");
    expect(amudOfRef("Genesis 1:1")).toBeNull();
  });
});

describe("sources", () => {
  const note = "---\namud: b\n---\n# דף\n\nמאימתי **קורין** את שמע.\n\nגמרא. תנא היכא קאי.\n\n```commentary inner רש״י\nמאימתי. כהנים שנטמאו.\n```\n\n~~~commentary outer תוספות\nפירש רש״י.\n\nועוד קשה.\n~~~\n";
  it("commentary blocks are taken out of the main text, with their titles", () => {
    const { rest, inner, outer } = commentaryBlocks(note);
    expect(inner).toEqual({ title: "רש״י", paragraphs: ["מאימתי. כהנים שנטמאו."] });
    expect(outer).toEqual({ title: "תוספות", paragraphs: ["פירש רש״י.", "ועוד קשה."] });
    expect(rest).not.toContain("commentary");
  });
  it("a note: its heading is the title, its marks are dropped, `amud: b` is read", () => {
    const d = dafFromNote(note);
    expect(d.main).toEqual({ title: "דף", paragraphs: ["מאימתי קורין את שמע.", "גמרא. תנא היכא קאי."] });
    expect(d.amud).toBe("b");
    expect(d.inner?.title).toBe("רש״י");
  });
  it("a Sefaria source note: the Hebrew version is the main text; the default commentary paths", () => {
    const ref = parseSourceRef("Berakhot 2a")!;
    const md = renderSourceNote(
      {
        ref,
        heRef: "ברכות ב א",
        versions: [
          { language: "he", direction: "rtl", title: "Vilna", source: null, license: "Public Domain", licenseUrl: null, free: true, text: ["מאימתי קורין", "את שמע בערבין"], isSource: true },
          { language: "en", direction: "ltr", title: "Davidson", source: null, license: "CC-BY-NC", licenseUrl: null, free: false, text: null, isSource: false },
        ],
      },
      "2026-11-17",
    );
    const d = dafFromNote(md);
    expect(d.main).toEqual({ title: "ברכות ב א", paragraphs: ["מאימתי קורין", "את שמע בערבין"] });
    expect(d.ref).toBe(ref.tref);
    expect(d.amud).toBe("a");
    expect(defaultCommentaryPaths(ref.tref).inner).toBe(`Sources/Sefaria/Rashi on ${ref.tref}.md`);
    expect(commentaryFromNote(md, "רש״י")?.paragraphs).toEqual(["מאימתי קורין", "את שמע בערבין"]);
  });
  it("plain paragraphs: links, wiki links, lists and quotes become text", () => {
    expect(plainParagraphs("> ראו [[ברכות ב|הדף]] ו[כאן](https://x.y)\n\n- אחד\n- שתיים")).toEqual(["ראו הדף וכאן", "אחד שתיים"]);
  });
  it("an empty note has no main text", () => {
    expect(dafFromNote("---\na: 1\n---\n").main).toBeNull();
  });
});

describe("the DOM: reading order and labels", () => {
  it("main, then inner, then outer; each a labelled Hebrew region", () => {
    const page = buildDaf(document, dafFromNote("# כותרת\n\nטקסט מרכזי.\n\n```commentary outer תוספות\nב\n```\n\n```commentary inner רש״י\nא\n```\n"), { main: "Main", inner: "Inner", outer: "Outer" });
    const secs = Array.from(page.querySelectorAll("section"));
    expect(secs.map((s) => s.dataset.slot)).toEqual(["main", "inner", "outer"]);
    expect(secs.every((s) => s.getAttribute("lang") === "he" && s.getAttribute("dir") === "rtl")).toBe(true);
    expect(page.querySelector("#daf-h-inner")!.textContent).toBe("Inner: רש״י");
    expect(page.querySelectorAll(".daf-end")).toHaveLength(3);
  });
});
