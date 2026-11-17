/**
 * Plan W11.P15: retention loops built on this device. "On this day" and the
 * weekly summary in today's daily note, each behind its own flag that the
 * user can turn off, and "Keep the classic look", one switch for every design
 * change that ships behind a flag. The notes are SYNTHETIC (made up here).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DEFAULT_DAILY } from "../daily/defaults";
import { dailyPath } from "../daily/dailyNote";
import { OTD_END, OTD_START, WEEK_START, excerpt, isWeekStart, onThisDay, renderOnThisDay, renderWeek, upsertBlock, weekData, type RetentionNote } from "../retention/core";
import { ON_THIS_DAY, WEEKLY, applyRetention, retentionWords } from "../retention/retention";
import { FLAGS, classicLook, flagState, isEnabled, setClassicLook, setFlag, stateOf, type FlagDef } from "../flags/flags";
import { FeatureFlagsPanel } from "../ui/FeatureFlagsPanel";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { refreshRetentionFile } from "../retention/retention";
import { __resetWorkspaceIndex } from "../storage/workspaceIndex";

const S = DEFAULT_DAILY;
const path = (y: number, m: number, d: number) => dailyPath({ y, m, d }, S);
const at = (iso: string) => new Date(iso).getTime();
const note = (p: string, content: string, modified = at("2026-01-01T09:00:00")): RetentionNote => ({ path: p, content, modified });

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

describe("On this day", () => {
  const notes = [
    note(path(2025, 11, 15), "---\ntags: [daily]\n---\n# 15.11.2025\n\nפגישה עם נועה על הפרויקט"),
    note(path(2023, 11, 15), "- [ ] להתקשר לסבתא"),
    note(path(2015, 11, 15), "eleven years ago"), // more than 10 years back
    note(path(2026, 11, 15), "today"), // this year
    note(path(2025, 11, 14), "the day before"),
    note("ideas/מכונת זמן.md", "---\ncreated: 2024-11-15\n---\nרעיון: מכונת זמן קטנה"),
    note("ideas/later.md", "---\ncreated: 2024-11-16\n---\nnot this day"),
  ];

  it("finds that day's daily notes and notes created that day, newest first, up to 10 years back", () => {
    const got = onThisDay(notes, { y: 2026, m: 11, d: 15 }, (d) => dailyPath(d, S));
    expect(got.map((e) => [e.year, e.path, e.why])).toEqual([
      [2025, "journal/2025-11-15.md", "daily"],
      [2024, "ideas/מכונת זמן.md", "created"],
      [2023, "journal/2023-11-15.md", "daily"],
    ]);
    expect(got[0].excerpt).toBe("15.11.2025");
    expect(got[2].excerpt).toBe("להתקשר לסבתא");
  });

  it("29 February shows on the 28th in other years, and the 28th also brings a leap year's 29th", () => {
    const leap = [note(path(2024, 2, 29), "leap day"), note(path(2023, 2, 28), "plain 28th")];
    expect(onThisDay(leap, { y: 2026, m: 2, d: 28 }, (d) => dailyPath(d, S)).map((e) => e.path)).toEqual(["journal/2024-02-29.md", "journal/2023-02-28.md"]);
    expect(onThisDay([note(path(2027, 2, 28), "x")], { y: 2028, m: 2, d: 29 }, (d) => dailyPath(d, S)).map((e) => e.path)).toEqual(["journal/2027-02-28.md"]);
  });

  it("renders links and nothing at all when there is nothing", () => {
    const block = renderOnThisDay(onThisDay(notes, { y: 2026, m: 11, d: 15 }, (d) => dailyPath(d, S)), retentionWords())!;
    expect(block.startsWith(OTD_START) && block.endsWith(OTD_END)).toBe(true);
    expect(block).toContain("- **2025** [[journal/2025-11-15]] — 15.11.2025");
    expect(block).toContain("- **2024** [[ideas/מכונת זמן]] — רעיון: מכונת זמן קטנה (created that day)");
    expect(block).toContain("Turn it off in Feature flags.");
    expect(renderOnThisDay([], retentionWords())).toBeNull();
    expect(excerpt("---\na: 1\n---\n\n## כותרת\n")).toBe("כותרת");
  });
});

describe("the weekly summary", () => {
  // The week before Sunday 15.11.2026: from Sunday 8.11 to Saturday 14.11.
  const end = new Date(2026, 10, 15);
  const notes = [
    note("projects/גשר.md", "#עבודה תכנון ה#גשר\n- [x] לשלוח הצעה ✅ 2026-11-10\n- [x] old ✅ 2026-11-01\n```\n- [x] in code ✅ 2026-11-10\n```", at("2026-11-12T10:00:00")),
    note("notes/reading.md", "Reading #books and #עבודה", at("2026-11-09T08:00:00")),
    note("notes/old.md", "#old", at("2026-11-02T08:00:00")),
    note(".lumen/state.md", "#hidden", at("2026-11-12T08:00:00")),
    note("journal/2026-11-11.md", "- [x] daily task ✅ 2026-11-11 #journal", at("2026-11-11T08:00:00")),
  ];
  const skip = (p: string) => p.startsWith(".lumen/") || p.startsWith("journal/");

  it("what was edited, the tasks done in the week, the tags most used, the words", () => {
    const d = weekData(notes, end, skip);
    expect([d.from, d.to]).toEqual(["2026-11-08", "2026-11-14"]);
    expect(d.edited.map((e) => e.path)).toEqual(["projects/גשר.md", "notes/reading.md"]);
    expect(d.done).toEqual([{ path: "projects/גשר.md", text: "לשלוח הצעה", date: "2026-11-10" }]);
    expect(d.tags).toEqual([
      { tag: "עבודה", count: 2 },
      { tag: "books", count: 1 },
    ]);
    expect(d.words).toBeGreaterThanOrEqual(10);
  });

  it("renders the week; a week with nothing edited says so", () => {
    const block = renderWeek(weekData(notes, end, skip), retentionWords());
    expect(block).toContain("### The week 2026-11-08 – 2026-11-14");
    expect(block).toContain("**2 notes edited**");
    expect(block).toContain("- ✅ לשלוח הצעה — [[projects/גשר]]");
    expect(block).toContain("Tags: #עבודה (2), #books (1)");
    expect(renderWeek(weekData([], end), retentionWords())).toContain("No notes were edited this week.");
  });

  it("the week starts on Sunday in Israel and on Monday elsewhere", () => {
    expect(isWeekStart(new Date(2026, 10, 15), true)).toBe(true); // Sunday
    expect(isWeekStart(new Date(2026, 10, 15), false)).toBe(false);
    expect(isWeekStart(new Date(2026, 10, 16), false)).toBe(true); // Monday
  });
});

describe("in today's daily note, each loop behind its flag", () => {
  const sunday = { y: 2026, m: 11, d: 15 };
  const israel = { ...S, israel: true };
  const vault = [note(path(2025, 11, 15), "a year ago"), note("projects/x.md", "#work stuff", at("2026-11-10T10:00:00"))];
  const today = "# 15.11.2026\n\nמה שכתבתי היום.\n";

  it("both on, on the week's first day: both blocks, after the first paragraph; the text is kept", () => {
    const out = applyRetention(today, sunday, israel, "he", vault, { onThisDay: true, weekly: true });
    expect(out.startsWith("# 15.11.2026\n\n" + OTD_START)).toBe(true);
    expect(out).toContain(WEEK_START);
    expect(out).toContain("מה שכתבתי היום.");
    // Running it again changes nothing.
    expect(applyRetention(out, sunday, israel, "he", vault, { onThisDay: true, weekly: true })).toBe(out);
  });

  it("turned off: the block goes away the next time, the rest of the note stays byte for byte", () => {
    const on = applyRetention(today, sunday, israel, "he", vault, { onThisDay: true, weekly: true });
    const off = applyRetention(on, sunday, israel, "he", vault, { onThisDay: false, weekly: false });
    expect(off).toBe(today);
  });

  it("the weekly summary only on the week's first day; another day leaves an earlier block as it is", () => {
    const monday = { y: 2026, m: 11, d: 16 };
    expect(applyRetention(today, monday, israel, "he", vault, { onThisDay: false, weekly: true })).toBe(today);
    const withWeek = upsertBlock(today, WEEK_START, "<!-- lumen:weekly:end -->", `${WEEK_START}\nkept\n<!-- lumen:weekly:end -->`);
    expect(applyRetention(withWeek, monday, israel, "he", vault, { onThisDay: false, weekly: true })).toBe(withWeek);
  });

  it("the flags are real registry entries, beta (on in beta builds), off in stable, and the user's choice wins", () => {
    for (const id of [ON_THIS_DAY, WEEKLY]) {
      expect(FLAGS.find((f) => f.id === id)?.stage).toBe("beta");
      expect(isEnabled(id, { channel: "beta", overrides: {} })).toBe(true);
      expect(isEnabled(id, { channel: "stable", overrides: {} })).toBe(false);
      expect(isEnabled(id, { channel: "beta", overrides: { [id]: false } })).toBe(false);
    }
    setFlag(ON_THIS_DAY, false);
    expect(flagState(ON_THIS_DAY, { channel: "beta" })?.source).toBe("override");
  });

  it("on the real vault: the blocks are written into the note file from the vault index", async () => {
    installFakeOpfs();
    __resetWorkspaceIndex();
    await writeWorkspaceFile(path(2025, 11, 15), "# 2025\n\nשנה שעברה ביום הזה");
    await writeWorkspaceFile(path(2026, 11, 15), today);
    setFlag(ON_THIS_DAY, true);
    setFlag(WEEKLY, false);
    await refreshRetentionFile(sunday, israel, "he");
    const out = await readWorkspaceFile(path(2026, 11, 15));
    expect(out).toContain("- **2025** [[journal/2025-11-15]] — 2025");
    expect(out).not.toContain(WEEK_START);
    setFlag(ON_THIS_DAY, false);
    await refreshRetentionFile(sunday, israel, "he");
    expect(await readWorkspaceFile(path(2026, 11, 15))).toBe(today);
  });

  it("the daily note runs them when today's note opens (and not over a tab with edits)", () => {
    const src = readFileSync("src/daily/dailyNote.ts", "utf8");
    expect(src).toMatch(/isoOf\(day\) === isoOf\(dayOf\(new Date\(\)\)\) && open\.doc\.workspaceName !== path && !open\.openTabs\.some\(\(x\) => x\.workspaceName === path\)\) \{\s*await import\("\.\.\/retention\/retention"\)/);
  });
});

describe("Keep the classic look", () => {
  const design: FlagDef = { id: "look.newSidebar", stage: "stable", since: { beta: "0.2.0-beta.1", stable: "0.3.0" }, design: true };
  const feature: FlagDef = { id: "feature.x", stage: "stable", since: { beta: "0.2.0-beta.1", stable: "0.3.0" } };

  it("turns every design flag off, whatever the channel or the user's own switch; features stay", () => {
    expect(stateOf(design, "stable", {}, false).enabled).toBe(true);
    expect(stateOf(design, "stable", {}, true)).toMatchObject({ enabled: false, source: "classic" });
    expect(stateOf(design, "beta", { "look.newSidebar": true }, true).enabled).toBe(false);
    expect(stateOf(feature, "stable", {}, true)).toMatchObject({ enabled: true, source: "channel" });
  });

  it("is one switch in Feature flags, kept on this device", () => {
    render(<FeatureFlagsPanel onClose={() => undefined} />);
    const box = screen.getByTestId("flags-classic").querySelector("input")!;
    expect(box.checked).toBe(false);
    act(() => void fireEvent.click(box));
    expect(classicLook()).toBe(true);
    expect(localStorage.getItem("lumen-classic-look")).toBe("1");
    setClassicLook(false);
    expect(classicLook()).toBe(false);
    // The loops are listed there too, each with its own switch.
    for (const id of [ON_THIS_DAY, WEEKLY]) expect(document.querySelector(`[data-flag="${id}"] [role="switch"]`)).toBeTruthy();
  });

  it("flags:check accepts the registry, with English and Hebrew for every flag", () => {
    const r = spawnSync(process.execPath, ["scripts/check-flags.mjs"], { encoding: "utf8" });
    expect([r.status, r.stdout.trim()]).toEqual([0, `✓ feature flags: ${FLAGS.length} flag(s), every one through beta before stable`]);
  });
});
