// @vitest-environment node
/**
 * Plan W13.H6 — the recorded public RTL test: 12 scenarios × 5 apps, each
 * cell with its app version, date and video; the W11.H13 page shows only
 * what was recorded, each claim linked to its video; docs:audit fails until
 * all 60 cells are there.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RTL_APPS, RTL_SCENARIOS, renderRtlSection, rtlMissing, rtlProblems, type RtlCell } from "../eval/public/rtlBenchmark";
// @ts-expect-error — plain .mjs script without type declarations
import { audit } from "../../scripts/rtl-benchmark-audit.mjs";

const ROOT = resolve(__dirname, "..", "..");
const cell = (scenario: string, app: RtlCell["app"], over: Partial<RtlCell> = {}): RtlCell => ({ scenario, app, version: "1.0", date: "2026-11-20", video: `rtl-benchmark/${scenario}-${app}.mp4`, result: "pass", ...over });

describe("the script", () => {
  it("has 12 scenarios and 5 apps, each scenario in English and Hebrew and in docs/rtl-benchmark.md", () => {
    expect(RTL_SCENARIOS).toHaveLength(12);
    expect(RTL_APPS).toEqual(["lumen", "obsidian", "notion", "bear", "apple-notes"]);
    const script = readFileSync(join(ROOT, "docs/rtl-benchmark.md"), "utf8");
    for (const s of RTL_SCENARIOS) {
      expect(s.he).toMatch(/[֐-׿]/);
      expect(script, s.id).toContain(`\`${s.id}\``);
    }
  });
});

describe("the ledger", () => {
  it("every cell needs a known scenario and app, a version, a date and a video that exists", () => {
    const p = rtlProblems(
      { cells: [cell("table", "obsidian"), cell("nope", "lumen"), cell("list", "bear", { version: "", date: "20.11", video: "rtl-benchmark/missing.mp4" }), cell("table", "obsidian")] },
      (v) => v !== "rtl-benchmark/missing.mp4",
    );
    expect(p).toEqual([
      "nope × lumen: unknown scenario",
      "list × bear: no version",
      "list × bear: no date (YYYY-MM-DD)",
      "list × bear: the video rtl-benchmark/missing.mp4 is not in docs/public",
      "table × obsidian: recorded twice",
    ]);
  });

  it("lists what is not recorded yet", () => {
    expect(rtlMissing({ cells: [] })).toHaveLength(60);
    expect(rtlMissing({ cells: [cell("table", "lumen")] })).toHaveLength(59);
  });
});

describe("the page shows only what was recorded, each claim linked to its video", () => {
  it("no recordings: says so, no table", () => {
    expect(renderRtlSection({ cells: [] }, "en").join("\n")).toMatch(/No recordings yet/);
  });

  it("recorded cells only; every claim links its video with version and date", () => {
    const out = renderRtlSection({ cells: [cell("table", "obsidian", { version: "1.15.1", result: "partial" }), cell("table", "lumen"), cell("list", "lumen", { result: "fail" })] }, "he").join("\n");
    expect(out).toMatch(/\| תרחיש \| Lumen \| Obsidian \|/);
    expect(out).not.toMatch(/Notion|Bear|Apple Notes/);
    expect(out).toMatch(/\[◐ חלקית\]\(\/rtl-benchmark\/table-obsidian\.mp4\) \(1\.15\.1, 2026-11-20\)/);
    expect(out).toMatch(/\| רשימה ממוספרת ורשימת תבליטים בעברית \| \[✗ שבור\]\(\/rtl-benchmark\/list-lumen\.mp4\) \(1\.0, 2026-11-20\) \| — \|/);
    const claims = out.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| תרחיש")).flatMap((l) => l.replace(/\s*\|\s*$/, "").split(" | ").slice(1));
    for (const c of claims) expect(c.trim() === "—" || /\]\(\/rtl-benchmark\/.+\.mp4\) \(.+, \d{4}-\d{2}-\d{2}\)/.test(c), c).toBe(true);
  });

  it("the committed W11.H13 pages carry the section in both languages", () => {
    expect(readFileSync(join(ROOT, "docs/src/content/docs/project/hebrew-benchmark.md"), "utf8")).toMatch(/## Recorded: 12 Hebrew scenarios in five apps/);
    expect(readFileSync(join(ROOT, "docs/src/content/docs/he/project/hebrew-benchmark.md"), "utf8")).toMatch(/## מוקלט: 12 תרחישי עברית בחמש אפליקציות/);
  });
});

describe("docs:audit", () => {
  const tree = (cells: RtlCell[], videos: string[]) => {
    const root = mkdtempSync(join(tmpdir(), "rtl-"));
    mkdirSync(join(root, "launch"));
    mkdirSync(join(root, "docs/public/rtl-benchmark"), { recursive: true });
    writeFileSync(join(root, "launch/rtl-benchmark.json"), JSON.stringify({ cells }));
    for (const v of videos) writeFileSync(join(root, "docs/public", v), "mp4");
    return root;
  };

  it("fails until every one of the 60 cells has its video and date, then passes", () => {
    const all = RTL_SCENARIOS.flatMap((s) => RTL_APPS.map((a) => cell(s.id, a)));
    expect(audit(tree([], [])).ok).toBe(false);
    expect(audit(tree(all.slice(0, 59), all.map((c) => c.video))).ok).toBe(false);
    expect(audit(tree(all, all.slice(1).map((c) => c.video))).ok).toBe(false);
    const done = audit(tree(all, all.map((c) => c.video)));
    expect(done.lines).toEqual(["✓ rtl-benchmark: 60 recorded cells, each with a version, a date and its video"]);
    expect(done.ok).toBe(true);
  });

  it("is part of npm run docs:audit", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["docs:audit"]).toMatch(/node scripts\/rtl-benchmark-audit\.mjs/);
  });
});
