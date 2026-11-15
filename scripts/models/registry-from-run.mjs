#!/usr/bin/env node
/**
 * Copy a model conversion's results into models/registry.json (plan 6.0):
 * every published file with its sha256, size, licence and attribution, the
 * download size per dtype, and where the files came from.
 *
 *   npm run models:registry -- --dir out/models --smoke out/models/smoke-results.json
 *        what `npm run models:convert` wrote: <folder>/<id>/manifest.json, and the
 *        smoke results (a model whose q8 smoke test failed is not written)
 *   npm run models:registry -- <run id>          # an old GitHub Actions run's annotations (gh);
 *                                                # the workflow is gone (W1.17)
 *
 * The run's manifest annotations ("model-manifest <id>") carry path, sha256
 * and bytes; the licence and attribution come from models/convert-targets.json,
 * the same source the workflow used. A model whose smoke test failed in that
 * run is not written.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, dtypeOf } from "./manifest.mjs";
import { REGISTRY, writeEntries } from "./registry-edit.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "talstilkol/lumen-md";
const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 << 20 }));

/** { id → { files: [[path, sha, bytes]], revision, via, mirror } } and smoke results from a run. */
function fromRun(runId) {
  const manifests = {};
  const smoke = {};
  const jobs = gh(`repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`).jobs;
  for (const job of jobs) {
    for (const a of gh(`repos/${REPO}/check-runs/${job.id}/annotations?per_page=100`)) {
      const title = a.title ?? "";
      if (title.startsWith("model-manifest ")) {
        const m = JSON.parse(a.message);
        manifests[m.id] = m;
      } else if (title.startsWith("smoke ")) {
        const [, id, dtype] = title.split(" ");
        (smoke[id] ??= {})[dtype] = { ok: a.annotation_level === "notice", text: a.message };
      }
    }
  }
  return { manifests, smoke };
}

/** smoke.mjs --out results ([{ id, dtype, ok }]) → { id → { dtype → { ok, text } } }. */
export function smokeFromResults(results) {
  const smoke = {};
  for (const r of results) (smoke[r.id] ??= {})[r.dtype] = { ok: Boolean(r.ok), text: r.ok ? r.output ?? "" : r.error ?? r.output ?? "" };
  return smoke;
}

function fromDir(dir, smokeFile = null) {
  const manifests = {};
  for (const id of readdirSync(dir)) {
    const f = join(dir, id, "manifest.json");
    if (!existsSync(f)) continue;
    const m = JSON.parse(readFileSync(f, "utf8"));
    manifests[m.id] = { ...m, files: m.files.map((x) => [x.path, x.sha256, x.bytes]) };
  }
  return { manifests, smoke: smokeFile ? smokeFromResults(JSON.parse(readFileSync(smokeFile, "utf8"))) : null };
}

const mb = (n) => `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;

function main() {
  const args = process.argv.slice(2);
  const dirAt = args.indexOf("--dir");
  const runId = dirAt >= 0 ? null : args.find((a) => /^\d+$/.test(a));
  if (dirAt < 0 && !runId) {
    console.error("usage: registry-from-run.mjs <run id> | --dir <artifacts folder>");
    process.exit(2);
  }
  const smokeAt = args.indexOf("--smoke");
  const { manifests, smoke } = runId ? fromRun(runId) : fromDir(args[dirAt + 1], smokeAt >= 0 ? args[smokeAt + 1] : null);
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const entries = [];
  for (const t of TARGETS.models) {
    const m = manifests[t.id];
    if (!m) {
      console.error(`· ${t.id}: no manifest in ${runId ? `run ${runId}` : "the folder"} — left as it is`);
      continue;
    }
    if (smoke && smoke[t.id]?.q8 && !smoke[t.id].q8.ok) {
      console.error(`✗ ${t.id}: its q8 smoke test failed in ${runId ? `run ${runId}` : "the smoke results"} — not written`);
      continue;
    }
    const current = registry.models.find((e) => e.id === t.id);
    if (!current) {
      console.error(`✗ ${t.id}: no registry entry to update`);
      continue;
    }
    const files = m.files.map(([path, sha256, bytes]) => ({ path, sha256, bytes, dtype: dtypeOf(path.split("/").pop()) ?? "config", license: t.license, attribution: t.attribution }));
    const size = TARGETS.keep
      .filter((d) => files.some((f) => f.dtype === d))
      .map((d) => `${mb(files.filter((f) => f.dtype === d || f.dtype === "config").reduce((s, f) => s + f.bytes, 0))} (${d})`)
      .join(" / ");
    const from = m.via === "mirror" ? `the existing ONNX mirror ${m.mirror} (not converted: it passed the smoke test)` : `converted from ${t.hf}@${String(m.revision).slice(0, 12)}`;
    const q4 = smoke?.[t.id]?.q4f16;
    entries.push({
      ...current,
      size,
      notes:
        `${from} by ${runId ? `docs/archive/workflows/model-convert.yml run ${runId}` : "scripts/models/convert.mjs"} (plan 6.0); loads in transformers.js 4.3 in Chromium (q8${q4 ? `; q4f16 ${q4.ok ? "too" : "needs WebGPU, not tested in CI"}` : ""}). ` +
        `Downloaded only with consent, size shown first, verified against these checksums and cached in OPFS; not downloadable until the host is chosen (15.9).` +
        (t.license.startsWith("CC-BY") ? " CC BY 4.0: the attribution must be shown where the model is offered." : ""),
      build: { run: runId ?? undefined, revision: m.revision, via: m.via, ...(m.mirror ? { mirror: m.mirror } : {}) },
      files,
    });
    console.error(`✓ ${t.id}: ${files.length} files, ${size}`);
  }
  if (entries.length) writeEntries(entries, new Date().toISOString().slice(0, 10));
}

// Run only as a script, so the helpers can be imported (src/__tests__/modelConvertLocal.test.ts).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
