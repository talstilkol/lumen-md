// @vitest-environment node
/**
 * Plan W10.Z3 / 13.5: `dod.mjs --p0 --runner <shim> --report <file>` runs the
 * dod of every P0 task and writes the table. A vitest command runs file by
 * file through the runner; a command that cannot run here is "not here",
 * never a pass; a red command makes the task red.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { counts, notHere, reportMarkdown, runCommand, runTasks, verdictOf, vitestFiles } from "../../scripts/lib/dodRunner.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { p0Tasks } from "../../scripts/dod.mjs";
import { resolve } from "node:path";

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
