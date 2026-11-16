// @vitest-environment node
/**
 * Plan W8.11: generated help shards (src/help/generated/*.json) never stop a
 * merge. Two branches that change different docs pages merge cleanly in
 * docs/, and the shards are rebuilt from the merged docs: by the merge
 * driver plus `node scripts/help-bundle.mjs`, and by scripts/lane-merge.sh
 * inside each merge. On a throw-away repository with the real scripts.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-help-merge-"));
  const work = join(dir, "repo");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
  for (const tool of ["npx", "npm"]) chmodSync(join(bin, tool), 0o755);
  writeFileSync(join(dir, "gitconfig"), "");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    LANE_SKIP_TESTS: "1",
  };
  execFileSync("git", ["init", "-q", "-b", "main", work], { env });
  const g = (...a: string[]) => execFileSync("git", ["-c", "rerere.enabled=false", ...a], { cwd: work, env, encoding: "utf8" }).trim();
  const put = (p: string, t: string) => {
    mkdirSync(dirname(join(work, p)), { recursive: true });
    writeFileSync(join(work, p), t);
  };
  for (const f of ["scripts/help-bundle.mjs", "scripts/help-merge-driver.mjs", "scripts/lane-merge.sh", "scripts/git-setup.mjs", ".gitattributes"]) {
    mkdirSync(dirname(join(work, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(work, f));
  }
  put("scripts/extract-i18n-keys.mjs", "process.exit(0);\n");
  const page = (title: string, text: string) => `---\ntitle: ${title}\n---\n\n## Intro\n\n${text}\n`;
  for (const [p, t] of [
    ["docs/src/content/docs/alpha.md", page("Alpha", "first page")],
    ["docs/src/content/docs/beta.md", page("Beta", "second page")],
    ["docs/src/content/docs/he/alpha.md", page("אלפא", "עמוד ראשון")],
    ["docs/src/content/docs/he/beta.md", page("בטא", "עמוד שני")],
  ])
    put(p, t);
  const bundle = (...a: string[]) => spawnSync(process.execPath, ["scripts/help-bundle.mjs", ...a], { cwd: work, env, encoding: "utf8" });
  expect(bundle().status).toBe(0);
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  // Two lanes, each changing a different page, each with its rebuilt bundle.
  const lane = (name: string, file: string, text: string) => {
    g("checkout", "-q", "-b", name, "main");
    put(file, page(name, text));
    expect(bundle().status).toBe(0);
    g("add", "-A");
    g("commit", "-q", "-m", name);
  };
  lane("lane-a", "docs/src/content/docs/alpha.md", "alpha changed by lane a");
  lane("lane-b", "docs/src/content/docs/beta.md", "beta changed by lane b");
  g("checkout", "-q", "main");
  const shard = () => readFileSync(join(work, "src/help/generated/help.en.0.json"), "utf8");
  return { dir, work, env, g, bundle, shard, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const conflicted = (g: (...a: string[]) => string) => g("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);

describe("help shards and merges (W8.11)", () => {
  it("without the driver, two docs edits conflict in the generated shard (the problem)", () => {
    const r = setup();
    try {
      r.g("checkout", "-q", "lane-a");
      expect(() => r.g("merge", "-q", "--no-ff", "--no-edit", "lane-b")).toThrow();
      expect(conflicted(r.g)).toEqual(["src/help/generated/help.en.0.json"]);
    } finally {
      r.done();
    }
  });

  it("with the driver: no conflict, and help-bundle rebuilds a shard that --check accepts and that has both edits", () => {
    const r = setup();
    try {
      expect(spawnSync(process.execPath, ["scripts/help-merge-driver.mjs", "--install"], { cwd: r.work, env: r.env }).status).toBe(0);
      expect(r.g("config", "merge.lumen-help.driver")).toBe("node scripts/help-merge-driver.mjs %O %A %B %P");
      r.g("checkout", "-q", "lane-a");
      r.g("merge", "-q", "--no-ff", "--no-edit", "lane-b");
      expect(conflicted(r.g)).toEqual([]);
      // The driver kept ours: the bundle is stale until it is rebuilt.
      const stale = r.bundle("--check");
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("help.en.0.json is out of date");
      expect(r.bundle().status).toBe(0);
      const ok = r.bundle("--check");
      expect(ok.status).toBe(0);
      expect(ok.stderr).toContain("✓ help bundle");
      expect(r.shard()).toContain("alpha changed by lane a");
      expect(r.shard()).toContain("beta changed by lane b");
    } finally {
      r.done();
    }
  });

  it("a clone that ran npm install (prepare → git-setup.mjs) merges with 0 help conflicts, no --install by hand", () => {
    const r = setup();
    try {
      // package.json's prepare is what npm install runs in every clone.
      expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.prepare).toBe("node scripts/git-setup.mjs");
      const gs = (...a: string[]) => spawnSync(process.execPath, ["scripts/git-setup.mjs", ...a], { cwd: r.work, env: r.env, encoding: "utf8" });
      expect(gs("--check").status).toBe(1);
      const first = gs();
      expect(first.status).toBe(0);
      expect(first.stderr).toContain("merge.lumen-help.driver");
      expect(gs("--check").status).toBe(0);
      expect(gs().stderr).toBe(""); // idempotent: nothing left to write
      expect(r.g("config", "--local", "merge.lumen-help.driver")).toBe("node scripts/help-merge-driver.mjs %O %A %B %P");
      // The lanes driver's script is not in this checkout: git-setup leaves it alone.
      expect(() => r.g("config", "--local", "merge.lumen-lanes.driver")).toThrow();
      r.g("checkout", "-q", "lane-a");
      r.g("merge", "-q", "--no-ff", "--no-edit", "lane-b");
      expect(conflicted(r.g)).toEqual([]);
    } finally {
      r.done();
    }
  });

  it("git-setup never fails an install: outside a work tree, or switched off, it writes nothing and exits 0", () => {
    const r = setup();
    try {
      const out = mkdtempSync(join(tmpdir(), "lumen-no-git-"));
      mkdirSync(join(out, "scripts"));
      copyFileSync(join(ROOT, "scripts/git-setup.mjs"), join(out, "scripts/git-setup.mjs"));
      copyFileSync(join(ROOT, "scripts/help-merge-driver.mjs"), join(out, "scripts/help-merge-driver.mjs"));
      const bare = spawnSync(process.execPath, ["scripts/git-setup.mjs"], { cwd: out, env: { ...r.env, GIT_CEILING_DIRECTORIES: tmpdir() }, encoding: "utf8" });
      expect(bare.status).toBe(0);
      expect(bare.stderr).toBe("");
      rmSync(out, { recursive: true, force: true });
      const off = spawnSync(process.execPath, ["scripts/git-setup.mjs"], { cwd: r.work, env: { ...r.env, LUMEN_NO_GIT_SETUP: "1" }, encoding: "utf8" });
      expect(off.status).toBe(0);
      expect(() => r.g("config", "--local", "merge.lumen-help.driver")).toThrow();
      // With the lanes driver present, both are set, with the same values their own --install writes.
      mkdirSync(join(r.work, "scripts/lanes"), { recursive: true });
      for (const f of ["merge-driver.mjs", "globs.mjs", "leases.mjs"]) copyFileSync(join(ROOT, "scripts/lanes", f), join(r.work, "scripts/lanes", f));
      expect(spawnSync(process.execPath, ["scripts/git-setup.mjs"], { cwd: r.work, env: r.env }).status).toBe(0);
      const after = r.g("config", "--local", "--get-regexp", "^merge\\.");
      expect(spawnSync(process.execPath, ["scripts/lanes/merge-driver.mjs", "--install"], { cwd: r.work, env: r.env }).status).toBe(0);
      expect(spawnSync(process.execPath, ["scripts/help-merge-driver.mjs", "--install"], { cwd: r.work, env: r.env }).status).toBe(0);
      expect(r.g("config", "--local", "--get-regexp", "^merge\\.")).toBe(after);
      expect(after).toContain("merge.lumen-lanes.driver node scripts/lanes/merge-driver.mjs %O %A %B %P");
    } finally {
      r.done();
    }
  });

  it("scripts/lane-merge.sh merges both lanes with 0 help conflicts and rebuilds the bundle inside each merge", () => {
    const r = setup();
    try {
      r.g("branch", "train", "main");
      const run = spawnSync("bash", ["scripts/lane-merge.sh", "train", "lane-a", "lane-b"], { cwd: r.work, env: r.env, encoding: "utf8" });
      expect(run.stderr).not.toContain("STOP");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("help:    up to date");
      expect(r.g("log", "-1", "--format=%B", "train")).toContain("Generated files: rebuilt src/help/generated/ (stale after the merge)");
      expect(r.bundle("--check").status).toBe(0);
      expect(r.shard()).toContain("alpha changed by lane a");
      expect(r.shard()).toContain("beta changed by lane b");
      expect(r.g("status", "--porcelain")).toBe("");
    } finally {
      r.done();
    }
  });

  it("lane-merge.sh without the driver configured still rebuilds a conflicted shard instead of stopping", () => {
    const r = setup();
    try {
      // A target whose checkout has no driver script: the shard conflicts, and is regenerated.
      r.g("checkout", "-q", "-b", "train", "main");
      r.g("rm", "-q", "scripts/help-merge-driver.mjs");
      r.g("commit", "-q", "-m", "no driver");
      r.g("checkout", "-q", "main");
      const run = spawnSync("bash", ["scripts/lane-merge.sh", "train", "lane-a", "lane-b"], { cwd: r.work, env: r.env, encoding: "utf8" });
      expect(run.stderr).not.toContain("STOP");
      expect(run.status).toBe(0);
      expect(r.g("log", "-1", "--format=%B", "train")).toMatch(/Generated files: regenerated src\/help\/generated\/help\.en\.0\.json/);
      expect(r.bundle("--check").status).toBe(0);
      expect(r.shard()).toContain("beta changed by lane b");
    } finally {
      r.done();
    }
  });
});
