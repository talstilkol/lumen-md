/**
 * Plan 7.2 / W10.E33 — the real tiny model on Buildkite, not on GitHub
 * Actions: qwen3:0.6b on every build that touches src/agents/, qwen3:1.7b
 * and DictaLM nightly; models and images pinned by digest
 * (models/ci-models.json), the Ollama store cached per digest.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs module without type declarations
import { REAL_MODEL_STEPS, buildPipeline, pipelineRules } from "../../scripts/buildkite/lib.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { cacheDir, imageRef, pinProblems } from "../../scripts/lib/realModelPins.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { run } from "../../scripts/real-model-pins.mjs";

const ROOT = resolve(__dirname, "../..");
const pipeline = parse(readFileSync(join(ROOT, ".buildkite/pipeline.yml"), "utf8")) as { steps: Array<Record<string, unknown> & { key?: string; command?: string }> };
const step = (key: string) => pipeline.steps.find((s) => s.key === key)!;
const pins = JSON.parse(readFileSync(join(ROOT, "models/ci-models.json"), "utf8"));
const real = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
const pinned = {
  models: Object.fromEntries(Object.keys(pins.models).map((m, i) => [m, { digest: real(i + 1) }])),
  images: Object.fromEntries(Object.keys(pins.images).map((m, i) => [m, real(i + 5)])),
};

describe("the real-model steps", () => {
  it("are Buildkite steps of their own: 0.6b when src/agents/ changes, 1.7b and DictaLM on scheduled builds", () => {
    expect(step("real-model-pr").if_changed).toBe("src/agents/**");
    expect(step("real-model-pr").if).toBeUndefined();
    expect(step("real-model-pr").command).toContain("--model qwen3:0.6b");
    for (const k of ["real-model-nightly", "real-model-hebrew"]) expect(step(k).if).toBe('build.source == "schedule"');
    expect(step("real-model-nightly").command).toContain("--model qwen3:1.7b");
    expect(step("real-model-hebrew").command).toContain("--hebrew-smoke --model hf.co/dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF");
    expect(step("real-model-nightly").command).toContain("src/agents/eval/services.eval.ts");
  });

  it("need nothing from .github/workflows, and keep the pipeline's rules (timeouts, statuses, no retry on a failure)", () => {
    for (const r of REAL_MODEL_STEPS as Array<{ key: string }>) {
      const c = String(step(r.key).command);
      expect(c).not.toMatch(/\.github\/workflows|actions\//);
      expect(c).not.toMatch(/:latest\b/);
    }
    expect(pipelineRules(pipeline)).toEqual([]);
    // The receipt waits for them too.
    const receipt = step("receipt") as { depends_on: Array<{ step: string }> };
    for (const r of REAL_MODEL_STEPS as Array<{ key: string }>) expect(receipt.depends_on.map((d) => d.step)).toContain(r.key);
  });

  it("run every model and image at its pinned digest, with the model's store cached under its digest", () => {
    const c = String(step("real-model-nightly").command);
    expect(c).toContain("pins check --model qwen3:1.7b --image ollama/ollama --image erikvl87/languagetool --image searxng/searxng");
    expect(c).toContain('"$$(pins image ollama/ollama)"');
    expect(c).toContain('--digest "$$(node scripts/real-model-pins.mjs digest qwen3:1.7b)"');
    expect(c).toContain('-v "$$STORE:/root/.ollama"');
    expect(cacheDir(pinned, "qwen3:0.6b", "/cache/ci")).toBe(`/cache/ci/ollama/${"1".repeat(16)}`);
    expect(cacheDir(pinned, "qwen3:1.7b", "/cache/ci")).not.toBe(cacheDir(pinned, "qwen3:0.6b", "/cache/ci"));
    expect(imageRef(pinned, "ollama/ollama")).toBe(`ollama/ollama@${real(5)}`);
  });

  it("refuse a pin that is not a digest — the committed placeholders fail until they are filled on the Mac", () => {
    expect(pinProblems(pinned)).toEqual([]);
    const committed = run(["check"], pins);
    expect(committed.code).toBe(1);
    expect(committed.out).toContain("model qwen3:0.6b: sha256:PIN-ON-THE-MAC is not a sha256 digest");
    expect(run(["check", "--model", "qwen3:0.6b", "--image", "ollama/ollama"], pinned)).toEqual({ code: 0, out: "✓ every real-model pin is a sha256 digest" });
    expect(pinProblems({ models: { "qwen3:0.6b": { digest: "latest" } }, images: { "ollama/ollama": "latest" } })).toHaveLength(2);
    expect(() => imageRef(pinned, "nope/nope")).toThrow(/no pin/);
  });

  it("the job joins the pinned services' network (run.sh)", () => {
    const sh = readFileSync(join(ROOT, "scripts/buildkite/run.sh"), "utf8");
    expect(sh).toContain('[ -n "${LUMEN_CI_DOCKER_NET:-}" ] && net=(--network "$LUMEN_CI_DOCKER_NET")');
    expect(sh).toMatch(/exec "\$DOCKER" run --rm --init --ipc=host "\$\{net\[@\]\}"/);
  });

  it("the generated file is what the generator gives", () => {
    const ci = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"), { uniqueKeys: false });
    const built = buildPipeline(ci) as { steps: Array<{ key?: string; if_changed?: string }> };
    expect(built.steps.find((s) => s.key === "real-model-pr")?.if_changed).toBe("src/agents/**");
  });
});
