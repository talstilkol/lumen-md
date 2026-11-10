// @vitest-environment node
/**
 * Plan 0.7 — the definition-of-done checker (scripts/dod.mjs) and the rule
 * plan:check enforces with it: no ✅ without the commands that prove it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkDod,
  select,
  runDod,
  markdown,
  allTasks,
  DOD_GRANDFATHER_BASELINE,
  // @ts-expect-error — plain .mjs script without type declarations
} from "../../scripts/dod.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { run } from "../../scripts/plan/build.mjs";

type Task = { id: string; title?: string; status?: string; dod?: string[]; dodMock?: boolean; acceptance?: string[] };
type Plan = { dodGrandfathered?: string[]; phases: { tasks: Task[] }[] };

const ROOT = resolve(__dirname, "..", "..");
const plan = (): Plan => JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const task = (p: Plan, id: string): Task => allTasks(p).find((t: Task) => t.id === id);
const tmp = mkdtempSync(join(tmpdir(), "lumen-dod-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const mini = (tasks: Task[], dodGrandfathered: string[] = []): Plan => ({ dodGrandfathered, phases: [{ tasks }] });

describe("checkDod", () => {
  it("the checked-in plan follows the rule", () => {
    expect(checkDod(plan())).toEqual([]);
  });

  it("refuses a ✅ without a dod", () => {
    const problems = checkDod(mini([{ id: "1.1", status: "✅ #1" }]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/1\.1 is marked ✅ without a dod/);
  });

  it("refuses a ✅* without a dod too", () => {
    expect(checkDod(mini([{ id: "1.1", status: "✅* #1" }]))[0]).toMatch(/without a dod/);
  });

  it("accepts a ✅ with commands, and open tasks without", () => {
    expect(checkDod(mini([{ id: "1.1", status: "✅ #1", dod: ["true"] }, { id: "1.2" }, { id: "1.3", status: "⏳ #2" }]))).toEqual([]);
  });

  it("a mock-only task is ✅*, never plain ✅", () => {
    expect(checkDod(mini([{ id: "1.1", status: "✅ #1", dod: ["true"], dodMock: true }]))[0]).toMatch(/mark it ✅\*/);
    expect(checkDod(mini([{ id: "1.1", status: "✅* #1", dod: ["true"], dodMock: true }]))).toEqual([]);
  });

  it("grandfathered tasks pass without a dod, and the list cannot hide anything", () => {
    expect(checkDod(mini([{ id: "1.1", status: "✅ #1" }], ["1.1"]))).toEqual([]);
    expect(checkDod(mini([], ["9.9"]))[0]).toMatch(/9\.9 is not a task/);
    expect(checkDod(mini([{ id: "1.1", status: "✅ #1", dod: ["true"] }], ["1.1"]))[0]).toMatch(/has a dod now/);
  });

  it("the grandfather list only shrinks: an id outside the frozen baseline is refused (Codex P1, #265)", () => {
    expect(DOD_GRANDFATHER_BASELINE).toHaveLength(60);
    expect(Object.isFrozen(DOD_GRANDFATHER_BASELINE)).toBe(true);
    // 4.11 was never ✅ before 0.7: marking it ✅ and hiding it on the list fails
    const problems = checkDod(mini([{ id: "4.11", status: "✅ #300" }], ["4.11"]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/4\.11 was not ✅ before 0\.7/);
    expect(checkDod(mini([{ id: "x", status: "✅ #1" }], ["x"]), { baseline: ["x"] })).toEqual([]);
    // every id the checked-in plan grandfathers is in the baseline
    for (const id of plan().dodGrandfathered ?? []) expect(DOD_GRANDFATHER_BASELINE).toContain(id);
  });

  it("a reopened grandfathered task must leave the list, so it can't return to ✅ without a dod (Codex P1, #265)", () => {
    expect(checkDod(mini([{ id: "1.1", status: "⏳ again" }], ["1.1"]))[0]).toMatch(/1\.1 is not done any more/);
    // off the list: ⏳ is fine, and ✅ again needs a dod
    expect(checkDod(mini([{ id: "1.1", status: "⏳ again" }]))).toEqual([]);
    expect(checkDod(mini([{ id: "1.1", status: "✅ #2" }]))[0]).toMatch(/without a dod/);
  });

  it("a dod is a list of non-empty commands", () => {
    expect(checkDod(mini([{ id: "1.1", status: "✅ #1", dod: [" "] }]))[0]).toMatch(/list of commands/);
  });
});

describe("plan:check", () => {
  it("fails when a done task loses its dod", () => {
    const dir = join(tmp, "nodod");
    mkdirSync(join(dir, "plan"), { recursive: true });
    for (const f of ["plan/plan.json", "plan/board.html", "MASTER_PLAN.md"]) cpSync(join(ROOT, f), join(dir, f));
    const p = plan();
    delete task(p, "0.6").dod;
    writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(p, null, 1) + "\n");
    expect(() => run({ root: dir, check: true })).toThrow(/0\.6 is marked ✅ without a dod/);
  });
});

describe("runDod", () => {
  it("runs each command, stops a task at its first failure, and reports it", () => {
    const ran: string[] = [];
    const exec = (cmd: string) => {
      ran.push(cmd);
      return cmd !== "bad";
    };
    const results = runDod(
      [
        { id: "a", dod: ["one", "bad", "never"] },
        { id: "b", dod: ["two"] },
        { id: "c" },
      ],
      { exec, log: () => {} },
    );
    expect(ran).toEqual(["one", "bad", "two"]);
    expect(results.map((r: { id: string; ok: boolean; failed?: string }) => [r.id, r.ok, r.failed])).toEqual([
      ["a", false, "bad"],
      ["b", true, undefined],
      ["c", false, undefined],
    ]);
  });
});

describe("select and markdown", () => {
  it("--done picks every done task that has a dod", () => {
    const ids = select(plan(), { done: true }).map((t: Task) => t.id);
    expect(ids).toContain("0.6");
    for (const id of ids) expect(task(plan(), id).status).toMatch(/^✅/);
  });

  it("an unknown id is an error", () => {
    expect(() => select(plan(), { ids: ["99.9"] })).toThrow(/no task 99\.9/);
  });

  it("the PR checklist lists acceptance and commands", () => {
    const md = markdown([task(plan(), "0.6")]);
    expect(md).toMatch(/^### 0\.6 · /);
    expect(md).toContain("- [ ] `npm run plan:check` green");
  });
});
