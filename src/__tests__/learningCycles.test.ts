/**
 * Plan W12.H4: study cycles computed locally (src/learning/cycles.ts), the
 * {{learning}} line of the daily note, plans with progress, and readings
 * marked for review as flashcards.
 *
 * The outside check: hebcal-learning's output for 2020–2030, generated
 * outside the app (scripts/learning/reference-from-hebcal-learning.mjs) into
 * src/__tests__/fixtures/hebcal-learning/2020-2030.json. Until that file is
 * built (on a machine with network: owed to the Mac) the comparison is
 * skipped. The comparison code itself is tested on a SYNTHETIC fixture in
 * the same shape (hand-written here, labelled as such: not hebcal's data).
 *
 * Facts used as anchors are the public ones the plan states: cycle 14 of
 * Daf Yomi began on 5 January 2020; 2,711 folios a cycle.
 *
 * The daily Rambam is checked against the PUBLISHED schedule:
 * fixtures/hebcal-learning/rambam-published.json is hebcal-learning's own
 * test data (BSD-2-Clause, commit 63fadce4, checked there against
 * chabad.org's daily Rambam): one full one-chapter cycle (1,017 days from
 * 23 April 2023), the first days of 1984 in both schedules, spot dates
 * 1986–1991, and 41 days of the three-chapter cycle in 2020. Data only.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fixedOf, gregorianOf, type GDay } from "../daily/hebrewCalendar";
import { renderTemplate } from "../daily/dailyNote";
import { DAF_YOMI_DAYS, MISHNAH_COUNT, MISHNAH_YOMIT_DAYS, RAMBAM_CHAPTERS, RAMBAM_INTRO_UNITS, RAMBAM_UNITS, dafYomi, dafYomiCycleStart, dailyRambam, mishnahRefs, mishnahYomit, rambamCycleDays, sefariaUrl } from "../learning/cycles";
import { emptyLearningFile, follow, learningLines, markDone, markForReview, parseLearningFile, progress, reviewCards, serializeLearningFile } from "../learning/plans";
import { emptyReviewFile, syncSources } from "../srs/cards";
// @ts-expect-error -- plain .mjs module without type declarations
import { compareLearning, learningReport, sameName } from "../../scripts/learning/reference-lib.mjs";

const g = (s: string): GDay => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
const isoOf = (d: GDay) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

/** Ours, in the shape compareLearning asks for. */
const OURS = {
  dafYomi: (iso: string) => {
    const d = dafYomi(g(iso));
    return d ? [d.tractate, d.daf] : null;
  },
  mishnaYomi: (iso: string) => mishnahYomit(g(iso))?.mishnayot.map((p) => [p.tractate, `${p.chapter}:${p.mishnah}`]) ?? null,
  rambam: (iso: string, per: 1 | 3) => {
    const r = dailyRambam(g(iso), per);
    return r ? { units: r.units.map((u) => [u.title.replace(/^Mishneh Torah, /, ""), u.span, u.intro]) } : null;
  },
};

describe("the tables", () => {
  it("2,711 folios of Daf Yomi, 4,192 mishnayot (2,096 days), 1,000 chapters of the Mishneh Torah; the Rambam cycles are 1,017 and 339 days", () => {
    expect(DAF_YOMI_DAYS).toBe(2711);
    expect(MISHNAH_COUNT).toBe(4192);
    expect(MISHNAH_YOMIT_DAYS).toBe(2096);
    expect(RAMBAM_CHAPTERS).toBe(1000);
    // The introduction is 4 parts learned in 3 days each; with "The Order of
    // Prayer" and the Haggadah the schedule has 1,017 units (published lengths).
    expect(RAMBAM_INTRO_UNITS).toBe(12);
    expect(RAMBAM_UNITS).toBe(1017);
    expect(rambamCycleDays(1)).toBe(1017);
    expect(rambamCycleDays(3)).toBe(339);
  });
});

describe("Daf Yomi", () => {
  it("cycle 14 began on 5 January 2020 with Berakhot 2; the day before was Niddah 73 of cycle 13", () => {
    expect(dafYomi(g("2020-01-05"))).toEqual({ cycle: 14, tractate: "Berakhot", he: "ברכות", daf: 2, ref: "Berakhot 2" });
    expect(dafYomi(g("2020-01-04"))).toMatchObject({ cycle: 13, tractate: "Niddah", daf: 73 });
    expect(isoOf(gregorianOf(dafYomiCycleStart(14)))).toBe("2020-01-05");
    // Cycle 15 starts 2,711 days later.
    const c15 = gregorianOf(dafYomiCycleStart(15));
    expect(dafYomi(c15)).toMatchObject({ cycle: 15, tractate: "Berakhot", daf: 2 });
    expect(isoOf(c15)).toBe("2027-06-08");
  });

  it("walks every folio once a cycle, Kinnim, Tamid and Middot after Me'ilah on their own folios", () => {
    const start = dafYomiCycleStart(14);
    const seen = new Set<string>();
    let prev = "";
    const order: string[] = [];
    for (let f = start; f < start + DAF_YOMI_DAYS; f++) {
      const d = dafYomi(gregorianOf(f))!;
      expect(d.cycle).toBe(14);
      seen.add(d.ref);
      if (d.tractate !== prev) order.push(`${d.tractate} ${d.daf}`);
      prev = d.tractate;
    }
    expect(seen.size).toBe(DAF_YOMI_DAYS);
    expect(order.slice(-5)).toEqual(["Meilah 2", "Kinnim 23", "Tamid 26", "Middot 34", "Niddah 2"]);
  });
});

describe("Mishnah Yomit and Rambam", () => {
  it("two mishnayot a day, as Sefaria references, across a chapter or a tractate", () => {
    const m = mishnahYomit(g("2026-11-15"))!;
    expect(m.mishnayot).toHaveLength(2);
    expect(m.refs.every((r) => /^(Mishnah [A-Z][\w ]+|Pirkei Avot) \d+:\d+(-\d+(:\d+)?)?$/.test(r))).toBe(true);
    const B = (chapter: number, mishnah: number, tractate = "Berakhot") => ({ tractate, he: "", chapter, mishnah });
    expect(mishnahRefs([B(1, 1), B(1, 2)])).toEqual(["Mishnah Berakhot 1:1-2"]);
    expect(mishnahRefs([B(1, 5), B(2, 1)])).toEqual(["Mishnah Berakhot 1:5-2:1"]);
    expect(mishnahRefs([B(9, 5), B(1, 1, "Peah")])).toEqual(["Mishnah Berakhot 9:5", "Mishnah Peah 1:1"]);
    // One cycle covers every mishnah once.
    const first = mishnahYomit(g("1947-05-20"))!;
    expect(first.refs).toEqual(["Mishnah Berakhot 1:1-2"]);
    expect(mishnahYomit(g("1947-05-19"))).toBeNull();
  });

  it("one chapter or three a day, the introduction first: 12 days at one chapter, 4 at three", () => {
    expect(dailyRambam(g("1984-04-29"), 1)).toMatchObject({ cycle: 1, refs: ["Mishneh Torah, Transmission of the Oral Law 1-21"] });
    expect(dailyRambam(g("1984-04-29"), 1)?.units[0]).toMatchObject({ intro: true, chapter: 1, span: "1-21" });
    const r3 = dailyRambam(g("1984-04-29"), 3)!;
    expect(r3.units).toHaveLength(3);
    expect(r3.refs).toEqual(["Mishneh Torah, Transmission of the Oral Law 1-45"]);
    // After the 12 introduction days, day 13 of the one-chapter cycle is Foundations of the Torah 1.
    expect(dailyRambam(gregorianOf(fixedOf(g("1984-04-29")) + 12), 1)?.refs).toEqual(["Mishneh Torah, Foundations of the Torah 1"]);
    expect(dailyRambam(gregorianOf(fixedOf(g("1984-04-29")) + 4), 3)?.refs).toEqual(["Mishneh Torah, Foundations of the Torah 1-3"]);
    // 9 July 2020: both cycles ended (the 39th at three a day, the 13th at one).
    expect(dailyRambam(g("2020-07-09"), 1)).toMatchObject({ cycle: 13, refs: ["Mishneh Torah, Kings and Wars 12"] });
    expect(dailyRambam(g("2020-07-09"), 3)).toMatchObject({ cycle: 39, refs: ["Mishneh Torah, Kings and Wars 10-12"] });
    expect(dailyRambam(g("2020-07-10"), 3)).toMatchObject({ cycle: 40, refs: ["Mishneh Torah, Transmission of the Oral Law 1-45"] });
    expect(sefariaUrl("Mishneh Torah, Foundations of the Torah 1")).toBe("https://www.sefaria.org/Mishneh_Torah,_Foundations_of_the_Torah.1");
    expect(sefariaUrl("Mishnah Berakhot 1:1-2")).toBe("https://www.sefaria.org/Mishnah_Berakhot.1.1-2");
  });
});

describe("{{learning}} in the daily note", () => {
  it("one line per followed cycle, with a link to the text on Sefaria", () => {
    const md = renderTemplate("# {{date}}\n{{learning}}\n", g("2020-01-05"), "he", { israel: true });
    expect(md.split("\n")[1]).toBe("- דף יומי: [ברכות ב׳](https://www.sefaria.org/Berakhot.2)");
    expect(md).toMatch(/- משנה יומית: \[.+\]\(https:\/\/www\.sefaria\.org\/Mishnah_/);
    expect(md).toMatch(/- רמב״ם יומי: \[.+\]\(https:\/\/www\.sefaria\.org\/Mishneh_Torah,_/);
    expect(renderTemplate("{{learning}}", g("2020-01-05"), "en", { learning: ["dafYomi"] })).toBe("- Daf Yomi: [Berakhot 2](https://www.sefaria.org/Berakhot.2)");
    expect(learningLines(g("2020-01-05"), [], "he")).toEqual([]);
  });
});

describe("plans: progress, and marked readings as flashcards", () => {
  it("follow, mark days, see what is behind; a marked reading joins the FSRS queue", () => {
    let f = follow(emptyLearningFile(), "dafYomi", g("2026-11-10"));
    expect(follow(f, "dafYomi", g("2026-11-12")).plans[0].started).toBe("2026-11-10");
    f = markDone(f, "dafYomi", g("2026-11-10"));
    f = markDone(f, "dafYomi", g("2026-11-12"));
    expect(progress(f.plans[0], g("2026-11-13"))).toEqual({ due: 4, done: 2, behind: ["2026-11-11", "2026-11-13"] });
    f = markDone(f, "dafYomi", g("2026-11-12"), false);
    expect(f.plans[0].done).toEqual(["2026-11-10"]);
    f = markForReview(f, "dafYomi", g("2026-11-10"));
    const round = parseLearningFile(serializeLearningFile(f));
    expect(round).toEqual(f);
    const cards = reviewCards(round, "he");
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toMatch(/^דף יומי · /);
    expect(cards[0].back).toMatch(/^https:\/\/www\.sefaria\.org\//);
    const review = syncSources(emptyReviewFile(), cards, new Date("2026-11-15T08:00:00Z"));
    expect(Object.keys(review.cards)).toEqual([cards[0].id]);
    expect(parseLearningFile("{not json")).toEqual(emptyLearningFile());
  });
});

describe("the comparison (SYNTHETIC fixture: hand-written in hebcal-learning's output shape, not its data)", () => {
  it("matches names across spellings and reports each difference, Rambam's by whether it falls in the introduction", () => {
    expect(sameName("Berachot", "Berakhot") && sameName("Gitin", "Gittin") && sameName("Midot", "Middot") && sameName("Baba Kamma", "Bava Kamma")).toBe(true);
    expect(sameName("Yoma", "Sukkah")).toBe(false);
    const synthetic = {
      version: 1,
      source: "SYNTHETIC — written by hand for this test",
      dafYomi: [["2020-01-05", "Berachot", 2], ["2020-01-06", "Berachot", 3], ["2020-01-07", "Berachot", 99]],
      mishnaYomi: [["1947-05-20", [["Berakhot", "1:1"], ["Berakhot", "1:2"]]]],
      rambam1: [["1984-04-29", "Transmission of the Oral Law", "1-21"], ["1984-05-16", "Foundations of the Torah", 2]],
    };
    const cmp = compareLearning(synthetic, OURS);
    expect(cmp.dafYomi).toMatchObject({ days: 3, diffs: [{ iso: "2020-01-07", theirs: ["Berachot", 99], ours: ["Berakhot", 4] }] });
    expect(cmp.mishnaYomi).toEqual({ days: 1, diffs: [] });
    expect(cmp.rambam1.days).toBe(2);
    expect(cmp.rambam1.diffs.map((d: { iso: string }) => d.iso)).toEqual(["1984-05-16"]);
    expect(cmp.rambam1.outsideIntro).toBe(1);
    expect(learningReport(cmp)).toMatch(/dafYomi: 3 days, 1 differences/);
  });
});

describe("the daily Rambam against the published schedule (hebcal-learning's test data, BSD-2-Clause)", () => {
  const pub = JSON.parse(readFileSync(join(__dirname, "fixtures/hebcal-learning/rambam-published.json"), "utf8"));
  it("one chapter a day: a full cycle (1,017 days from 23 April 2023), 1984's first days and spot dates, 0 differences", () => {
    expect(pub.rambam1.length).toBeGreaterThanOrEqual(1017 + 18);
    const cmp = compareLearning({ rambam1: pub.rambam1 }, OURS);
    // hygiene-allow: the gap report, for the PR's verification table
    if (cmp.rambam1.diffs.length) console.log(learningReport(cmp));
    expect(cmp.rambam1.days).toBe(pub.rambam1.length);
    expect(cmp.rambam1.diffs).toEqual([]);
  });
  it("three chapters a day: 1984's first 22 days and 41 days of 2020 (The Order of Prayer in 5, Haggadah with chapter 8), 0 differences", () => {
    const diffs: string[] = [];
    for (const [iso, desc] of Object.entries(pub.rambam3desc as Record<string, string>)) {
      const ours = dailyRambam(g(iso), 3)!.refs.map((r) => r.replace(/^Mishneh Torah, /, "")).join(", ");
      if (ours !== desc) diffs.push(`${iso}: theirs ${desc} ours ${ours}`);
    }
    expect(Object.keys(pub.rambam3desc)).toHaveLength(63);
    expect(diffs).toEqual([]);
  });
});

const FIXTURE = join(__dirname, "fixtures/hebcal-learning/2020-2030.json");
describe("against hebcal-learning's output, 2020–2030 (fixture built outside the app)", () => {
  it.skipIf(!existsSync(FIXTURE))("0 differences in Daf Yomi, Mishnah Yomit and both Rambam cycles", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const cmp = compareLearning(fixture, OURS);
    // hygiene-allow: the gap report, for the PR's verification table
    console.log(learningReport(cmp));
    expect(cmp.dafYomi.days).toBeGreaterThan(4000);
    expect(cmp.dafYomi.diffs).toEqual([]);
    expect(cmp.mishnaYomi.diffs).toEqual([]);
    expect(cmp.rambam1.diffs).toEqual([]);
    expect(cmp.rambam3.diffs).toEqual([]);
  });
});

describe("licences: nothing GPL in the app", () => {
  it("no @hebcal package in the dependencies or the lockfile, and no import of one in src/", () => {
    const root = join(__dirname, "../..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(deps.filter((d) => d.startsWith("@hebcal/"))).toEqual([]);
    expect(readFileSync(join(root, "package-lock.json"), "utf8")).not.toMatch(/node_modules\/@hebcal\//);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(n) && /from ["']@hebcal\/|import\(["']@hebcal\//.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(join(root, "src"));
    expect(hits).toEqual([]);
  });
});
