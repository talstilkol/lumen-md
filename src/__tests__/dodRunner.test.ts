// @vitest-environment node
/**
 * Plan W10.Z3 / 13.5: `dod.mjs --p0 --runner <shim> --report <file>` runs the
 * dod of every P0 task and writes the table. A vitest command runs file by
 * file through the runner; a command that cannot run here is "not here",
 * never a pass; a red command makes the task red.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { counts, jsonCounts, notHere, reportMarkdown, runCommand, runTasks, verdictOf, vitestFiles, vitestJsonSync } from "../../scripts/lib/dodRunner.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { p0Tasks, reportExit } from "../../scripts/dod.mjs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(__dirname, "../..");
type Res = { code: number; out: string };

describe("which commands run here", () => {
  it("browsers, cargo, the registry, mutation and the review's own command are not here", () => {
    expect(notHere("npx playwright test e2e/a11y.spec.ts --project=chromium")).toMatch(/browsers/);
    expect(notHere("npm ci")).toMatch(/registry/);
    expect(notHere("npm ci && npm run ci:local -- --e2e")).not.toBeNull();
    expect(notHere("cd src-tauri && cargo check")).toMatch(/Rust/);
    expect(notHere("npm run test:mutation")).toMatch(/mutation/);
    expect(notHere("npm test")).toMatch(/whole vitest suite/);
    expect(notHere("node scripts/dod.mjs $(node -p \"…\")")).toMatch(/this table/);
    expect(notHere("npm run plan:check")).toBeNull();
    expect(notHere("npx vitest run src/__tests__/dod.test.ts")).toBeNull();
    expect(notHere("node scripts/reproduce.mjs")).toBeNull();
  });

  it("expands vitest file lists and directories, and leaves other forms alone", () => {
    expect(vitestFiles("npx vitest run src/__tests__/dod.test.ts src/__tests__/handoff.test.ts", root)).toEqual(["src/__tests__/dod.test.ts", "src/__tests__/handoff.test.ts"]);
    const attacks = vitestFiles("npx vitest run security/attacks", root);
    expect(attacks.length).toBeGreaterThanOrEqual(13);
    expect(attacks.every((f: string) => f.startsWith("security/attacks/") && f.endsWith(".test.ts"))).toBe(true);
    expect(vitestFiles("npx vitest run -t name src/x.test.ts", root)).toBeNull();
    expect(vitestFiles("npm run plan:check", root)).toBeNull();
  });

  it("reads the runner's last pass/fail line", () => {
    expect(counts("x\npass 3 fail 0\nv4: node pass 3 fail 1")).toEqual({ pass: 3, fail: 1 });
    expect(counts("load error")).toBeNull();
  });
});

describe("runCommand and runTasks", () => {
  const fake = (byFile: Record<string, string>, shell: Record<string, number> = {}) => async (cmd: string, args: string[]): Promise<Res> =>
    cmd === "bash" ? { code: shell[args[1]] ?? 0, out: "done" } : { code: 0, out: byFile[args[1]] ?? "load error" };

  it("a vitest command is green only when every file has a pass and no failure; a fully skipped file is not a pass", async () => {
    const run = fake({ "src/__tests__/dod.test.ts": "v4: node pass 17 fail 0", "src/__tests__/handoff.test.ts": "v4: node pass 0 fail 0" });
    const ok = await runCommand("npx vitest run src/__tests__/dod.test.ts", { root, runner: "shim", run });
    expect(ok).toMatchObject({ status: "pass", detail: "dod.test.ts 17/17" });
    const zero = await runCommand("npx vitest run src/__tests__/dod.test.ts src/__tests__/handoff.test.ts", { root, runner: "shim", run });
    expect(zero).toMatchObject({ status: "skipped", detail: "dod.test.ts 17/17, handoff.test.ts 0/0 (all skipped here)" });
    expect(verdictOf([zero])).toBe("not here");
    const red = await runCommand("npx vitest run src/__tests__/dod.test.ts src/__tests__/handoff.test.ts", { root, runner: "shim", run: fake({ "src/__tests__/dod.test.ts": "pass 1 fail 1", "src/__tests__/handoff.test.ts": "pass 0 fail 0" }) });
    expect(red.status).toBe("fail");
    const missing = await runCommand("npx vitest run src/__tests__/noSuchFile.test.ts", { root, runner: "shim", run });
    expect(missing).toMatchObject({ status: "fail", detail: expect.stringMatching(/no such file/) });
  });

  it("a shell command passes on exit 0, and a not-here command never runs", async () => {
    let ran = 0;
    const run = async () => {
      ran++;
      return { code: 1, out: "boom" };
    };
    expect(await runCommand("npx playwright test e2e/x.spec.ts", { root, runner: "shim", run })).toMatchObject({ status: "not here" });
    expect(ran).toBe(0);
    expect(await runCommand("npm run plan:check", { root, runner: "shim", run })).toMatchObject({ status: "fail", detail: "exit 1 — boom" });
  });

  it("a Rust test run that ran no test is a fail, even on exit 0 (review 10, M5)", async () => {
    const out = (text: string) => async () => ({ code: 0, out: text });
    const zero = await runCommand("node scripts/rust-std-tests.mjs --only mcp-stdio", { root, runner: "shim", run: out("running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 0.00s\n") });
    expect(zero).toMatchObject({ status: "fail", detail: expect.stringMatching(/running 0 tests: nothing was checked/) });
    // cargo: a unit-test binary with tests and a doc-test binary with none is green.
    const some = await runCommand("node scripts/rust-std-tests.mjs", { root, runner: "shim", run: out("running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored\n\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored\n") });
    expect(some.status).toBe("pass");
    // No Rust output at all: an ordinary shell command.
    expect((await runCommand("npm run plan:check", { root, runner: "shim", run: out("plan: ok") })).status).toBe("pass");
  });

  it("verdicts: red beats not here beats green", async () => {
    expect(verdictOf([{ status: "pass" }, { status: "not here" }])).toBe("not here");
    expect(verdictOf([{ status: "not here" }, { status: "fail" }])).toBe("red");
    expect(verdictOf([{ status: "pass" }])).toBe("green");
    expect(verdictOf([])).toBe("no dod");
    const rows = await runTasks(
      [
        { id: "A", title: "a", dod: ["npm run plan:check"], dodExpect: ["exit 0"] },
        { id: "B", title: "b", dod: ["npm run x", "npx playwright test e2e/y.spec.ts"] },
      ],
      { root, runner: "shim", jobs: 2, run: fake({}, { "npm run x": 1 }) },
    );
    expect(rows.map((r: { verdict: string }) => r.verdict)).toEqual(["green", "red"]);
    const md = reportMarkdown(rows, { sha: "f".repeat(40), branch: "verify/train-7", runner: "shim", at: "now" });
    expect(md).toMatch(/\*\*2 P0 tasks:\*\* green 1 · red 1 · not here 0/);
    expect(md).toMatch(/\| B \| red \| `npm run x` \| fail: exit 1/);
    expect(md).toMatch(/not here: Playwright/);
  });
});

describe("without a runner: vitest's JSON reporter (review 9, M5)", () => {
  const a = "src/__tests__/dod.test.ts";
  const b = "src/__tests__/handoff.test.ts";
  const report = (byFile: Record<string, string[]>) => ({
    testResults: Object.entries(byFile).map(([f, st]) => ({ name: join(root, f), status: st.includes("failed") ? "failed" : "passed", assertionResults: st.map((status) => ({ status })) })),
  });
  // a fake `npx vitest run --reporter=json --outputFile=…` that writes the report vitest would
  const fakeVitest = (byFile: Record<string, string[]>, calls: string[][] = []) => async (cmd: string, args: string[]): Promise<Res> => {
    calls.push([cmd, ...args]);
    const out = args.find((x) => x.startsWith("--outputFile="));
    if (out) writeFileSync(out.slice("--outputFile=".length), JSON.stringify(report(byFile)));
    return { code: 0, out: "" };
  };

  it("an exit 0 with every test of a file skipped is not a pass", async () => {
    const calls: string[][] = [];
    const r = await runCommand(`npx vitest run ${a} ${b}`, { root, run: fakeVitest({ [a]: ["passed", "skipped"], [b]: ["skipped", "todo"] }, calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 4)).toEqual(["npx", "vitest", "run", "--reporter=json"]);
    expect(r).toMatchObject({ status: "skipped", detail: "dod.test.ts 1/1, handoff.test.ts 0/0 (all skipped here)" });
    expect(await runCommand(`npx vitest run ${a}`, { root, run: fakeVitest({ [a]: ["passed"] }) })).toMatchObject({ status: "pass" });
    expect(await runCommand(`npx vitest run ${a}`, { root, run: fakeVitest({ [a]: ["passed", "failed"] }) })).toMatchObject({ status: "fail", detail: "dod.test.ts 1/2" });
    // a file vitest did not report on (and no report at all) is red
    expect(await runCommand(`npx vitest run ${a} ${b}`, { root, run: fakeVitest({ [a]: ["passed"] }) })).toMatchObject({ status: "fail", detail: "dod.test.ts 1/1, handoff.test.ts load error" });
    expect(await runCommand(`npx vitest run ${a}`, { root, run: async () => ({ code: 0, out: "" }) })).toMatchObject({ status: "fail" });
  });

  it("the synchronous path (dod.mjs without --runner) judges the same way", () => {
    const spawn = (_c: string, args: string[]) => {
      writeFileSync(args.find((x) => x.startsWith("--outputFile="))!.slice(13), JSON.stringify(report({ [a]: ["skipped"] })));
      return { status: 0 };
    };
    expect(vitestJsonSync([a], root, spawn)).toMatchObject({ status: "skipped" });
    expect(jsonCounts(report({ [a]: ["passed", "passed", "skipped", "failed"] }), root).get(a)).toEqual({ pass: 2, fail: 1 });
  });

  it("no files at all (an empty directory) is red, through the runner or not (review 9, L12)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dod-empty-"));
    try {
      mkdirSync(join(dir, "empty"));
      writeFileSync(join(dir, "empty/notATest.ts"), "");
      expect(vitestFiles("npx vitest run empty", dir)).toEqual([]);
      let ran = 0;
      const run = async () => {
        ran++;
        return { code: 0, out: "pass 1 fail 0" };
      };
      expect(await runCommand("npx vitest run empty", { root: dir, runner: "shim", run })).toEqual({ cmd: "npx vitest run empty", status: "fail", detail: "no files" });
      expect(await runCommand("npx vitest run empty", { root: dir, run })).toMatchObject({ status: "fail", detail: "no files" });
      expect(ran).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the report header names the run that was made (review 9, L12)", () => {
  const rows = [{ id: "A", verdict: "green", cmds: [{ cmd: "x", status: "pass", detail: "" }], expect: [] }];
  it("--done is a ✅ run; without a runner it says vitest, not <shim>", () => {
    const md = reportMarkdown(rows, { sha: "f".repeat(40), branch: "b", runner: null, at: "now", mode: "--done" });
    expect(md).toMatch(/^# ✅ definition-of-done run on b @ ffffffffff/);
    expect(md).toMatch(/`node scripts\/dod\.mjs --done --report …`/);
    expect(md).not.toMatch(/<shim>|P0/);
    expect(md).toMatch(/vitest with its JSON reporter/);
    expect(md).toMatch(/\*\*1 ✅ tasks:\*\*/);
    const p0 = reportMarkdown(rows, { sha: "f".repeat(40), branch: "b", runner: "/x/v4.sh", at: "now", mode: "--p0" });
    expect(p0).toMatch(/^# P0 definition-of-done run/);
    expect(p0).toMatch(/--p0 --runner <shim> --report/);
    expect(reportMarkdown(rows, { sha: "f".repeat(40), branch: "b", runner: null, at: "now", mode: "W1.1" })).toMatch(/^# Selected definition-of-done run/);
  });
});

describe("--done exits 0 only when every row is green (review 9, H1)", () => {
  it("reportExit: not here and no dod are not green with --done or chosen ids; --p0 is red only on red", () => {
    const rows = (...v: string[]) => v.map((verdict) => ({ verdict }));
    for (const mode of ["--done", "W10.F5"]) {
      expect(reportExit(rows("green", "green"), mode)).toBe(0);
      expect(reportExit(rows("green", "not here"), mode)).toBe(1);
      expect(reportExit(rows("no dod"), mode)).toBe(1);
      expect(reportExit(rows("red"), mode)).toBe(1);
      expect(reportExit([], mode)).toBe(1);
    }
    expect(reportExit(rows("green", "not here"), "--p0")).toBe(0);
    expect(reportExit(rows("red"), "--p0")).toBe(1);
  });

  it("dod --done --runner on a plan whose ✅ task can't run here exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "dod-done-"));
    try {
      mkdirSync(join(dir, "scripts/lib"), { recursive: true });
      mkdirSync(join(dir, "plan"));
      cpSync(join(root, "scripts/dod.mjs"), join(dir, "scripts/dod.mjs"));
      cpSync(join(root, "scripts/lib/dodRunner.mjs"), join(dir, "scripts/lib/dodRunner.mjs"));
      cpSync(join(root, "scripts/lib/rustStd.mjs"), join(dir, "scripts/lib/rustStd.mjs"));
      const plan = (dod: string[]) => JSON.stringify({ phases: [{ tasks: [{ id: "T.1", title: "t", status: "✅ #1", dod }] }] });
      const done = () => spawnSync("node", [join(dir, "scripts/dod.mjs"), "--done", "--runner", "/bin/false"], { cwd: dir, encoding: "utf8" });
      writeFileSync(join(dir, "plan/plan.json"), plan(["npx playwright test e2e/x.spec.ts"]));
      const r = done();
      expect(`${r.stdout}${r.stderr}`).toMatch(/0 green, 0 red, 1 not here/);
      expect(r.status).toBe(1);
      writeFileSync(join(dir, "plan/plan.json"), plan(["true"]));
      expect(done().status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("p0Tasks", () => {
  it("is every P0 task but 13.5 and W10.Z3, each with a dod", async () => {
    const { readFileSync } = await import("node:fs");
    const plan = JSON.parse(readFileSync(resolve(root, "plan/plan.json"), "utf8"));
    const ts = p0Tasks(plan);
    expect(ts.length).toBeGreaterThan(100);
    expect(ts.map((t: { id: string }) => t.id)).not.toContain("13.5");
    expect(ts.map((t: { id: string }) => t.id)).not.toContain("W10.Z3");
    expect(ts.every((t: { dod?: string[] }) => (t.dod ?? []).length > 0)).toBe(true);
  });
});
