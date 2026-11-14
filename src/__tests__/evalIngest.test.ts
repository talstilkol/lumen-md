/**
 * Plan 7.9 / W10.E12 — `npm run eval:ingest`: real eval runs into the app.
 *
 * The runs here are SYNTHETIC (src/__tests__/fixtures/eval-ingest/, said so
 * in each file): they exercise the ingest, they measure nothing. Real runs
 * come from `npm run eval:agents -- --model <m>` on the Mac (W10.M7).
 *
 * - A run is taken only when acceptable: a real model in the registry,
 *   kind "model", a date, a complete record. Wiring runs, unknown models
 *   and incomplete records are refused, with the reason.
 * - The newest run of a model wins; `measured` lands on its registry entry.
 * - Each agent's default is the best model at or above the threshold, open
 *   licence only; agents no model passes go to the failures report.
 * - The app uses the result: the agent runtime runs an agent's measured
 *   default when it is installed and the user picked no model.
 */
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs module without type declarations
import { acceptRun, pickDefaults, scoreRun, selectRuns } from "../../scripts/lib/evalIngest.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { ingest, parseArgs } from "../../scripts/eval/ingest.mjs";
import { MEASURED_DEFAULTS, MEASURED_SCORES, measuredModelFor } from "../ai/defaults";

const ROOT = resolve(__dirname, "../..");
const FIX = join(ROOT, "src/__tests__/fixtures/eval-ingest");
const registry = JSON.parse(readFileSync(join(ROOT, "models/registry.json"), "utf8"));
const known = new Set<string>(registry.models.map((m: { id: string }) => m.id));
const acceptance = JSON.parse(readFileSync(join(ROOT, "eval/acceptance.json"), "utf8"));
const fixture = (f: string) => JSON.parse(readFileSync(join(FIX, f), "utf8"));

/** A scratch copy of the registry, the acceptance file and the outputs, pointed at the synthetic runs. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "eval-ingest-"));
  copyFileSync(join(ROOT, "models/registry.json"), join(dir, "registry.json"));
  copyFileSync(join(ROOT, "eval/acceptance.json"), join(dir, "acceptance.json"));
  const args = ["--results", FIX, "--registry", join(dir, "registry.json"), "--acceptance", join(dir, "acceptance.json"), "--defaults", join(dir, "defaults.ts"), "--report", join(dir, "failures.md")];
  return { dir, args };
}

describe("which runs are taken", () => {
  it("refuses a wiring run, the fake server, an unknown model and a run without a date — with the reason", () => {
    expect(acceptRun(fixture("agents-2026-11-01-qwen3_8b.json"), known)).toEqual({ ok: true, reasons: [] });
    const fake = acceptRun(fixture("agents-2026-11-04-fake-ollama.json"), known);
    expect(fake.ok).toBe(false);
    expect(fake.reasons.join(" ")).toMatch(/kind is "wiring"/);
    expect(fake.reasons.join(" ")).toMatch(/fake server/);
    expect(acceptRun(fixture("agents-2026-11-05-mystery_1b.json"), known).reasons).toEqual(["model mystery:1b is not in models/registry.json (no licence on record)"]);
    expect(acceptRun(fixture("agents-2026-11-06-qwen3_4b.json"), known).reasons).toEqual(["no ISO date"]);
  });

  it("refuses an incomplete record: no results, a case twice, a case on another model, an ok case with no checks, all skipped", () => {
    const base = fixture("agents-2026-11-01-qwen3_8b.json");
    const r = (patch: object) => acceptRun({ ...base, ...patch }, known).reasons.join(" | ");
    expect(r({ results: [] })).toBe("no results");
    expect(r({ results: [base.results[0], base.results[0]] })).toMatch(/case tagger-he twice/);
    expect(r({ results: [{ ...base.results[0], model: "qwen2.5:7b" }] })).toMatch(/ran on qwen2.5:7b, not qwen3:8b/);
    expect(r({ results: [{ ...base.results[0], checks: [] }] })).toMatch(/ok with no checks/);
    expect(r({ results: [{ ...base.results[0], status: "skipped" }] })).toMatch(/every case skipped/);
    expect(r({ url: undefined })).toMatch(/no Ollama URL/);
  });

  it("takes the newest run of each model", () => {
    const files = ["agents-2026-10-20-qwen2.5_7b.json", "agents-2026-11-02-qwen2.5_7b.json", "agents-2026-11-01-qwen3_8b.json"].map((f) => ({ path: f, run: fixture(f) }));
    const { accepted } = selectRuns(files, known);
    expect(accepted.map((a: { path: string }) => a.path)).toEqual(["agents-2026-11-02-qwen2.5_7b.json", "agents-2026-11-01-qwen3_8b.json"]);
  });

  it("scores per agent, skipped cases left out", () => {
    const s = scoreRun(fixture("agents-2026-11-01-qwen3_8b.json"));
    expect(s.tagger).toMatchObject({ passed: 2, run: 2, score: 1 });
    expect(s.proofreader).toMatchObject({ passed: 0, run: 1, score: 0, failing: [{ id: "proofreader-he", why: "missing: תיקון" }] });
    expect(s.charter).toBeUndefined();
  });
});

describe("npm run eval:ingest on the synthetic runs", () => {
  it("writes measured into the registry, the defaults module and the failures report", () => {
    const { dir, args } = scratch();
    const run = spawnSync(process.execPath, [join(ROOT, "scripts/eval/ingest.mjs"), ...args], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("✗ not taken: src/__tests__/fixtures/eval-ingest/agents-2026-11-04-fake-ollama.json");
    const reg = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
    const byId = new Map<string, { measured?: { date: string; overall: { score: number }; agents: Record<string, { score: number }> } }>(reg.models.map((m: { id: string }) => [m.id, m]));
    expect(byId.get("qwen3:8b")!.measured).toMatchObject({ date: "2026-11-01", overall: { passed: 3, run: 4, score: 0.75 }, agents: { tagger: { score: 1 }, outliner: { score: 1 }, proofreader: { score: 0 } } });
    // The newer qwen2.5 run is the one recorded.
    expect(byId.get("qwen2.5:7b")!.measured).toMatchObject({ date: "2026-11-02", overall: { score: 0.5 } });
    expect(byId.get("llama3.1:8b")!.measured).toMatchObject({ overall: { score: 1 } });
    // Models without a taken run are untouched.
    expect(byId.get("qwen3:4b")!.measured).toBeUndefined();
    expect(reg.models.length).toBe(registry.models.length);

    const defaults = readFileSync(join(dir, "defaults.ts"), "utf8");
    expect(defaults).toContain("GENERATED by scripts/eval/ingest.mjs");
    const report = readFileSync(join(dir, "failures.md"), "utf8");
    expect(report).toContain("## proofreader");
    expect(report).toContain("`proofreader-he`: missing: תיקון");
    expect(report).toContain("(custom licence: never a default)");
    expect(report).toContain("model mystery:1b is not in models/registry.json");

    // --check: green right after, red once a run changes.
    expect(spawnSync(process.execPath, [join(ROOT, "scripts/eval/ingest.mjs"), ...args, "--check"], { encoding: "utf8" }).status).toBe(0);
    writeFileSync(join(dir, "registry.json"), readFileSync(join(ROOT, "models/registry.json")));
    expect(spawnSync(process.execPath, [join(ROOT, "scripts/eval/ingest.mjs"), ...args, "--check"], { encoding: "utf8" }).status).toBe(1);
  });

  it("an agent's default is the best model at or above the threshold, open licence only; ties go to the better overall score", () => {
    const { args } = scratch();
    const r = ingest(parseArgs(args));
    expect(Object.fromEntries(Object.entries(r.defaults as Record<string, { model: string; score: number }>).map(([k, v]) => [k, v.model]))).toEqual({ tagger: "qwen3:8b", outliner: "qwen3:8b" });
    // llama3.1:8b passes the proofreader, but its licence is custom: no default for it.
    expect(r.failed.map((f: { agent: string }) => f.agent)).toEqual(["proofreader"]);
    // A stricter threshold for one agent is honoured.
    const strict = pickDefaults(r.accepted, registry, { ...acceptance, agents: { outliner: { threshold: 1.01 } } });
    expect(strict.defaults.outliner).toBeUndefined();
  });

  it("the generated module picks the measured default only when installed and nothing was picked by hand", async () => {
    const { dir, args } = scratch();
    const r = ingest(parseArgs(args));
    writeFileSync(join(dir, "defaults.ts"), r.defaultsText);
    const m = (await import(join(dir, "defaults.ts"))) as typeof import("../ai/defaults");
    expect(m.MEASURED_DEFAULTS.tagger.model).toBe("qwen3:8b");
    expect(m.MEASURED_SCORES["llama3.1:8b"]).toBe(1);
    expect(m.measuredModelFor("tagger", ["qwen2.5:7b", "qwen3:8b:latest"], null)).toBe("qwen3:8b:latest");
    expect(m.measuredModelFor("tagger", ["qwen2.5:7b"], null)).toBeNull(); // not installed
    expect(m.measuredModelFor("tagger", ["qwen3:8b"], "qwen2.5:7b")).toBeNull(); // the user's pick wins
    expect(m.measuredModelFor("proofreader", ["llama3.1:8b"], null)).toBeNull(); // no default
  });
});

describe("the app reads the result", () => {
  it("the committed defaults match eval/results (none taken yet: empty, nothing invented)", () => {
    const r = ingest(parseArgs([]));
    expect(readFileSync(join(ROOT, "src/ai/defaults.ts"), "utf8")).toBe(r.defaultsText);
    expect(readFileSync(join(ROOT, "models/registry.json"), "utf8")).toBe(r.registryText);
    expect(MEASURED_DEFAULTS).toEqual(r.defaults);
    expect(Object.keys(MEASURED_SCORES).length).toBe(r.accepted.length);
    expect(measuredModelFor("tagger", ["qwen3:8b"], null)).toBe(r.defaults.tagger ? "qwen3:8b" : null);
  });

  it("the agent runtime runs the measured default; the catalog ranks by measured scores", () => {
    const runtime = readFileSync(join(ROOT, "src/agents/runtime.ts"), "utf8");
    expect(runtime).toMatch(/measuredModelFor\(def\.id, installedOllamaModels\(\), configuredOllamaModel\(\)\)/);
    expect(runtime).toMatch(/const model = patch\.model \?\? measured \?\? executor\.modelFor/);
    const catalog = readFileSync(join(ROOT, "src/ai/modelCatalog.ts"), "utf8");
    expect(catalog).toContain("MEASURED_SCORES[e.name] ?? e.measured");
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["eval:ingest"]).toBe("node scripts/eval/ingest.mjs");
  });
});
