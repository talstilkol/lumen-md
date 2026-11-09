/** T32 / T33 — read aloud and the daily digest. */
import { describe, it, expect } from "vitest";
import { langFor, speakableSentences } from "../ai/tts";
import { buildDigest, openTasks } from "../agents/defs/digester";

describe("read aloud", () => {
  it("splits into sentences with source ranges, skipping frontmatter and code", () => {
    const md = "---\ntitle: x\n---\n# כותרת\n\nשלום עולם. מה נשמע?\n\n```js\nconst a = 1;\n```\nSee [the docs](https://x.y) now!";
    const s = speakableSentences(md);
    expect(s.map((x) => x.text)).toEqual(["כותרת", "שלום עולם.", "מה נשמע?", "See the docs now!"]);
    expect(md.slice(s[1].from, s[1].to)).toBe("שלום עולם.");
  });
  it("picks the Hebrew voice for Hebrew sentences", () => {
    expect(langFor("שלום עולם", "en")).toBe("he-IL");
    expect(langFor("Hello", "en")).toBe("en");
  });
});

describe("digest", () => {
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  it("lists changed notes newest first with their open tasks, in Hebrew", () => {
    const d = buildDigest({
      since: 0,
      now: Date.UTC(2026, 9, 18),
      lang: "he",
      formatDate: fmt,
      notes: [
        { entry: { path: "a/פגישה.md", name: "פגישה.md", size: 1, modified: 2 }, content: "# פגישת צוות\n- [ ] לשלוח סיכום\n- [x] סגור" },
        { entry: { path: "ideas.md", name: "ideas.md", size: 1, modified: 1 }, content: "plain" },
      ],
    });
    expect(d).toContain("# סיכום — 2026-10-18");
    expect(d.indexOf("[[פגישה]] — פגישת צוות")).toBeLessThan(d.indexOf("[[ideas]]"));
    expect(d).toContain("- [ ] לשלוח סיכום ← [[פגישה]]");
    expect(d).not.toContain("סגור ←");
  });
  it("says so when nothing changed", () => {
    expect(buildDigest({ since: 0, now: 0, lang: "en", formatDate: fmt, notes: [] })).toContain("Nothing changed");
  });
  it("finds open tasks only", () => {
    expect(openTasks("- [ ] a\n* [ ] b\n- [x] c")).toEqual(["a", "b"]);
  });
});
