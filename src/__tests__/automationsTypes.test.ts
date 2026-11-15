/**
 * W12.U2: automations on typed objects (a note of a type is created, a field
 * of a type changes) and the "not on Shabbat or a holiday" condition, on the
 * existing engine: the same dry run, log, undo and loop guard. The notes are
 * synthetic; the dates are real calendar dates, checked by the app's Hebrew
 * calendar (Shabbat 14 Nov 2026, Rosh Hashana 5787 on 12–13 Sep 2026,
 * Pesach 5786 from 2 Apr 2026).
 */
import { describe, expect, it } from "vitest";
import { applyPlan, fires, frontmatterTypes, plan, undoRun, type Fs, type Rule, type VaultEvent } from "../automations/engine";
import { nextWorkday, restDayOf } from "../automations/restDays";

const dailyPath = (d: string) => `Daily/${d}.md`;
const rule = (id: string, when: Rule["when"], then: Rule["then"], extra: Partial<Rule> = {}): Rule => ({ id, name: id, enabled: true, when, then, ...extra });

function memFs(files: Record<string, string>): Fs & { files: Map<string, string> } {
  const m = new Map(Object.entries(files));
  return {
    files: m,
    read: async (p) => m.get(p) ?? null,
    write: async (p, t) => void m.set(p, t),
    move: async (a, b) => {
      m.set(b, m.get(a)!);
      m.delete(a);
    },
    remove: async (p) => void m.delete(p),
  };
}
const ctxOf = (fs: { files: Map<string, string> }, today: string, extra = {}) => ({ vault: { read: (p: string) => fs.files.get(p) ?? null, exists: (p: string) => fs.files.has(p) }, dailyPath, today, ...extra });

const PERSON = "---\ntype: person\nname: דנה כהן\nrole: חוקרת\n---\n# דנה כהן\n";
const WEEKDAY = "2026-11-12"; // Thursday
const SHABBAT = "2026-11-14";

describe("type triggers", () => {
  it("frontmatter types: one value or a list, lower case", () => {
    expect(frontmatterTypes(PERSON)).toEqual(["person"]);
    expect(frontmatterTypes("---\ntype: [Person, Author]\n---\n")).toEqual(["person", "author"]);
    expect(frontmatterTypes("no frontmatter")).toEqual([]);
  });

  it("an object of a type is created: a new note with the type, or a note given it later", () => {
    const r = rule("r", { kind: "typeCreated", type: "Person" }, []);
    const c = { today: WEEKDAY };
    expect(fires(r, { kind: "created", path: "People/dana.md", text: PERSON }, c)).toBe(true);
    expect(fires(r, { kind: "created", path: "a.md", text: "# a\n" }, c)).toBe(false);
    expect(fires(r, { kind: "changed", path: "a.md", before: "# a\n", after: "---\ntype: person\n---\n# a\n" }, c)).toBe(true);
    // Already a person: an edit is not a creation; a move by a rule is not either.
    expect(fires(r, { kind: "changed", path: "p.md", before: PERSON, after: PERSON + "עוד\n" }, c)).toBe(false);
    expect(fires(r, { kind: "created", path: "p.md", text: PERSON, moved: true }, c)).toBe(false);
  });

  it("a field of a type changes (a field, to a value, or any field)", () => {
    const after = PERSON.replace("חוקרת", "מנהלת");
    const ev: VaultEvent = { kind: "changed", path: "p.md", before: PERSON, after };
    const c = { today: WEEKDAY };
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "person", field: "role" }, []), ev, c)).toBe(true);
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "person", field: "role", value: "מנהלת" }, []), ev, c)).toBe(true);
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "person", field: "role", value: "סטודנטית" }, []), ev, c)).toBe(false);
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "person", field: "name" }, []), ev, c)).toBe(false);
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "person" }, []), ev, c)).toBe(true);
    expect(fires(rule("r", { kind: "typeFieldChanged", type: "project" }, []), ev, c)).toBe(false);
  });

  it("the type resolver can be W12.T1's registry (activating tags, labels)", () => {
    const typesOf = (text: string) => (/#איש-קשר/.test(text) ? ["person"] : []);
    const r = rule("r", { kind: "typeCreated", type: "person" }, []);
    expect(fires(r, { kind: "created", path: "x.md", text: "שיחה #איש-קשר\n" }, { today: WEEKDAY, typesOf })).toBe(true);
  });

  it("a run on a new person is planned, applied, logged and undone byte for byte", async () => {
    const fs = memFs({ "People/dana.md": PERSON });
    const rules = [rule("people", { kind: "typeCreated", type: "person" }, [{ kind: "tag", tag: "contact" }, { kind: "appendDaily", text: "- איש קשר חדש: {{link}}" }])];
    const p = plan(rules, { kind: "created", path: "People/dana.md", text: PERSON }, ctxOf(fs, WEEKDAY));
    expect(p.changes.map((c) => (c.kind === "write" ? c.path : c.kind))).toEqual(["People/dana.md", "Daily/2026-11-12.md"]);
    expect(fs.files.get("People/dana.md")).toBe(PERSON); // the dry run wrote nothing
    const entry = await applyPlan(p, fs, "1", "created People/dana.md", new Date("2026-11-12T10:00:00Z"));
    expect(fs.files.get("People/dana.md")).toContain("contact");
    expect(fs.files.get("Daily/2026-11-12.md")).toBe("- איש קשר חדש: [[dana]]\n");
    expect(await undoRun(entry, fs)).toEqual({ ok: true });
    expect(fs.files.get("People/dana.md")).toBe(PERSON);
    expect(fs.files.has("Daily/2026-11-12.md")).toBe(false);
  });

  it("the loop guard still stops type rules that trigger each other", () => {
    const fs = memFs({ "p.md": "# p\n" });
    // A note given the type gets a tag; a tag added gives it a field of the type; the field change tags again…
    const rules = [
      rule("a", { kind: "typeCreated", type: "person" }, [{ kind: "tag", tag: "x" }]),
      rule("b", { kind: "typeFieldChanged", type: "person" }, [{ kind: "tag", tag: "y" }]),
    ];
    const after = "---\ntype: person\n---\n# p\n";
    const p = plan(rules, { kind: "changed", path: "p.md", before: "# p\n", after }, ctxOf({ files: new Map([["p.md", after]]) }, WEEKDAY));
    expect(p.fired.length).toBeLessThanOrEqual(4);
    expect(p.stopped.length).toBeGreaterThan(0);
    void fs;
  });
});

describe("Shabbat and yom tov", () => {
  it("the calendar: Shabbat, two days of Rosh Hashana, and the diaspora's second day of Pesach", () => {
    expect(restDayOf("2026-11-14")).toEqual({ reason: "shabbat" });
    expect(restDayOf("2026-11-13")).toBeNull(); // Friday is not Shabbat
    expect(restDayOf("2026-09-12")?.reason).toBe("yomTov");
    expect(restDayOf("2026-09-13")?.reason).toBe("yomTov");
    expect(restDayOf("2026-04-02")?.reason).toBe("yomTov");
    expect(restDayOf("2026-04-03", true)).toBeNull(); // Chol HaMoed in Israel
    expect(restDayOf("2026-04-03", false)?.reason).toBe("yomTov"); // the second day outside Israel
    expect(nextWorkday("2026-11-14")).toBe("2026-11-15");
    expect(nextWorkday("2026-09-12")).toBe("2026-09-14"); // Rosh Hashana on Shabbat and Sunday
  });

  it("dry run on Shabbat: an event rule waits, nothing is written, and the wait is listed", () => {
    const fs = memFs({ "People/dana.md": PERSON });
    const rules = [rule("people", { kind: "typeCreated", type: "person" }, [{ kind: "tag", tag: "contact" }], { notOnRestDays: true })];
    const ev: VaultEvent = { kind: "created", path: "People/dana.md", text: PERSON };
    const p = plan(rules, ev, ctxOf(fs, SHABBAT));
    expect(p.changes).toEqual([]);
    expect(p.postponed).toEqual([{ rule: "people", on: "People/dana.md", why: { reason: "shabbat" }, until: "2026-11-15", event: ev }]);
    // On Sunday the same event runs.
    const sunday = plan(rules, ev, ctxOf(fs, "2026-11-15"));
    expect(sunday.postponed).toEqual([]);
    expect(sunday.changes).toHaveLength(1);
  });

  it("a daily rule that falls on Shabbat does not run, and runs on the next weekday", () => {
    const fs = memFs({});
    const r = rule("d", { kind: "daily" }, [{ kind: "appendDaily", text: "- סקירה שבועית" }], { notOnRestDays: true });
    const sat = plan([r], { kind: "daily", date: SHABBAT }, ctxOf(fs, SHABBAT));
    expect(sat.changes).toEqual([]);
    expect(sat.dailyRan).toEqual({});
    expect(sat.postponed).toEqual([{ rule: "d", on: `daily:${SHABBAT}`, why: { reason: "shabbat" }, until: "2026-11-15", event: undefined }]);
    const sun = plan([r], { kind: "daily", date: "2026-11-15" }, ctxOf(fs, "2026-11-15", { lastDaily: {} }));
    expect(sun.dailyRan).toEqual({ d: "2026-11-15" });
    expect(sun.changes).toHaveLength(1);
  });

  it("on yom tov the wait names the holiday; a rule without the condition still runs", () => {
    const fs = memFs({ "a.md": "x" });
    const ev: VaultEvent = { kind: "created", path: "a.md", text: "x" };
    const waits = rule("w", { kind: "created" }, [{ kind: "tag", tag: "t" }], { notOnRestDays: true });
    const runs = rule("r", { kind: "created" }, [{ kind: "appendDaily", text: "- {{title}}" }]);
    const p = plan([waits, runs], ev, ctxOf(fs, "2026-09-13"));
    expect(p.postponed).toHaveLength(1);
    expect(p.postponed[0]).toMatchObject({ rule: "w", why: { reason: "yomTov" }, until: "2026-09-14" });
    expect(p.fired.map((f) => f.rule)).toEqual(["r"]);
  });
});
