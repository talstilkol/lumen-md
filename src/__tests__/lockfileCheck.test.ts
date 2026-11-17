/**
 * W13.X6 — install without scripts, and lockfile hygiene. With the repo's
 * .npmrc (ignore-scripts=true), a dependency's postinstall does not run
 * (shown with real npm, offline, on a packed tarball; and shown to run
 * without it, so the test proves something). Only what
 * scripts/supply/allow-scripts.json allows runs, on purpose. Every lockfile
 * resolves from the npm registry over https with sha512 integrity; a
 * foreign host, http, git, a weak or missing hash, or an unreviewed install
 * script fails.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — a plain .mjs script
import { checkLockfile, findLockfiles, run } from "../../scripts/supply/lockfile-check.mjs";
// @ts-expect-error — a plain .mjs script
import { allowedToRun } from "../../scripts/supply/allowed-scripts.mjs";

const ROOT = resolve(__dirname, "../..");
const allowScripts = JSON.parse(readFileSync(join(ROOT, "scripts/supply/allow-scripts.json"), "utf8"));
const SHA512 = "sha512-" + "A".repeat(86) + "==";
const pkg = (extra: Record<string, unknown> = {}) => ({ version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz", integrity: SHA512, ...extra });
const lock = (packages: Record<string, unknown>) => ({ lockfileVersion: 3, packages: { "": { name: "x", dependencies: { a: "1" } }, ...packages } });

describe("the lockfile check", () => {
  it("every lockfile in the repo passes, and there are several", () => {
    const files = findLockfiles(ROOT);
    expect(files.length).toBeGreaterThanOrEqual(2);
    const r = run(files, { root: ROOT });
    expect(r.problems).toEqual([]);
    expect(r.checked).toBeGreaterThan(1000);
  });

  it("a foreign host, http, git, a tarball URL elsewhere: each fails, naming the host", () => {
    const bad = checkLockfile(
      lock({
        "node_modules/a": pkg({ resolved: "https://evil.example/a-1.0.0.tgz" }),
        "node_modules/b": pkg({ resolved: "http://registry.npmjs.org/b/-/b-1.0.0.tgz" }),
        "node_modules/c": pkg({ resolved: "git+ssh://git@github.com/x/c.git#abc" }),
        "node_modules/d": pkg({ resolved: "https://registry.npmjs.org.evil.example/d.tgz" }),
        "node_modules/e": pkg({ resolved: undefined }),
      }),
      { allowScripts },
    ).problems;
    expect(bad).toEqual([
      "package-lock.json: a: resolved from https://evil.example, not https://registry.npmjs.org/",
      "package-lock.json: b: resolved from http://registry.npmjs.org, not https://registry.npmjs.org/",
      "package-lock.json: c: resolved from git+ssh://github.com, not https://registry.npmjs.org/",
      "package-lock.json: d: resolved from https://registry.npmjs.org.evil.example, not https://registry.npmjs.org/",
      'package-lock.json: e: no "resolved" URL',
    ]);
  });

  it("integrity must be sha512", () => {
    const r = checkLockfile(lock({ "node_modules/a": pkg({ integrity: "sha1-abc=" }), "node_modules/b": pkg({ integrity: undefined }), "node_modules/c": pkg({ integrity: "sha512-short" }) }), { allowScripts }).problems;
    expect(r).toEqual(["package-lock.json: a: integrity is sha1, not sha512", "package-lock.json: b: integrity is missing, not sha512", "package-lock.json: c: integrity is sha512, not sha512"]);
  });

  it("an install script must be reviewed; bundled packages and links are skipped; an empty lockfile of a project with dependencies fails", () => {
    expect(checkLockfile(lock({ "node_modules/evil-miner": pkg({ hasInstallScript: true }) }), { allowScripts }).problems).toEqual([expect.stringMatching(/evil-miner has an install script and is not in scripts\/supply\/allow-scripts\.json/)]);
    expect(checkLockfile(lock({ "node_modules/x/node_modules/esbuild": pkg({ hasInstallScript: true }), "node_modules/fsevents": pkg({ hasInstallScript: true }) }), { allowScripts }).problems).toEqual([]);
    expect(checkLockfile(lock({ "node_modules/a": pkg(), "node_modules/a/node_modules/b": { version: "1", inBundle: true }, "node_modules/w": { link: true, resolved: "packages/w" } }), { allowScripts }).problems).toEqual([]);
    expect(checkLockfile(lock({}), { allowScripts }).problems).toEqual(["package-lock.json: no packages to check"]);
    expect(checkLockfile({ lockfileVersion: 3, packages: { "": { name: "no-deps" } } }, { allowScripts }).problems).toEqual([]);
  });

  it("the CLI: 0 on the repo, 1 on a bad lockfile, 2 with nothing to check", () => {
    const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/supply/lockfile-check.mjs"), ...a], { encoding: "utf8" });
    expect(cli().status).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock({ "node_modules/a": pkg({ resolved: "https://evil.example/a.tgz" }) })));
    const r = cli(join(dir, "package-lock.json"));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/resolved from https:\/\/evil\.example/);
    expect(cli(join(dir, "nope.json")).status).toBe(2);
  });

  it("allowedToRun picks only allowed packages that have an install script", () => {
    const l = { packages: { "": {}, "node_modules/tsx/node_modules/esbuild": { hasInstallScript: true }, "node_modules/protobufjs": { hasInstallScript: true }, "node_modules/esbuild": {} } };
    expect(allowedToRun(l, allowScripts)).toEqual(["node_modules/tsx/node_modules/esbuild"]);
  });
});

describe("install without scripts (real npm, offline)", () => {
  const npm = (cwd: string, ...a: string[]) => spawnSync("npm", a, { cwd, encoding: "utf8", env: { ...process.env, npm_config_cache: join(cwd, ".cache"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" }, timeout: 120_000 });
  const hasNpm = spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!hasNpm)("a dependency's postinstall runs without the repo's .npmrc, and does not run with it (skipped only where npm is absent)", () => {
    const work = mkdtempSync(join(tmpdir(), "noscripts-"));
    const dep = join(work, "evil-dep");
    mkdirSync(dep);
    // The script writes a marker into the project that installs it (INIT_CWD).
    writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "evil-dep", version: "1.0.0", scripts: { postinstall: "node -e \"require('fs').writeFileSync(require('path').join(process.env.INIT_CWD, 'PWNED'), 'x')\"" } }));
    const packed = npm(dep, "pack", "--pack-destination", work);
    expect(packed.status, packed.stderr).toBe(0);
    const tgz = join(work, "evil-dep-1.0.0.tgz");
    const project = (name: string, withNpmrc: boolean) => {
      const p = join(work, name);
      mkdirSync(p);
      writeFileSync(join(p, "package.json"), JSON.stringify({ name, version: "1.0.0", private: true }));
      if (withNpmrc) copyFileSync(join(ROOT, ".npmrc"), join(p, ".npmrc"));
      const r = npm(p, "install", tgz);
      expect(r.status, r.stderr).toBe(0);
      return p;
    };
    // Control: without ignore-scripts the postinstall runs (so the check below means something).
    expect(existsSync(join(project("plain", false), "PWNED"))).toBe(true);
    // With the repo's .npmrc: it does not.
    const safe = project("safe", true);
    expect(existsSync(join(safe, "PWNED"))).toBe(false);
    const l = JSON.parse(readFileSync(join(safe, "package-lock.json"), "utf8"));
    expect(l.packages["node_modules/evil-dep"].hasInstallScript).toBe(true);
    // It is not on the allow list, so the explicit runner would not run it either.
    expect(allowedToRun(l, allowScripts)).toEqual([]);
  });
});
