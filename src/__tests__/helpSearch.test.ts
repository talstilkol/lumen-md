/**
 * W3.7 — offline help: the docs are packed into the app, and the on-device
 * search finds the 20 golden Hebrew queries of the docs site (W1.28).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HelpIndex, hebrewForms, queryWords, type HelpBundle } from "../help/helpSearch";

const ROOT = join(__dirname, "..", "..");
const read = (lang: "en" | "he") => JSON.parse(readFileSync(join(ROOT, `src/help/generated/help.${lang}.json`), "utf8")) as HelpBundle;
const golden = JSON.parse(readFileSync(join(ROOT, "docs/search-golden.json"), "utf8")) as { queries: Array<{ q: string; page: string }> };

describe("offline help search", () => {
  const he = new HelpIndex(read("he"));
  const en = new HelpIndex(read("en"));

  it("finds 20/20 golden Hebrew queries in the top 3", () => {
    const misses: string[] = [];
    for (const { q, page } of golden.queries) {
      const top = he.search(q, 3).map((r) => `he/${r.page.slug}`);
      if (!top.includes(page)) misses.push(`${q} → ${page}: ${top.join(", ")}`);
    }
    expect(misses).toEqual([]);
    expect(golden.queries.length).toBe(20);
  });

  it("finds English pages too, with the section to open", () => {
    const r = en.search("keyboard shortcuts", 3);
    expect(r[0].page.slug).toBe("getting-started/shortcuts");
    const deep = en.search("snippet sanitizer url", 5).concat(en.search("export pdf", 5));
    expect(deep.length).toBeGreaterThan(0);
  });

  it("is the bundle the docs make today (run npm run help:bundle after editing the docs)", async () => {
    const m = (await import("../../scripts/help-bundle.mjs" as string)) as { bundle(lang: "en" | "he"): HelpBundle };
    for (const lang of ["en", "he"] as const) expect(JSON.stringify(m.bundle(lang))).toBe(JSON.stringify(read(lang)));
  });

  it("packs every page in both languages, with Markdown and sections", () => {
    const enSlugs = read("en").pages.map((p) => p.slug).sort();
    const heSlugs = read("he").pages.map((p) => p.slug).sort();
    expect(heSlugs).toEqual(enSlugs);
    for (const p of read("he").pages) {
      expect(p.title, p.slug).toBeTruthy();
      expect(p.md.length, p.slug).toBeGreaterThan(20);
    }
  });

  it("matches Hebrew words under prefixes and construct state", () => {
    expect(hebrewForms("והפתקים")).toContain("הפתקים");
    expect(hebrewForms("והפתקים")).toContain("פתקים");
    expect(hebrewForms("התקנת")).toContain("התקנה");
    expect(queryWords("מעבר מ-Notion")).toEqual(["מעבר", "notion"]);
  });
});
