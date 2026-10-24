/** Plan 4.13 — tasks across the vault: obsidian-tasks syntax and queries. */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDetails, parseTaskLine, serializeTask, tasksInNote, toggleTask, type Task } from "../tasks/taskParser";
import { parseDate, parseQuery, runQuery } from "../tasks/taskQuery";

const today = new Date(2026, 9, 24);

describe("task line syntax (obsidian-tasks DefaultTaskSerializer)", () => {
  it("reads every field, in any order, from the end", () => {
    const t = parseTaskLine("- [ ] Pay rent #home ⏫ 🔁 every month 🛫 2026-10-01 ⏳ 2026-10-20 📅 2026-10-25 ➕ 2026-09-30 🆔 rent1 ⛔ a1, b2 ^blk-1", "a.md", 4)!;
    expect(t).toMatchObject({ status: "TODO", description: "Pay rent #home", priority: "high", recurrence: "every month", start: "2026-10-01", scheduled: "2026-10-20", due: "2026-10-25", created: "2026-09-30", id: "rent1", dependsOn: ["a1", "b2"], tags: ["#home"], blockLink: "^blk-1", line: 4 });
  });

  it("keeps tags mixed with fields in the description (upstream trailing-tags rule)", () => {
    expect(parseDetails("Do something #tag1 📅 2026-10-25 #tag2").description).toBe("Do something #tag1 #tag2");
  });

  it("accepts the alternative emojis and Variation Selector 16", () => {
    expect(parseDetails("⌛ 2021-06-20").scheduled).toBe("2021-06-20");
    expect(parseDetails("📆 2021-06-20").due).toBe("2021-06-20");
    expect(parseDetails("🗓 2021-06-20").due).toBe("2021-06-20");
    expect(parseDetails("⏳️ 2024-11-18").scheduled).toBe("2024-11-18");
  });

  it("statuses, list markers, indentation and quotes", () => {
    expect(parseTaskLine("* [x] done ✅ 2026-10-01")!.status).toBe("DONE");
    expect(parseTaskLine("1. [/] half")!.status).toBe("IN_PROGRESS");
    expect(parseTaskLine("  + [-] dropped ❌ 2026-10-02")!.status).toBe("CANCELLED");
    expect(parseTaskLine("> - [ ] in a callout")!.description).toBe("in a callout");
    expect(parseTaskLine("- [] not a task")).toBeNull();
    expect(parseTaskLine("plain [ ] text")).toBeNull();
  });

  it("Hebrew descriptions and tags", () => {
    const t = parseTaskLine("- [ ] לשלם ארנונה #בית 🔼 📅 2026-11-01")!;
    expect(t.description).toBe("לשלם ארנונה #בית");
    expect(t.tags).toEqual(["#בית"]);
    expect(t.priority).toBe("medium");
  });

  it("skips frontmatter and code blocks, tracks headings", () => {
    const note = "---\ntitle: x\n- [ ] not in frontmatter\n---\n# Week\n- [ ] one\n```md\n- [ ] in code\n```\n## Later\n- [x] two";
    const ts = tasksInNote("n.md", note);
    expect(ts.map((t) => [t.description, t.heading, t.line])).toEqual([["one", "Week", 5], ["two", "Later", 10]]);
  });

  it("serialises back and toggles done with today's date", () => {
    const line = "- [ ] Pay rent #home ⏫ 🔁 every month 📅 2026-10-25 🆔 rent1";
    const t = parseTaskLine(line)!;
    expect(serializeTask(t)).toBe(line);
    const done = toggleTask(t, "2026-10-24");
    expect(serializeTask(done)).toBe("- [x] Pay rent #home ⏫ 🔁 every month 📅 2026-10-25 ✅ 2026-10-24 🆔 rent1");
    expect(serializeTask(toggleTask(done, "x"))).toBe(line);
  });
});

/**
 * Syntax compatibility on 20 files: the obsidian-tasks repository's own
 * Tasks-Demo sample vault (MIT), copied to eval/tasks-compat/ with the
 * expected parse written by hand from the plugin's documented semantics.
 */
describe("compatibility with obsidian-tasks notes (4.13 acceptance: 20 files)", () => {
  const dir = join(__dirname, "..", "..", "eval", "tasks-compat");
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<string, Array<Partial<Task>>>;
  const files = readdirSync(join(dir, "notes")).filter((f) => f.endsWith(".md"));

  it("has 20 files", () => expect(files.length).toBe(20));

  for (const f of files) {
    it(f, () => {
      const got = tasksInNote(f, readFileSync(join(dir, "notes", f), "utf8"));
      const want = expected[f];
      expect(got.length, "task count").toBe(want.length);
      want.forEach((w, i) => expect(got[i]).toMatchObject(w));
    });
  }
});

describe("queries (```tasks``` blocks)", () => {
  const all = tasksInNote(
    "Projects/Home.md",
    [
      "# Bills",
      "- [ ] rent ⏫ 📅 2026-10-24",
      "- [ ] water 📅 2026-10-30",
      "- [x] gas ✅ 2026-10-20 📅 2026-10-19",
      "# Ideas",
      "- [ ] paint #someday 🔽",
      "- [ ] fix door ⏳ 2026-10-23 🆔 door",
      "- [ ] buy hinge ⛔ door",
    ].join("\n"),
  );

  it("filters, sorts and limits like upstream", () => {
    const r = runQuery(parseQuery("not done\ndue before in 7 days\nsort by due", today), all, today);
    expect(r.groups[0].tasks.map((t) => t.description)).toEqual(["rent", "water"]);
    expect(runQuery(parseQuery("done", today), all, today).total).toBe(1);
    expect(runQuery(parseQuery("due today", today), all, today).groups[0].tasks[0].description).toBe("rent");
    expect(runQuery(parseQuery("priority is above none", today), all, today).total).toBe(1);
    expect(runQuery(parseQuery("tags include someday", today), all, today).total).toBe(1);
    expect(runQuery(parseQuery("is blocked", today), all, today).groups[0].tasks.map((t) => t.description)).toEqual(["buy hinge"]);
    expect(runQuery(parseQuery("(due on 2026-10-30) OR (has scheduled date)", today), all, today).total).toBe(2);
    expect(runQuery(parseQuery("not done\nlimit 2", today), all, today).groups[0].tasks).toHaveLength(2);
    expect(runQuery(parseQuery("path includes projects/home\nheading includes ideas", today), all, today).total).toBe(3);
  });

  it("groups by heading", () => {
    const r = runQuery(parseQuery("group by heading", today), all, today);
    expect(r.groups.map((g) => [g.name, g.tasks.length])).toEqual([["Bills", 3], ["Ideas", 3]]);
  });

  it("reports what it doesn't understand instead of ignoring it", () => {
    expect(runQuery(parseQuery("due whenever", today), all, today).errors[0]).toMatch(/date/);
    expect(runQuery(parseQuery("frobnicate", today), all, today).errors[0]).toMatch(/do not understand/);
  });

  it("relative dates", () => {
    expect(parseDate("tomorrow", today)).toBe("2026-10-25");
    expect(parseDate("in 2 weeks", today)).toBe("2026-11-07");
    expect(parseDate("3 days ago", today)).toBe("2026-10-21");
  });

  it("1,000 tasks: a query under 100 ms (4.13 acceptance)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const d = `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
      lines.push(`- [${i % 5 === 0 ? "x" : " "}] task ${i} #t${i % 7} ${["⏫", "🔼", "", "🔽"][i % 4]} 📅 ${d}`);
    }
    const many = tasksInNote("big.md", lines.join("\n"));
    expect(many).toHaveLength(1000);
    const q = parseQuery("not done\ndue after 2026-03-01\ntags include t3\nsort by priority\ngroup by due", today);
    runQuery(q, many, today); // warm-up
    const t0 = performance.now();
    const r = runQuery(q, many, today);
    const ms = performance.now() - t0;
    expect(r.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });
});
