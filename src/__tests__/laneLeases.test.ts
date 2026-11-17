/**
 * R12.13 — file leases, task claims and merge rules for parallel lanes, in
 * throwaway git repositories: a commit outside the lane's lease is refused
 * by the pre-commit hook with a Hebrew message; a synthetic merge of three
 * lanes ends with no manual conflict in generated files or the sorted list;
 * a task cannot be claimed twice. Clean reimplementation (design reference
 * only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { globToRegExp, installHook, outsideLease, overlaps, refusalMessage } from "../../scripts/lanes/leases.mjs";
import { claim, listClaims, release } from "../../scripts/lanes/claims.mjs";
import { unionSorted } from "../../scripts/lanes/merge-driver.mjs";

const REPO = resolve(__dirname, "../..");
let dir = "";
const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], { cwd: dir, encoding: "utf8" });
const put = (p: string, s: string) => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), s);
};
function seedRepo(leases: object) {
  git("init", "-q");
  for (const f of ["scripts/lanes/globs.mjs", "scripts/lanes/leases.mjs", "scripts/lanes/claims.mjs", "scripts/lanes/merge-driver.mjs", ".githooks/pre-commit"]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(REPO, f), join(dir, f));
  }
  chmodSync(join(dir, ".githooks/pre-commit"), 0o755);
  put("plan/LEASES.json", JSON.stringify(leases, null, 2));
  git("add", "-A");
  git("commit", "-q", "-m", "base");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lanes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const LEASES = {
  shared: ["i18n/keys/*.json"],
  lanes: { A: { globs: ["src/agents/**"] }, U: { globs: ["src/ui/", "src/views/**/*.tsx"] } },
  merge: [
    { glob: "plan/lanes/**/*.md", rule: "lane" },
    { glob: "plan/lanes/*.list", rule: "union" },
    { glob: "i18n/keys/*.json", rule: "train", regen: "node scripts/extract-i18n-keys.mjs" },
  ],
};

describe("R12.13 leases", () => {
  it("globs", () => {
    expect(globToRegExp("src/agents/**").test("src/agents/defs/x.ts")).toBe(true);
    expect(globToRegExp("src/ui/").test("src/ui/a/b.tsx")).toBe(true);
    expect(globToRegExp("src/views/**/*.tsx").test("src/views/a.tsx")).toBe(true);
    expect(globToRegExp("i18n/keys/*.json").test("i18n/keys/sub/a.json")).toBe(false);
  });

  it("paths outside the lease, and overlapping leases", () => {
    expect(outsideLease(LEASES, "A", ["src/agents/x.ts", "i18n/keys/cmd.json", "src/ui/A.tsx"])).toEqual(["src/ui/A.tsx"]);
    expect(outsideLease(LEASES, "nobody", ["src/agents/x.ts"])).toEqual(["src/agents/x.ts"]);
    expect(overlaps(LEASES)).toEqual([]);
    expect(overlaps({ ...LEASES, lanes: { ...LEASES.lanes, B: { globs: ["src/agents/defs/**"] } } }).map((o: { a: string; b: string }) => `${o.a}+${o.b}`)).toEqual(["A+B"]);
  });

  it("the pre-commit hook refuses a file outside the lease, in Hebrew; inside passes; no lane set: no check", () => {
    seedRepo(LEASES);
    put("src/ui/Panel.tsx", "x");
    git("add", "src/ui/Panel.tsx");
    const hook = (env: Record<string, string>) => spawnSync("sh", [".githooks/pre-commit"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    const refused = hook({ LUMEN_LANE: "A" });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("הקומיט נדחה");
    expect(refused.stderr).toContain("src/ui/Panel.tsx");
    expect(hook({ LUMEN_LANE: "U" }).status).toBe(0);
    expect(hook({ LUMEN_LANE: "" }).status).toBe(0);
    expect(refusalMessage("A", ["a", "b"])).toMatch(/2 הקבצים/);
  });
});

describe("R12.13 the hook is on without a manual step", () => {
  it("install-hook turns it on, a real commit outside the lease is refused and inside passes; idempotent; another hooksPath is left alone", () => {
    seedRepo(LEASES);
    expect(installHook(dir)).toBe("installed");
    expect(git("config", "--get", "core.hooksPath").trim()).toBe(".githooks");
    expect(installHook(dir)).toBe("already");
    const commit = (lane: string) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"], { cwd: dir, encoding: "utf8", env: { ...process.env, LUMEN_LANE: lane } });
    put("src/ui/Panel.tsx", "x");
    git("add", "src/ui/Panel.tsx");
    const refused = commit("A");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("הקומיט נדחה");
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);
    expect(commit("U").status).toBe(0);
    git("config", "core.hooksPath", "my-hooks");
    expect(installHook(dir)).toBe("other");
    expect(git("config", "--get", "core.hooksPath").trim()).toBe("my-hooks");
  });

  it("scripts/lane.sh runs install-hook for every lane it opens", () => {
    const sh = readFileSync(join(REPO, "scripts/lane.sh"), "utf8");
    const add = sh.indexOf('git worktree add --quiet -b "$name" "$dir" "$base"');
    const install = sh.indexOf('scripts/lanes/leases.mjs" install-hook');
    expect(add).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(add);
  });
});

describe("R12.13 merge rules: three lanes into a train", () => {
  it("no manual conflict in generated files, status files or the sorted list", () => {
    seedRepo(LEASES);
    put(".gitattributes", "i18n/keys/*.json merge=lumen-lanes\nplan/lanes/** merge=lumen-lanes\n");
    put("i18n/keys/cmd.json", '{\n  "a": 1\n}\n');
    put("plan/lanes/tasks.list", "R1\nR5\n");
    put("plan/lanes/A/STATE.md", "# A\n");
    put("src/shared.ts", "export const x = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "train base");
    for (const [lane, key, task] of [["A", "b", "R2"], ["U", "c", "R3"], ["D", "d", "R4"]]) {
      git("checkout", "-q", "-b", `lane-${lane}`, "main");
      put("i18n/keys/cmd.json", `{\n  "a": 1,\n  "${key}": 2\n}\n`);
      put("plan/lanes/tasks.list", `R1\n${task}\nR5\n`);
      put("plan/lanes/A/STATE.md", `# A\nlane ${lane} was here\n`);
      put(`src/${lane}.ts`, `export const ${lane} = 1;\n`);
      git("add", "-A");
      git("commit", "-q", "-m", `lane ${lane}`);
    }
    git("checkout", "-q", "main");
    const driver = `node ${join(dir, "scripts/lanes/merge-driver.mjs")} %O %A %B %P`;
    for (const lane of ["A", "U", "D"]) {
      const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", `merge.lumen-lanes.driver=${driver}`, "-c", "rerere.enabled=false", "merge", "--no-ff", "-q", "-m", `merge ${lane}`, `lane-${lane}`], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    expect(git("diff", "--name-only", "--diff-filter=U")).toBe("");
    expect(readFileSync(join(dir, "plan/lanes/tasks.list"), "utf8")).toBe("R1\nR2\nR3\nR4\nR5\n");
    // Generated: the train's side, rebuilt after the merge (lane-merge.sh / the regen note).
    expect(readFileSync(join(dir, "i18n/keys/cmd.json"), "utf8")).not.toContain("<<<<<<<");
    expect(readFileSync(join(dir, "plan/lanes/A/STATE.md"), "utf8")).not.toContain("<<<<<<<");
    for (const lane of ["A", "U", "D"]) expect(readFileSync(join(dir, `src/${lane}.ts`), "utf8")).toContain(lane);
  });

  it("union keeps both sides' additions and drops what either side removed", () => {
    expect(unionSorted("a\nb\nc\n", "a\nc\nd\n", "a\nb\nc\ne\n")).toBe("a\nc\nd\ne\n");
  });
});

describe("R12.13 task claims", () => {
  it("a task is not claimed twice; the holder may release it", () => {
    const claims = join(dir, "claims");
    expect(claim(claims, "R12.6", "A")).toEqual({ ok: true });
    expect(claim(claims, "R12.6", "U")).toMatchObject({ ok: false, by: "A" });
    expect(claim(claims, "R12.6", "A")).toEqual({ ok: true });
    expect(release(claims, "R12.6", "U")).toBe(false);
    expect(release(claims, "R12.6", "A")).toBe(true);
    expect(claim(claims, "R12.6", "U")).toEqual({ ok: true });
    expect(listClaims(claims).map((c: { task: string; lane: string }) => `${c.task}:${c.lane}`)).toEqual(["R12.6:U"]);
    expect(() => claim(claims, "../x", "A")).toThrow();
  });
});
