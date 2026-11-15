#!/usr/bin/env node
/**
 * The manifest of a build output (plan W7.23): every file's SHA-256 and size,
 * with the commit, lockfile, Node and platform it was built with.
 *
 *   node scripts/supply-chain/dist-manifest.mjs [--root .] [--dir dist] [--builder <id>] [--out <file>] [--build-seconds N]
 *
 * Prints the JSON (or writes --out). Cloudflare Workers Builds runs it after
 * `npm run build` (scripts/supply-chain/cf-build.sh); Vercel runs it as the
 * `manifest` gate (npm run build:manifest); any other host can too.
 *
 * From #575 (W10 port, train 6): the functions are importable (builderOf,
 * writeDistManifest), and a build with no package-lock.json gets no manifest
 * (exit 2), as #575's writeManifest did: a manifest that names no lockfile
 * can't show that both hosts built from the same dependencies.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { opts, sha256 } from "./lib.mjs";
import { commitOf, manifestOf, viteEnv } from "./repro-lib.mjs";
import { sourceDate } from "./sbom.mjs";

/** Which infrastructure is building: --builder wins, then Cloudflare Workers Builds, Vercel, else local-<os>. */
export function builderOf(env = process.env, flag = undefined, os = platform()) {
  if (flag) return flag;
  if (env.WORKERS_CI) return "cloudflare-workers-builds";
  if (env.VERCEL) return "vercel";
  return `local-${os}`;
}

/** The manifest of <root>/<dir>; throws when <root>/package-lock.json is missing. */
export function distManifest({ root = ".", dir = "dist", builder, buildSeconds, env = process.env } = {}) {
  const r = resolve(root);
  const lock = resolve(r, "package-lock.json");
  if (!existsSync(lock)) throw new Error(`no package-lock.json in ${r}: a manifest must name the lockfile it was built from`);
  const git = () => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: r, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return manifestOf(resolve(r, dir), {
    commit: commitOf(env, git),
    builder: builderOf(env, builder),
    builtAt: new Date().toISOString(),
    sourceDateEpoch: Math.floor(sourceDate(r).getTime() / 1000),
    lockfileSha256: sha256(readFileSync(lock)),
    node: process.version,
    platform: `${platform()}-${arch()}`,
    viteEnv: viteEnv(env),
    ...(buildSeconds != null ? { buildSeconds: Number(buildSeconds) } : {}),
  });
}

/** Write the manifest to `out` (or return its JSON when no `out`). */
export function writeDistManifest(options = {}, out = undefined) {
  const manifest = distManifest(options);
  const json = JSON.stringify(manifest, null, 1) + "\n";
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), json);
  }
  return { manifest, json };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = opts(process.argv);
  const out = o.get("--out");
  try {
    const { manifest, json } = writeDistManifest({ root: o.get("--root", "."), dir: o.get("--dir", "dist"), builder: o.get("--builder"), buildSeconds: o.get("--build-seconds") }, out);
    if (out) console.error(`${manifest.fileCount} files, ${manifest.bytes} bytes → ${out}`);
    else process.stdout.write(json);
  } catch (e) {
    console.error(`dist-manifest: ${e.message}`);
    process.exit(2);
  }
}
