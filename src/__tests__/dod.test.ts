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
  shellPasses,
  markdown,
  allTasks,
  // @ts-expect-error — plain .mjs script without type declarations
} from "../../scripts/dod.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { run } from "../../scripts/plan/build.mjs";

type Task = { id: string; title?: string; status?: string; priority?: string; dod?: string[]; dodExpect?: unknown; dodMock?: boolean; acceptance?: string[] };
type Plan = { dodGrandfathered?: string[]; dodRevoked?: string[]; phases: { tasks: Task[] }[] };

const ROOT = resolve(__dirname, "..", "..");
const plan = (): Plan => JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const task = (p: Plan, id: string): Task => allTasks(p).find((t: Task) => t.id === id);
const tmp = mkdtempSync(join(tmpdir(), "lumen-dod-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const mini = (tasks: Task[]): Plan => ({ phases: [{ tasks }] });
const check = (p: Plan) => checkDod(p);

describe("checkDod", () => {
  it("the checked-in plan follows the rule", () => {
    expect(checkDod(plan())).toEqual([]);
  });

  it("refuses a ✅ without a dod", () => {
    const problems = check(mini([{ id: "1.1", status: "✅ #1" }]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/1\.1 is marked ✅ without a dod/);
  });

  it("refuses a ✅* without a dod too", () => {
    expect(check(mini([{ id: "1.1", status: "✅* #1" }]))[0]).toMatch(/without a dod/);
  });

  it("accepts a ✅ with commands, and open tasks without", () => {
    expect(check(mini([{ id: "1.1", status: "✅ #1", dod: ["true"] }, { id: "1.2" }, { id: "1.3", status: "⏳ #2" }]))).toEqual([]);
  });

  it("a mock-only task is ✅*, never plain ✅", () => {
    expect(check(mini([{ id: "1.1", status: "✅ #1", dod: ["true"], dodMock: true }]))[0]).toMatch(/mark it ✅\*/);
    expect(check(mini([{ id: "1.1", status: "✅* #1", dod: ["true"], dodMock: true }]))).toEqual([]);
  });

  it("no task is exempt: a grandfather list is refused, whatever it holds (W10.G5)", () => {
    // the 0.7 exemption is gone: listing a done task no longer lets it pass without a dod
    const listed = checkDod({ dodGrandfathered: ["1.1"], phases: [{ tasks: [{ id: "1.1", status: "✅ #1" }] }] });
    expect(listed.some((m: string) => /dodGrandfathered: no task is exempt/.test(m))).toBe(true);
    expect(listed.some((m: string) => /1\.1 is marked ✅ without a dod/.test(m))).toBe(true);
    // an empty list or a revocation record is refused too: the mechanism is deleted, not emptied
    expect(checkDod({ dodGrandfathered: [], phases: [{ tasks: [] }] })[0]).toMatch(/dodGrandfathered: no task is exempt/);
    expect(checkDod({ dodRevoked: ["1.1"], phases: [{ tasks: [] }] })[0]).toMatch(/dodRevoked: no task is exempt/);
  });

  it("the checked-in plan exempts nothing, and every ✅ in it has its commands (W10.G1–G5)", () => {
    const p = plan();
    expect(p.dodGrandfathered).toBeUndefined();
    expect(p.dodRevoked).toBeUndefined();
    const done = allTasks(p).filter((t: Task) => (t.status ?? "").startsWith("✅"));
    expect(done.length).toBeGreaterThan(0);
    for (const t of done) expect(t.dod?.length, t.id).toBeGreaterThan(0);
  });

  it("a reopened task can't return to ✅ without a dod", () => {
    expect(check(mini([{ id: "1.1", status: "⏳ again" }]))).toEqual([]);
    expect(check(mini([{ id: "1.1", status: "✅ #2" }]))[0]).toMatch(/without a dod/);
  });

  it("a ✅* task declares dodMock, so it can't quietly become ✅ (Codex P1, #265)", () => {
    expect(check(mini([{ id: "1.1", status: "✅* #1", dod: ["true"] }]))[0]).toMatch(/✅\* without "dodMock": true/);
    expect(check(mini([{ id: "1.1", status: "✅* #1", dod: ["true"], dodMock: true }]))).toEqual([]);
  });

  it("a dod is a list of non-empty commands", () => {
    expect(check(mini([{ id: "1.1", status: "✅ #1", dod: [" "] }]))[0]).toMatch(/list of commands/);
  });

  it("every P0 task, done or not, has a dod and one expected result per command (W10.Z3, lane A6)", () => {
    expect(check(mini([{ id: "1.1", priority: "P0", status: "⏳ #1" }]))[0]).toMatch(/1\.1 is P0 without a dod/);
    expect(check(mini([{ id: "1.1", priority: "P0" }]))[0]).toMatch(/P0 without a dod/);
    expect(check(mini([{ id: "1.1", priority: "P0", dod: ["true"] }]))[0]).toMatch(/P0 without dodExpect/);
    expect(check(mini([{ id: "1.1", priority: "P0", dod: ["true", "false"], dodExpect: ["exit 0"] }]))[0]).toMatch(/1 entries for 2 dod command/);
    expect(check(mini([{ id: "1.1", priority: "P0", dod: ["true"], dodExpect: [" "] }]))[0]).toMatch(/list of expected results/);
    expect(check(mini([{ id: "1.1", priority: "P0", dod: ["true"], dodExpect: "exit 0" }]))[0]).toMatch(/list of expected results/);
    expect(check(mini([{ id: "1.1", priority: "P0", dod: ["true"], dodExpect: ["exit 0"] }]))).toEqual([]);
    // P1 and P2 may stay without a dod until they are ✅; a dodExpect they carry still matches its dod.
    expect(check(mini([{ id: "1.1", priority: "P1" }]))).toEqual([]);
    expect(check(mini([{ id: "1.1", priority: "P1", dod: ["true"], dodExpect: [] }]))[0]).toMatch(/0 entries for 1/);
  });

  it("the checked-in plan: every P0 task has its commands and expected results", () => {
    const p0 = allTasks(plan()).filter((t: Task) => t.priority === "P0");
    expect(p0.length).toBeGreaterThan(0);
    for (const t of p0) {
      expect(t.dod?.length, t.id).toBeGreaterThan(0);
      expect((t.dodExpect as string[]).length, t.id).toBe(t.dod!.length);
    }
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
    expect(md).toContain("- [ ] `npm run plan:check` → exit 0");
    expect(markdown([{ id: "1.1", title: "x", dod: ["true"] }])).toContain("- [ ] `true` green");
  });
});

describe("a shell command of a dod (review 10, M5)", () => {
  const fake = (status: number, stdout: string) => () => ({ status, stdout, stderr: "" });
  it("a Rust test run that ran no test is not green, even on exit 0", () => {
    expect(shellPasses("cargo test --offline x", ".", fake(0, "running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out\n"))).toBe(false);
    expect(shellPasses("cargo test --offline", ".", fake(0, "running 29 tests\ntest result: ok. 29 passed; 0 failed;\n\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed;\n"))).toBe(true);
    expect(shellPasses("npm run plan:check", ".", fake(0, "plan: ok\n"))).toBe(true);
    expect(shellPasses("npm run plan:check", ".", fake(1, ""))).toBe(false);
  });
  it("a Rust test command whose output shows no test running is not green (review 11, L8)", () => {
    expect(shellPasses("cargo test --offline > /tmp/log", ".", fake(0, ""))).toBe(false);
    expect(shellPasses("cargo test --no-run", ".", fake(0, "   Compiling x v0.1.0\n"))).toBe(false);
    expect(shellPasses("d=$(mktemp -d) && rustc --edition 2021 --test a.rs -o \"$d/t\"", ".", fake(0, ""))).toBe(false);
    expect(shellPasses("echo cargo", ".", fake(0, ""))).toBe(true);
  });
});
