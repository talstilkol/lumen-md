/** K1 — eval baselines: a case that passed and now fails is a regression. */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT_CASES } from "../agents/eval/promptCases";
import { PROMPTS } from "../ai/prompts";

const script = join(__dirname, "../../scripts/eval-compare.mjs");
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const results = (ok: Record<string, boolean>) => ({ model: "m", date: "2026-10-18", results: Object.entries(ok).map(([id, v]) => ({ id, status: "ok", checks: [{ ok: v }] })) });

describe("eval baseline compare", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-"));
  const base = join(dir, "base.json");
  const now = join(dir, "agents-2026-10-18-m.json");

  it("saves a baseline, then flags a regression and reports fixes", () => {
    writeFileSync(now, JSON.stringify(results({ a: true, b: false })));
    expect(run([now, "--save", "--baseline", base]).status).toBe(0);
    expect(JSON.parse(readFileSync(base, "utf8")).results).toHaveLength(2);
    writeFileSync(now, JSON.stringify(results({ a: false, b: true })));
    const r = run([now, "--baseline", base]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REGRESSIONS: a");
    expect(r.stdout).toContain("fixed: b");
  });

  it("no regressions → exit 0", () => {
    writeFileSync(now, JSON.stringify(results({ a: true, b: false })));
    writeFileSync(base, JSON.stringify(results({ a: true, b: false })));
    expect(run([now, "--baseline", base]).status).toBe(0);
  });
});

describe("prompt eval cases", () => {
  it("cover the prompts that answer users, Hebrew included", () => {
    const covered = new Set(PROMPT_CASES.map((c) => c.prompt));
    for (const p of ["rewrite", "autocomplete", "ragAssistant", "summarize", "actionItems", "commitMessage"] as const) expect(covered.has(p)).toBe(true);
    expect(PROMPT_CASES.filter((c) => c.id.endsWith("-he")).length).toBeGreaterThanOrEqual(4);
  });
  it("user-facing prompts ask for the user's language (K2)", () => {
    for (const k of ["rewrite", "autocomplete", "ragAssistant", "summarize", "actionItems", "ghostwriter"] as const) expect(PROMPTS[k]).toMatch(/same language/);
  });
  it("the checks reject an English answer to a Hebrew request", () => {
    const c = PROMPT_CASES.find((x) => x.id === "rewrite-he")!;
    const lang = c.checks.find((k) => k.name === "same language")!;
    expect(lang.test("The meeting tomorrow moved to three because the client cannot make the morning, please update everyone.", c.user)).toBe(false);
    expect(lang.test("הפגישה שנקבעה למחר נדחתה לשעה שלוש, מאחר שהלקוח אינו פנוי בבוקר. נא לעדכן את כל המשתתפים.", c.user)).toBe(true);
  });
});
