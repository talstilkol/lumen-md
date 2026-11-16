// @vitest-environment node
/**
 * W10.G11 (audit r3): the GitHub Actions workflows were archived
 * (docs/archive/workflows/) when the project left Actions (W1.35). Every job
 * of every archived workflow is mapped in docs/archive/workflows/equivalents.json
 * to what runs its gate now — a Buildkite step, a ci:local step, a Vercel
 * build gate or a local script — or to a recorded reason it was dropped, and
 * every target named there exists. A new archived job, or a target that is
 * renamed or deleted, fails here.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const DIR = join(ROOT, "docs/archive/workflows");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
type Target = { buildkite?: string; ciLocal?: string; vercelBuild?: string; script?: string; dropped?: string };
const MAP = JSON.parse(readFileSync(join(DIR, "equivalents.json"), "utf8")) as Record<string, Record<string, Target> | string>;

/** The top-level job ids of a workflow file. */
function jobsOf(yml: string): string[] {
  const at = yml.search(/^jobs:\s*$/m);
  if (at < 0) return [];
  const body = yml.slice(at).split("\n").slice(1);
  const out: string[] = [];
  for (const l of body) {
    if (/^\S/.test(l)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

describe("archived workflows have their equivalents (W10.G11)", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".yml")).sort();

  it("every job of every archived workflow is mapped, and nothing else is", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    const want = files.flatMap((f) => jobsOf(readFileSync(join(DIR, f), "utf8")).map((j) => `${f}#${j}`));
    const have = Object.entries(MAP).flatMap(([f, jobs]) => (typeof jobs === "string" ? [] : Object.keys(jobs).map((j) => `${f}#${j}`)));
    expect(want.length).toBeGreaterThanOrEqual(48);
    expect(have.sort()).toEqual(want.sort());
  });

  it("every target exists: Buildkite key, ci:local id, Vercel gate, script, or a real reason", () => {
    const pipeline = read(".buildkite/pipeline.yml");
    const keys = new Set([...pipeline.matchAll(/^\s+key:\s*"?([\w-]+)"?/gm)].map((m) => m[1]));
    const ciLocal = read("scripts/lib/ciLocal.mjs");
    const vercel = read("scripts/vercel-build.mjs");
    const gates = new Set([...vercel.matchAll(/^export const (?:PREVIEW|PRODUCTION)_GATES = \[([^\]]*)\]/gm)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])));
    const problems: string[] = [];
    for (const [f, jobs] of Object.entries(MAP)) {
      if (typeof jobs === "string") continue;
      for (const [job, t] of Object.entries(jobs)) {
        const where = `${f}#${job}`;
        const named = (["buildkite", "ciLocal", "vercelBuild", "script", "dropped"] as const).filter((k) => t[k] !== undefined);
        if (!named.length) problems.push(`${where}: no equivalent and no reason`);
        if (t.dropped !== undefined && (named.length > 1 || t.dropped.length < 40)) problems.push(`${where}: a dropped job has only its reason, at least a sentence`);
        if (t.buildkite && !keys.has(t.buildkite)) problems.push(`${where}: no Buildkite step "${t.buildkite}"`);
        if (t.ciLocal && !new RegExp(`id: "${t.ciLocal}"`).test(ciLocal)) problems.push(`${where}: no ci:local step "${t.ciLocal}"`);
        if (t.vercelBuild && !gates.has(t.vercelBuild)) problems.push(`${where}: no Vercel build gate "${t.vercelBuild}"`);
        if (t.script && !existsSync(join(ROOT, t.script))) problems.push(`${where}: no script ${t.script}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("no source still points at a GitHub workflow for a gate it runs elsewhere now", () => {
    expect(read("src/ai/ocrCer.ts")).not.toMatch(/\.github\/workflows/);
    const reg = JSON.parse(read("models/registry.json")) as { models?: Array<{ id: string; notes?: string }> };
    const bert = (reg.models ?? (reg as unknown as Array<{ id: string; notes?: string }>)).find((m) => m.id === "bert-base-ner")!;
    expect(bert.notes).not.toMatch(/\.github\/workflows/);
  });
});
