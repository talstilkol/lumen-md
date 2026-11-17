/**
 * Plan W13.W14 — writing goals per note: `goal.words / minutes /
 * readability / tone` in the frontmatter, the counter equal to the W5.8
 * count, the readability and tone targets, a local daily log and weekly
 * report — and no network request on the way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countWords } from "../book/wordCount";
import { goalProgress, parseGoal, recordProgress, removeGoal, weeklyReport, type GoalLog } from "../agents/writing/goals/goals";
import { GOAL_LOG_KEY, loadGoalLog, saveGoalLog } from "../ui/writingGoalLog";
import { fleschKincaid, readabilityOf, setReadabilityEngine, syllables, toneOf } from "../agents/writing/goals/readability";
import { goalValue } from "../ui/GoalsDialog";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOTE = `---
title: פרק 3
goal:
  words: 1500
  minutes: 45
  readability: בינוני
  tone: formal
---

# פרק שלישי

הבית הישן עמד בקצה הרחוב. **צה״ל** הגיע ב־1948 עם ה-CNN, \`code here\` ו[[קישור|טקסט הקישור]].

\`\`\`
const notCounted = 1;
\`\`\`
`;

describe("W13.W14 goals in the frontmatter", () => {
  it("parses nested, flat, inline and shorthand forms, Hebrew values too", () => {
    expect(parseGoal(NOTE)).toEqual({ words: 1500, minutes: 45, readability: "medium", tone: "formal" });
    expect(parseGoal("---\ngoal.words: 800\ngoal.tone: יומיומי\n---\nx")).toEqual({ words: 800, tone: "casual" });
    expect(parseGoal("---\ngoal: { words: 2000, readability: easy }\n---\n")).toEqual({ words: 2000, readability: "easy" });
    expect(parseGoal("---\ngoal: 500\n---\n")).toEqual({ words: 500 });
    expect(parseGoal("no frontmatter")).toBeNull();
    expect(parseGoal("---\ngoal: { words: -3, tone: loud }\n---\n")).toBeNull();
  });

  it("the counter is exactly the W5.8 count", () => {
    const p = goalProgress(NOTE, parseGoal(NOTE)!);
    expect(p.words).toBe(countWords(NOTE));
    // Not a naive split: frontmatter, code and the link target are out; ה-CNN and צה״ל are one word each.
    expect(p.words).toBe(14);
    expect(p.wordsRatio).toBeCloseTo(14 / 1500);
  });

  it("writes and removes the goal in the frontmatter", () => {
    expect(goalValue({ words: 1000, tone: "formal" })).toBe("{ words: 1000, tone: formal }");
    expect(goalValue({})).toBeNull();
    const without = removeGoal(NOTE);
    expect(parseGoal(without)).toBeNull();
    expect(without).toContain("title: פרק 3");
    expect(without).toContain("# פרק שלישי");
  });
});

describe("W13.W14 readability and tone targets", () => {
  const easyEn = "The cat sat on the mat. It was a sunny day. The dog ran to the park. They had fun. We ate cake. The sun was hot. Kids played ball.";
  const hardEn = "Notwithstanding considerable methodological heterogeneity, the investigators characterised the multidimensional interrelationships between socioeconomic stratification and intergenerational educational attainment, concluding that institutional configurations substantially determine longitudinal outcomes across heterogeneous populations.";
  it("English: Flesch–Kincaid grade, easy vs hard", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("readability")).toBeGreaterThanOrEqual(4);
    expect(fleschKincaid(easyEn)).toBeLessThan(3);
    expect(readabilityOf(easyEn)?.level).toBe("easy");
    expect(readabilityOf(hardEn.repeat(2))?.level).toBe("hard");
  });

  it("Hebrew: provisional estimate when no index is plugged in", () => {
    // The goal UI plugs in W13.W9's index (INT7: ./goals/hebrewIndex); this is the stand-in without it.
    setReadabilityEngine(null);
    const easyHe = "הילד רץ לגן. הוא ראה כלב. הכלב היה גדול. הילד צחק. אמא באה. הם הלכו הביתה. היה טוב. השמש זרחה. הם אכלו. הם שתו. ";
    const hardHe = "ההתפתחויות הטכנולוגיות המואצות בתחומי התקשורת והמחשוב השפיעו השפעה מכרעת על התמורות החברתיות והכלכליות שהתרחשו במדינות המתועשות במהלך העשורים האחרונים, ובכללן הגירה פנימית מתמשכת. ";
    const e = readabilityOf(easyHe.repeat(2))!;
    const h = readabilityOf(hardHe.repeat(2))!;
    expect(e.provisional).toBe(true);
    expect(e.score).toBeLessThan(h.score);
    expect(e.level).toBe("easy");
    expect(h.level).toBe("hard");
    setReadabilityEngine(() => ({ level: "medium", score: 8, provisional: false }));
    try {
      expect(readabilityOf(easyHe.repeat(2))).toEqual({ level: "medium", score: 8, provisional: false });
    } finally {
      setReadabilityEngine(null);
    }
  });

  it("the targets are met or not", () => {
    const formal = "לפיכך יש לבחון את הנתונים בקפידה. אולם, כמו כן נדרש לבדוק את המקורות. על פי הממצאים, יש לשקול את ההשלכות. ".repeat(3);
    const casual = "יאללה אחלה, סבבה לגמרי!! תכלס זה עבד. כאילו וואלה, אחי, איזה כיף 😀 ".repeat(4);
    expect(toneOf(formal)?.tone).toBe("formal");
    expect(toneOf(casual)?.tone).toBe("casual");
    const p = goalProgress(casual, { tone: "formal", readability: "easy" });
    expect(p.toneMet).toBe(false);
    expect(goalProgress(formal, { tone: "formal" }).toneMet).toBe(true);
    // Too short to judge: unknown, not failed.
    expect(goalProgress("קצר.", { tone: "formal" }).toneMet).toBeNull();
  });
});

describe("W13.W14 the local log and weekly report", () => {
  const d = (day: number, h = 10, m = 0, s = 0) => new Date(2026, 10, day, h, m, s);

  it("words written per day are growth, time is active time (idle gaps don't count)", () => {
    let log: GoalLog = {};
    log = recordProgress(log, "a.md", 100, d(16, 10, 0, 0), 500);
    log = recordProgress(log, "a.md", 130, d(16, 10, 0, 30), 500); // +30 s
    log = recordProgress(log, "a.md", 160, d(16, 10, 1, 0), 500); // +30 s
    log = recordProgress(log, "a.md", 200, d(16, 12, 0, 0), 500); // an idle gap
    log = recordProgress(log, "b.md", 40, d(17), undefined);
    log = recordProgress(log, "b.md", 20, d(17, 10, 0, 20)); // deleting doesn't go below 0 for the day
    log = recordProgress(log, "a.md", 200, d(17), 500);
    log = recordProgress(log, "a.md", 520, d(17, 10, 0, 40), 500);
    const r = weeklyReport(log, d(17));
    expect(r.days.map((x) => x.words)).toEqual([0, 0, 0, 0, 0, 100, 320]);
    expect(r.days[5].minutes).toBe(1);
    expect(r.totalWords).toBe(420);
    expect(r.streak).toBe(2);
    expect(r.notes.find((x) => x.note === "a.md")).toMatchObject({ words: 420, reached: true });
    expect(r.notes.find((x) => x.note === "b.md")).toMatchObject({ words: 0, reached: false });
  });

  it("old days are pruned; storage failures are harmless", () => {
    let log: GoalLog = {};
    log = recordProgress(log, "a.md", 1, new Date(2026, 0, 1));
    log = recordProgress(log, "a.md", 2, new Date(2026, 10, 17));
    expect(Object.keys(log)).toEqual(["2026-11-17"]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveGoalLog(log)).not.toThrow();
    spy.mockRestore();
    localStorage.setItem(GOAL_LOG_KEY, "{not json");
    expect(loadGoalLog()).toEqual({});
  });
});

describe("W13.W14 stays on this device", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network")));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("0 network requests through parse, progress, log and report", () => {
    const g = parseGoal(NOTE)!;
    goalProgress(NOTE, g);
    saveGoalLog(recordProgress(loadGoalLog(), "n.md", 10, new Date()));
    weeklyReport(loadGoalLog(), new Date());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no network API in the goal modules or their UI", () => {
    for (const f of ["agents/writing/goals/goals.ts", "agents/writing/goals/readability.ts", "ui/NoteGoalStatus.tsx", "ui/GoalsDialog.tsx", "ui/writingGoalLog.ts"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
    }
  });
});

describe("W13.W14 reads Hebrew readability from W13.W9 (INT7)", () => {
  it("the goal UI plugs in W9's index: a Hebrew note's level is W9's band, not provisional", async () => {
    const he = "הילד הלך לבית הספר בבוקר. הוא פגש את חבריו בכיתה. המורה סיפרה להם סיפור על ים גדול. כולם הקשיבו בשקט. אחר כך יצאו לחצר לשחק. השמש זרחה והיה נעים מאוד בחוץ.";
    setReadabilityEngine(null);
    expect(readabilityOf(he)?.provisional).toBe(true);
    const { hebrewIndexEngine } = await import("../agents/writing/goals/hebrewIndex");
    setReadabilityEngine(hebrewIndexEngine);
    const { readability } = await import("../agents/writing/readability/readability");
    const r = readabilityOf(he)!;
    expect(r).toEqual({ level: readability(he).band, score: readability(he).score, provisional: false });
    for (const f of ["ui/NoteGoalStatus.tsx", "ui/GoalsDialog.tsx"]) expect(readFileSync(join(__dirname, "..", f), "utf8"), f).toMatch(/import "\.\.\/agents\/writing\/goals\/hebrewIndex";/);
    setReadabilityEngine(null);
  });
});
