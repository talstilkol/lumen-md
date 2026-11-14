#!/usr/bin/env node
/**
 * Convert the models Lumen self-hosts to ONNX, on this machine or a Buildkite
 * agent (plan 6.0, W1.17). It replaces .github/workflows/model-convert.yml (no
 * GitHub Actions), with the same steps:
 *
 *   1. plan      the ids: --models a,b, or every model in models/convert-targets.json
 *   2. SigLIP    --siglip auto (default): use the existing ONNX mirror when it downloads
 *                and passes the browser smoke test; convert only otherwise
 *   3. Nakdimon  already ONNX in its MIT repository: downloaded at the pinned commit and
 *                checked byte for byte (sha256, size) against models/registry.json
 *   4. convert   per model: source revision + model-card licence (hf.py info), the
 *                transformers.js conversion scripts (the first ref in transformersJsScripts
 *                that still ships scripts/convert.py), Optimum export + q8/q4f16 with the
 *                same three fallbacks, q4f16 on its own when the export made none, then
 *                scripts/models/manifest.mjs --prune
 *   5. smoke     transformers.js 4.3 in headless Chromium (scripts/models/smoke.mjs; q8
 *                must pass), the Opus-MT chrF and Nakdimon dev scores
 *
 * Nothing is published (hosting is the owner's decision, 15.9). The results stay in --out
 * (default out/models/): <id>/ with manifest.json, smoke-results.json, mt-dev-scores.json,
 * nikud-dev-scores.json. Then: npm run models:registry -- --dir <out> --smoke <out>/smoke-results.json
 *
 *   npm run models:convert -- --dry-run              # print every command, run nothing
 *   npm run models:convert -- --models dictabert-ner
 *   npm run models:convert -- --siglip convert --out /data/models
 *
 * Needs python3 with pip, git, curl and network access to Hugging Face and GitHub.
 * Exit 1 when a required step failed (a model's conversion or its q8 smoke test).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NAKDIMON_COMMIT = "a06ebfd032548b132ac2da2f5aab1289de5ae5f2";
const NAKDIMON_RAW = `https://raw.githubusercontent.com/elazarg/nakdimon/${NAKDIMON_COMMIT}`;
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

export function parseArgs(argv) {
  const opt = { models: [], siglip: "auto", out: join(ROOT, "out", "models"), dryRun: false, tjs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--models") opt.models = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--siglip") opt.siglip = argv[++i];
    else if (a === "--out") opt.out = resolve(argv[++i]);
    else if (a === "--tjs") opt.tjs = resolve(argv[++i]);
    else if (a === "--dry-run") opt.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!["auto", "convert"].includes(opt.siglip)) throw new Error(`--siglip must be auto or convert, got ${opt.siglip}`);
  return opt;
}

/** The ids to convert: what --models names, or all; an unknown id is an error (the workflow's plan job). */
export function planIds(targets, want = []) {
  const bad = want.filter((w) => !targets.models.some((m) => m.id === w));
  if (bad.length) throw new Error(`unknown model id(s): ${bad.join(", ")}`);
  return targets.models.map((m) => m.id).filter((id) => !want.length || want.includes(id));
}

/** Nakdimon.onnx and its LICENSE against the registry entry → [] or the problems. */
export function nakdimonProblems(onnx, licence, entry) {
  const want = entry.files[0];
  const sum = createHash("sha256").update(onnx).digest("hex");
  const out = [];
  if (sum !== want.sha256 || onnx.length !== want.bytes) out.push(`Nakdimon.onnx is ${sum} (${onnx.length} B); models/registry.json says ${want.sha256} (${want.bytes} B)`);
  if (!/Permission is hereby granted, free of charge/.test(licence)) out.push("LICENSE is no longer MIT");
  return out;
}

/** The export command lines, newest scripts first: the same three fallbacks as the workflow. */
export function convertAttempts({ hf, task, revision, outDir }) {
  const base = ["-m", "scripts.convert", "--model_id", hf, "--task", task, "--output_parent_dir", outDir];
  return [
    [...base, "--revision", revision, "--quantize", "--modes", "q8", "q4f16"],
    [...base, "--revision", revision, "--quantize"],
    [...base, "--quantize"],
  ];
}

/** Every model's step list (for --dry-run, and what main runs). */
export function planSteps({ ids, siglip, out, tjs }) {
  const steps = [];
  const sig = ids.find((id) => id.startsWith("siglip"));
  if (sig && siglip === "auto") steps.push({ id: "siglip-mirror", run: [`python3 scripts/models/hf.py mirror ${sig} ${join(out, sig)}`, `node scripts/models/smoke.mjs --models ${out} --ids ${sig} --out ${join(out, "siglip-mirror-smoke.json")}`] });
  steps.push({ id: "nakdimon", run: [`curl -fsSL ${NAKDIMON_RAW}/nakdimon/data/Nakdimon.onnx`, `curl -fsSL ${NAKDIMON_RAW}/LICENSE`, "check against models/registry.json"] });
  steps.push({ id: "tjs-scripts", run: [`git clone --depth 1 --branch <first ref of transformersJsScripts with scripts/convert.py> https://github.com/huggingface/transformers.js ${tjs}`, `pip install -r ${tjs}/scripts/requirements.txt (CPU torch)`, "pip install sentencepiece sacremoses protobuf"] });
  for (const id of ids) {
    steps.push({
      id: `convert ${id}`,
      run: [`python3 scripts/models/hf.py info ${id}`, ...convertAttempts({ hf: `<hf of ${id}>`, task: "<task>", revision: "<revision>", outDir: join(out, ".raw") }).map((a) => `python3 ${a.join(" ")}   # until one exits 0`), `node scripts/models/manifest.mjs --dir ${join(out, id)} --id ${id} --revision <revision> --via converted --prune`],
      skipIf: id === sig && siglip === "auto" ? "the mirror passed its smoke test" : null,
    });
  }
  steps.push({ id: "smoke", run: [`node scripts/models/smoke.mjs --models ${out} --ids ${ids.join(",")} --out ${join(out, "smoke-results.json")}`, `node scripts/golden/evals/mt.mjs --dev --models ${out} --layers opus --out ${join(out, "mt-dev-scores.json")}`, `node scripts/golden/evals/nikud.mjs --dev --model ${join(out, "nakdimon", "Nakdimon.onnx")}`] });
  return steps;
}

function sh(cmd, args, { cwd = ROOT, capture = false } = {}) {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: 64 << 20 });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "" };
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const targets = readJson(join(ROOT, "models", "convert-targets.json"));
  const ids = planIds(targets, opt.models);
  const tjs = opt.tjs ?? join(opt.out, ".tjs");
  if (opt.dryRun) {
    for (const s of planSteps({ ids, siglip: opt.siglip, out: opt.out, tjs })) console.log(`▶ ${s.id}${s.skipIf ? ` (skipped when ${s.skipIf})` : ""}\n${s.run.map((r) => `    ${r}`).join("\n")}`);
    return 0;
  }
  mkdirSync(opt.out, { recursive: true });
  const failed = [];
  const sig = ids.find((id) => id.startsWith("siglip"));
  let sigMirror = null;

  // 2. SigLIP mirror
  if (sig && opt.siglip === "auto") {
    const r = sh("python3", ["scripts/models/hf.py", "mirror", sig, join(opt.out, sig)], { capture: true });
    if (r.ok) {
      const m = JSON.parse(r.stdout.trim().split("\n").pop());
      const s = sh("node", ["scripts/models/smoke.mjs", "--models", opt.out, "--ids", sig, "--out", join(opt.out, "siglip-mirror-smoke.json")]);
      if (s.ok && sh("node", ["scripts/models/manifest.mjs", "--dir", join(opt.out, sig), "--id", sig, "--via", "mirror", "--mirror", m.mirror, "--revision", m.revision, "--prune"]).ok) sigMirror = m;
    }
    console.log(sigMirror ? `SigLIP: the mirror ${sigMirror.mirror} works — not converting` : "SigLIP: no working mirror — converting");
    if (!sigMirror) rmSync(join(opt.out, sig), { recursive: true, force: true });
  }

  // 3. Nakdimon
  {
    const dir = join(opt.out, "nakdimon");
    mkdirSync(dir, { recursive: true });
    const a = sh("curl", ["-fsSL", "-o", join(dir, "Nakdimon.onnx"), `${NAKDIMON_RAW}/nakdimon/data/Nakdimon.onnx`]);
    const b = sh("curl", ["-fsSL", "-o", join(dir, "LICENSE"), `${NAKDIMON_RAW}/LICENSE`]);
    const entry = readJson(join(ROOT, "models", "registry.json")).models.find((m) => m.id === "nakdimon");
    const problems = a.ok && b.ok ? nakdimonProblems(readFileSync(join(dir, "Nakdimon.onnx")), readFileSync(join(dir, "LICENSE"), "utf8"), entry) : ["download failed"];
    if (problems.length) {
      console.error(`✗ Nakdimon: ${problems.join("; ")}`);
      failed.push("nakdimon");
    } else {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "nakdimon", source: entry.source, revision: NAKDIMON_COMMIT, via: "mirror", license: entry.license, attribution: entry.attribution, files: entry.files }, null, 2) + "\n");
      console.log("✓ Nakdimon matches models/registry.json");
    }
  }

  // 4. convert
  const toConvert = ids.filter((id) => !(id === sig && sigMirror));
  if (toConvert.length) {
    let ref = null;
    for (const r of [...targets.transformersJsScripts, "main"]) {
      rmSync(tjs, { recursive: true, force: true });
      if (sh("git", ["clone", "-q", "--depth", "1", "--branch", r, "https://github.com/huggingface/transformers.js", tjs]).ok && existsSync(join(tjs, "scripts", "convert.py"))) {
        ref = r;
        break;
      }
    }
    if (!ref) {
      console.error("✗ no transformers.js ref with scripts/convert.py");
      return 1;
    }
    console.log(`transformers.js scripts: ${ref}`);
    if (!sh("python3", ["-m", "pip", "install", "-q", "--extra-index-url", "https://download.pytorch.org/whl/cpu", "-r", join(tjs, "scripts", "requirements.txt")]).ok) return 1;
    sh("python3", ["-m", "pip", "install", "-q", "sentencepiece", "sacremoses", "protobuf"]);
    for (const id of toConvert) {
      const info = sh("python3", ["scripts/models/hf.py", "info", id], { capture: true });
      if (!info.ok) {
        failed.push(id);
        continue;
      }
      const src = JSON.parse(info.stdout.trim().split("\n").pop());
      if (!src.licence_ok) console.warn(`⚠ ${id}: model card licence "${src.card}" is not the expected one — check before publishing (15.9)`);
      const raw = join(opt.out, ".raw");
      let ok = false;
      for (const a of convertAttempts({ hf: src.hf, task: src.task, revision: src.revision, outDir: raw })) if ((ok = sh("python3", a, { cwd: tjs }).ok)) break;
      if (!ok) {
        console.error(`✗ convert ${id}: scripts.convert failed`);
        failed.push(id);
        continue;
      }
      const dir = join(raw, src.hf);
      const q4 = spawnSync("sh", ["-c", `ls "${dir}"/onnx/*_q4f16.onnx`], { stdio: "ignore" }).status === 0;
      if (!q4 && !sh("python3", ["-m", "scripts.quantize", "--input_folder", join(dir, "onnx"), "--output_folder", join(dir, "onnx"), "--modes", "q4f16"], { cwd: tjs }).ok) console.warn(`⚠ ${id}: no q4f16 build (quantiser failed); q8 only`);
      rmSync(join(opt.out, id), { recursive: true, force: true });
      renameSync(dir, join(opt.out, id));
      if (!sh("node", ["scripts/models/manifest.mjs", "--dir", join(opt.out, id), "--id", id, "--revision", src.revision, "--via", "converted", "--prune"]).ok) failed.push(id);
    }
  }

  // 5. smoke and dev scores
  if (!sh("node", ["scripts/models/smoke.mjs", "--models", opt.out, "--ids", ids.join(","), "--out", join(opt.out, "smoke-results.json")]).ok) failed.push("smoke (q8)");
  sh("node", ["scripts/golden/evals/mt.mjs", "--dev", "--models", opt.out, "--layers", "opus", "--out", join(opt.out, "mt-dev-scores.json")]);
  const nik = sh("node", ["scripts/golden/evals/nikud.mjs", "--dev", "--model", join(opt.out, "nakdimon", "Nakdimon.onnx")], { capture: true });
  if (nik.ok) writeFileSync(join(opt.out, "nikud-dev-scores.json"), nik.stdout);

  console.log(`\n${failed.length ? `✗ failed: ${failed.join(", ")}` : "✓ converted and smoke-tested"} — results in ${opt.out}\nnext: npm run models:registry -- --dir ${opt.out} --smoke ${join(opt.out, "smoke-results.json")}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`models:convert: ${e.message}`);
    process.exitCode = 2;
  }
}
