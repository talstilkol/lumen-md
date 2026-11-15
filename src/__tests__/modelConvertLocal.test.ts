/**
 * W1.17 / 6.0 (W10.E62): the model conversion is a script on this machine or
 * a Buildkite agent, not a GitHub Actions workflow. Same steps as the old
 * model-convert.yml: the plan, the SigLIP mirror, Nakdimon checked byte for
 * byte, the export with its fallbacks, the smoke test; nothing published.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
// @ts-expect-error — plain .mjs script without type declarations
import { convertAttempts, NAKDIMON_COMMIT, nakdimonProblems, parseArgs, planIds, planSteps } from "../../scripts/models/convert.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { smokeFromResults } from "../../scripts/models/registry-from-run.mjs";

const targets = JSON.parse(readFileSync("models/convert-targets.json", "utf8"));
const registry = JSON.parse(readFileSync("models/registry.json", "utf8"));

describe("no conversion workflow (W1.17)", () => {
  it("there is no model-convert workflow, and no workflow converts models", () => {
    expect(existsSync(".github/workflows/model-convert.yml")).toBe(false);
    // W10.G11 (#643): no .github/workflows at all on the train is no workflow either.
    const convert = (existsSync(".github/workflows") ? readdirSync(".github/workflows") : []).filter((f: string) => /scripts\.convert|convert-targets|scripts\/models\//.test(readFileSync(`.github/workflows/${f}`, "utf8")));
    expect(convert).toEqual([]);
  });

  it("npm run models:convert is the script; the doctor's fix names it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["models:convert"]).toBe("node scripts/models/convert.mjs");
    expect(readFileSync("src/agents/doctorEngines.ts", "utf8")).toContain("npm run models:convert && npm run models:registry -- --dir out/models --smoke out/models/smoke-results.json");
  });
});

describe("the same steps as the workflow", () => {
  it("plan: every target by default, --models picks, an unknown id is an error", () => {
    expect(planIds(targets)).toEqual(targets.models.map((m: { id: string }) => m.id));
    expect(planIds(targets, ["dictabert-ner"])).toEqual(["dictabert-ner"]);
    expect(() => planIds(targets, ["dictabert-ner", "nope"])).toThrow("unknown model id(s): nope");
    expect(parseArgs(["--models", "a, b", "--siglip", "convert"])).toMatchObject({ models: ["a", "b"], siglip: "convert", dryRun: false });
    expect(() => parseArgs(["--siglip", "maybe"])).toThrow(/auto or convert/);
    expect(() => parseArgs(["--publish"])).toThrow(/unknown argument/);
  });

  it("Nakdimon: the registry's sha256 and size, and an MIT LICENSE, or the problems", () => {
    const entry = registry.models.find((m: { id: string }) => m.id === "nakdimon");
    expect(entry.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = Buffer.from("not the model");
    const mit = "Permission is hereby granted, free of charge, to any person";
    const fake = { files: [{ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }] };
    expect(nakdimonProblems(bytes, mit, fake)).toEqual([]);
    expect(nakdimonProblems(bytes, "GPL", fake)).toEqual(["LICENSE is no longer MIT"]);
    expect(nakdimonProblems(bytes, mit, entry)[0]).toMatch(/^Nakdimon\.onnx is [0-9a-f]{64} \(13 B\); models\/registry\.json says /);
    expect(NAKDIMON_COMMIT).toBe("a06ebfd032548b132ac2da2f5aab1289de5ae5f2");
  });

  it("export: --revision with q8+q4f16 modes, then --revision --quantize, then --quantize", () => {
    const a = convertAttempts({ hf: "dicta-il/dictabert-ner", task: "token-classification", revision: "abc", outDir: "/o" });
    expect(a.map((x: string[]) => x.slice(8).join(" "))).toEqual(["--revision abc --quantize --modes q8 q4f16", "--revision abc --quantize", "--quantize"]);
    for (const x of a) expect(x.slice(0, 8)).toEqual(["-m", "scripts.convert", "--model_id", "dicta-il/dictabert-ner", "--task", "token-classification", "--output_parent_dir", "/o"]);
  });

  it("the plan: SigLIP mirror first in auto mode, Nakdimon, the scripts, each model, the smoke test; nothing published", () => {
    const ids = planIds(targets);
    const steps = planSteps({ ids, siglip: "auto", out: "/o", tjs: "/o/.tjs" });
    expect(steps.map((s: { id: string }) => s.id)).toEqual(["siglip-mirror", "nakdimon", "tjs-scripts", ...ids.map((id: string) => `convert ${id}`), "smoke"]);
    expect(steps.find((s: { id: string }) => s.id.startsWith("convert siglip")).skipIf).toBe("the mirror passed its smoke test");
    expect(planSteps({ ids, siglip: "convert", out: "/o", tjs: "/t" }).map((s: { id: string }) => s.id)).not.toContain("siglip-mirror");
    const all = JSON.stringify(steps);
    expect(all).toContain(`nakdimon/${NAKDIMON_COMMIT}`);
    expect(all).toContain("scripts/models/smoke.mjs --models /o");
    expect(all).not.toMatch(/upload|publish|gh release|huggingface-cli upload/);
  });

  it("--dry-run prints the plan and runs nothing; a bad id exits 2", () => {
    const r = spawnSync(process.execPath, ["scripts/models/convert.mjs", "--dry-run", "--models", "dictabert-ner", "--out", "/nonexistent/out"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("▶ convert dictabert-ner");
    expect(r.stdout).toContain("python3 scripts/models/hf.py info dictabert-ner");
    expect(existsSync("/nonexistent/out")).toBe(false);
    const bad = spawnSync(process.execPath, ["scripts/models/convert.mjs", "--models", "nope"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("unknown model id(s): nope");
  });

  it("models:registry --dir … --smoke: a model whose q8 smoke failed is known as failed", () => {
    const s = smokeFromResults([
      { id: "a", dtype: "q8", required: true, ok: true, output: "שלום" },
      { id: "a", dtype: "q4f16", required: false, ok: false, error: "no WebGPU" },
      { id: "b", dtype: "q8", required: true, ok: false, error: "no model folder" },
    ]);
    expect(s).toEqual({ a: { q8: { ok: true, text: "שלום" }, q4f16: { ok: false, text: "no WebGPU" } }, b: { q8: { ok: false, text: "no model folder" } } });
  });
});
