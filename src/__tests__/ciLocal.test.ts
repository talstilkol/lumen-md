/** 0.14 — `npm run ci:local` runs what CI runs; --changed narrows it to what the diff can break. */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs helper without types
import { planSteps, e2eSpecs, i18nDrift, summary } from "../../scripts/lib/ciLocal.mjs";

type Step = { id: string; cmd: string[]; skipReason?: string };
const pkg = { scripts: { hygiene: "x", budget: "x", licenses: "x" } };
const exists = (p: string) => p !== "scripts/headers.mjs";
const plan = (changed: string[] | null, flags: Record<string, unknown> = {}) => planSteps({ pkg, exists, changed, flags }) as Step[];
const byId = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.id, s]));

describe("ci:local steps", () => {
  it("a full run has every CI step; tools this branch lacks are 'not here', not failures", () => {
    const s = byId(plan(null));
    expect(Object.keys(s)).toEqual(["typecheck", "hygiene", "lint", "i18n", "licenses", "headers", "test", "build", "budget", "e2e"]);
    for (const id of ["typecheck", "hygiene", "i18n", "licenses", "test", "build", "budget", "e2e"]) expect(s[id].skipReason, id).toBeUndefined();
    expect(s.lint.skipReason).toMatch(/not here/);
    expect(s.headers.skipReason).toMatch(/not here/);
    expect(s.test.cmd).toEqual(["npx", "vitest", "run"]);
  });

  it("--coverage, --skip and --only", () => {
    expect(byId(plan(null, { coverage: true })).test.cmd).toContain("--coverage");
    expect(byId(plan(null, { skip: ["e2e", "build"] })).e2e.skipReason).toMatch(/--skip/);
    const only = byId(plan(null, { only: ["typecheck"] }));
    expect(only.typecheck.skipReason).toBeUndefined();
    expect(only.test.skipReason).toBe("not selected");
  });

  it("--changed runs the tests related to the changed code files", () => {
    const s = byId(plan(["src/ai/tts.ts", "docs/a.md"]));
    expect(s.test.cmd).toEqual(["npx", "vitest", "related", "--run", "src/ai/tts.ts"]);
    expect(s.build.skipReason).toBeUndefined();
  });

  it("a docs-only diff skips tests, build and e2e but still type-checks", () => {
    const s = byId(plan(["docs/a.md", "MASTER_PLAN.md"]));
    expect(s.typecheck.skipReason).toBeUndefined();
    expect(s.test.skipReason).toMatch(/no code files/);
    for (const id of ["build", "budget", "e2e"]) expect(s[id].skipReason, id).toMatch(/no app code/);
  });

  it("e2e: a full run passes no spec list; --changed runs smoke plus changed specs", () => {
    const all = ["e2e/smoke.spec.ts", "e2e/rtl.spec.ts", "e2e/ai-cancel.spec.ts"];
    expect(e2eSpecs(null, all)).toEqual([]);
    expect(e2eSpecs(["e2e/rtl.spec.ts", "src/x.ts"], all)).toEqual(["e2e/smoke.spec.ts", "e2e/rtl.spec.ts"]);
  });

  it("the i18n drift gate matches CI (≤ 10 keys) and the summary marks each step", () => {
    expect(i18nDrift(1411, 1401).ok).toBe(true);
    expect(i18nDrift(1411, 1400)).toEqual({ diff: 11, ok: false });
    const out = summary([
      { title: "TypeScript", status: "pass", ms: 1200 },
      { title: "ESLint", status: "skip", reason: "not here" },
      { title: "Vitest", status: "fail", ms: 3000 },
    ]);
    expect(out).toMatch(/✓ TypeScript\s+1\.2s/);
    expect(out).toMatch(/– ESLint\s+not here/);
    expect(out).toMatch(/✗ Vitest/);
  });
});
