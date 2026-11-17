/**
 * Write dataset.revision into eval/public manifests that have none yet
 * (wave g6, Mac pack L5): the step before `npm run eval:public -- fetch <id> --pin`,
 * which pins only the files' sha256s. Run where there is network:
 *
 *   node scripts/eval-public/pin-revision.mjs asr-fleurs-he asr-ivrit-eval-d1 …
 *   node scripts/eval-public/pin-revision.mjs <id> --sha <40-hex>     # a revision chosen by hand
 *
 * Hugging Face: the dataset's current main commit (GET /api/datasets/<id>/revision/main).
 * GitHub: `git ls-remote <url> HEAD`. A manifest that already has a revision
 * is left alone (exit 1 names it): a pin changes only by hand, in review.
 * Prints one JSON line per manifest: {id, revision, status}.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HEX40 = /^[0-9a-f]{40}$/;

export async function resolveRevision(dataset, { fetchImpl = globalThis.fetch, git = (url) => spawnSync("git", ["ls-remote", url, "HEAD"], { encoding: "utf8" }) } = {}) {
  if (dataset.hub === "huggingface") {
    const r = await fetchImpl(`https://huggingface.co/api/datasets/${dataset.id}/revision/main`, {
      signal: AbortSignal.timeout(20_000),
      headers: process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {},
    });
    if (!r.ok) throw new Error(`huggingface.co answered ${r.status} for ${dataset.id} (gated? accept its terms on the Hub and set HF_TOKEN)`);
    const sha = (await r.json()).sha;
    if (!HEX40.test(sha ?? "")) throw new Error(`no commit sha for ${dataset.id}`);
    return sha;
  }
  if (dataset.hub === "github") {
    const out = git(dataset.url);
    const sha = (out.stdout ?? "").split(/\s/)[0];
    if (out.status !== 0 || !HEX40.test(sha)) throw new Error(`git ls-remote ${dataset.url} failed`);
    return sha;
  }
  throw new Error(`hub "${dataset.hub}" has no revision to resolve: set dataset.revision by hand (--sha)`);
}

export async function pin(ids, { dir = join(root, "eval/public"), sha, ...deps } = {}) {
  const rows = [];
  for (const id of ids) {
    const path = join(dir, `${id}.json`);
    const m = JSON.parse(readFileSync(path, "utf8"));
    if (m.dataset.revision) {
      rows.push({ id, revision: m.dataset.revision, status: "already pinned" });
      continue;
    }
    if (sha && !HEX40.test(sha)) throw new Error(`--sha must be 40 hex characters`);
    const revision = sha ?? (await resolveRevision(m.dataset, deps));
    m.dataset.revision = revision;
    writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
    rows.push({ id, revision, status: "pinned" });
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--sha");
  const sha = i >= 0 ? argv[i + 1] : undefined;
  const ids = argv.filter((a, k) => !a.startsWith("--") && !(i >= 0 && k === i + 1));
  if (ids.length === 0) {
    console.error("usage: node scripts/eval-public/pin-revision.mjs <manifest id>… [--sha <40-hex>]");
    process.exit(2);
  }
  try {
    const rows = await pin(ids, { sha });
    for (const r of rows) console.log(JSON.stringify(r));
    process.exit(rows.some((r) => r.status !== "pinned") ? 1 : 0);
  } catch (e) {
    console.error(`pin-revision: ${e.message}`);
    process.exit(2);
  }
}
