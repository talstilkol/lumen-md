/**
 * W13.L6 — `npm run plugins:review -- --ref <folder | git-url#sha>`: the
 * registry's review on any branch, tag or commit, before submission, in
 * three tiers (failures, warnings, suggestions), as JSON and Markdown. A
 * ref with eval fails; a clean ref gets its scorecard and exit 0.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const review = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/review-plugins.mjs"), ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

describe("plugins:review --ref", () => {
  it("a clean folder: exit 0, a scorecard with no failures, warnings and suggestions listed", () => {
    const out = join(mkdtempSync(join(tmpdir(), "prev-")), "p.json");
    const r = review("--ref", "fixtures/plugins/good", "--json", out);
    expect(r.status, r.stderr).toBe(0);
    const p = JSON.parse(readFileSync(out, "utf8"));
    expect(p).toMatchObject({ kind: "lumen-plugin-preview", id: "org.example.reading-time", version: "1.0.0", passed: true, failures: [] });
    expect(p.warnings.map((w: { rule: string }) => w.rule)).toEqual(["unsigned"]);
    expect(p.suggestions.map((s: { rule: string }) => s.rule)).toContain("author-signature");
    expect(r.stdout).toMatch(/^## ✅ org\.example\.reading-time@1\.0\.0 — grade A/m);
    expect(r.stdout).toMatch(/### Failures \(0\)/);
  });

  it("eval fails the ref: exit 1, the failure named with its line", () => {
    const r = review("--ref", "fixtures/plugins/eval");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/## ❌ org\.example\.calc@1\.0\.0 — would not be listed/);
    expect(r.stdout).toMatch(/\| `eval` \| main: eval\(…\) \(line 4\) \|/);
  });

  it("any commit of a git repository: the clean commit passes, the later one with eval fails, each named by its sha", () => {
    const repo = mkdtempSync(join(tmpdir(), "plugin-repo-"));
    git(repo, "init", "-q", "-b", "main");
    cpSync(join(ROOT, "fixtures/plugins/good"), join(repo, "plugin"), { recursive: true });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "clean");
    const clean = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "plugin/main.js"), readFileSync(join(repo, "plugin/main.js"), "utf8") + "\nnew Function('return 1')();\n");
    git(repo, "commit", "-q", "-am", "dynamic code");
    const bad = git(repo, "rev-parse", "HEAD");
    const ok = review("--ref", `file://${repo}#${clean}:plugin`);
    expect(ok.status, ok.stderr + ok.stdout).toBe(0);
    expect(ok.stdout).toContain(`at \`${clean.slice(0, 12)}\``);
    const fail = review("--ref", `file://${repo}#${bad}:plugin`);
    expect(fail.status).toBe(1);
    expect(fail.stdout).toMatch(/`eval` \| main: new Function/);
    // A branch name works too, and resolves to the latest commit.
    expect(review("--ref", `file://${repo}#main:plugin`).status).toBe(1);
  });

  it("a bad ref is a usage error (exit 2), never a pass", () => {
    expect(review("--ref", "fixtures/plugins").status).toBe(2);
    expect(review("--ref", "ftp://example.com/x.git#abc").status).toBe(2);
    expect(review("--ref", "file:///nope#--upload-pack=evil").status).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), "nothing-"));
    expect(review("--ref", empty).status).toBe(2);
  });
});
