// @vitest-environment node
/**
 * Plan W10.A14: `npm run train:offline -- --all` runs every offline gate and
 * writes reports/train-offline-<sha>.json only when all are green on a clean
 * tree; a broken import is red in seconds (the fail-fast first gate) and then
 * no receipt is written.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { COMMAND_GATES, TEST_GATES, allGreen, expectedGates, gateCommand, isSha, porcelainFiles, receiptPath, receiptProblems, record, refusal, runGates } from "../../scripts/lib/trainReceipt.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { receiptTestFiles, runnerHelpers, runnerSha256, testGates } from "../../scripts/train-offline.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { brokenImports, resolves, specifiers } from "../../scripts/lib/importCheck.mjs";

const repo = resolve(__dirname, "../..");
const SHA = "a".repeat(40);

describe("the gate list", () => {
  it("starts with the fail-fast import check and holds every gate the task names", () => {
    expect(COMMAND_GATES[0]).toMatchObject({ id: "imports", failFast: true });
    const ids = COMMAND_GATES.map((g: { id: string }) => g.id);
    for (const id of ["typecheck", "code-hygiene", "max-lines", "live-seams", "flags", "plan", "dod-rule", "dod-done", "i18n", "rust-std"]) expect(ids).toContain(id);
    // Review 10, M5: the std-only Rust crates are built and run (0 tests is red).
    expect(COMMAND_GATES.find((g: { id: string }) => g.id === "rust-std")).toMatchObject({ cmd: "node scripts/rust-std-tests.mjs" });
    expect(TEST_GATES).toEqual(expect.arrayContaining(["src/__tests__/skipAudit.test.ts", "src/__tests__/codeHealth.test.ts", "src/__tests__/settingsSchema.test.ts"]));
    for (const f of TEST_GATES) expect(existsSync(join(repo, f)), f).toBe(true);
  });

  it("runs every ✅ task's dod (plan 0.7), through the offline runner when one is given", () => {
    const g = COMMAND_GATES.find((x: { id: string }) => x.id === "dod-done");
    expect(g).toMatchObject({ cmd: "node scripts/dod.mjs --done", withRunner: true });
    expect(g.failFast).toBeFalsy();
    expect(gateCommand(g, null)).toBe("node scripts/dod.mjs --done");
    expect(gateCommand(g, "/x/v4.sh")).toBe("node scripts/dod.mjs --done --runner '/x/v4.sh'");
    expect(gateCommand(g, "/a b/it's.sh")).toBe("node scripts/dod.mjs --done --runner '/a b/it'\\''s.sh'");
    // the other command gates do not take the runner
    expect(gateCommand(COMMAND_GATES[0], "/x/v4.sh")).toBe(COMMAND_GATES[0].cmd);
  });

  it("names the receipt after the full commit hash", () => {
    expect(receiptPath(SHA)).toBe(`reports/train-offline-${SHA}.json`);
    expect(isSha(SHA)).toBe(true);
    expect(isSha("1a184547ae")).toBe(false);
  });
});

describe("runGates", () => {
  it("stops after a red fail-fast gate and runs nothing after it", () => {
    const ran: string[] = [];
    const res = runGates([{ id: "imports", failFast: true }, { id: "typecheck" }, { id: "x.test.ts" }], (g: { id: string }) => {
      ran.push(g.id);
      return { ok: g.id !== "imports" };
    });
    expect(ran).toEqual(["imports"]);
    expect(res.map((r: { status: string }) => r.status)).toEqual(["fail", "skip", "skip"]);
    expect(allGreen(res)).toBe(false);
  });

  it("runs every gate after a red ordinary gate", () => {
    const res = runGates([{ id: "a" }, { id: "b" }, { id: "c" }], (g: { id: string }) => ({ ok: g.id !== "a" }));
    expect(res.map((r: { status: string }) => r.status)).toEqual(["fail", "pass", "pass"]);
  });
});

describe("refusal: no receipt on red", () => {
  const green = [{ id: "a", status: "pass" }, { id: "b", status: "pass" }];
  it("allows a receipt only when every gate passed on a clean tree", () => {
    expect(refusal({ results: green, sha: SHA, dirty: [] })).toBeNull();
    expect(refusal({ results: [...green, { id: "c", status: "fail" }], sha: SHA, dirty: [] })).toMatch(/1 gate\(s\) not green: c \(fail\)/);
    expect(refusal({ results: [...green, { id: "c", status: "skip" }], sha: SHA, dirty: [] })).toMatch(/c \(skip\)/);
    expect(refusal({ results: green, sha: SHA, dirty: ["src/a.ts"] })).toMatch(/uncommitted/);
    expect(refusal({ results: green, sha: "", dirty: [] })).toMatch(/no commit hash/);
    expect(refusal({ results: [], sha: SHA, dirty: [] })).toMatch(/no gate ran/);
  });

  it("reads git status -z untrimmed: a first entry keeps its whole path; renames name the new path", () => {
    expect(porcelainFiles(" M src/b.ts\0?? new.ts\0R  to.ts\0from.ts\0 M .ci-local/runs/x.json\0")).toEqual(["src/b.ts", "new.ts", "to.ts"]);
    expect(porcelainFiles("")).toEqual([]);
  });

  it("a receipt read back is checked against its file name and its gates", () => {
    const rec = record({ sha: SHA, tree: TREE, results: greenWithAttack, at: "t", dirty: [] });
    expect(rec.green).toBe(true);
    expect(receiptProblems(rec, SHA)).toEqual([]);
    expect(receiptProblems(rec, "b".repeat(40))).toEqual([expect.stringMatching(/filed as/)]);
    const red = record({ sha: SHA, tree: TREE, results: [{ id: "a", status: "fail" }], at: "t", dirty: [] });
    expect(receiptProblems(red, SHA)).toEqual(expect.arrayContaining(["not green"]));
    expect(receiptProblems({ kind: "other" }, SHA)).toEqual(["not a train-offline receipt"]);
  });
});

const TREE = "e".repeat(40);
const ATTACK = "security/attacks/rr7-1-freeze-lockout.test.ts";
const greenWithAttack = [{ id: "a", status: "pass" }, { id: ATTACK, status: "pass" }];
const pass = (ids: string[]) => ids.map((id) => ({ id, status: "pass" }));

describe("receiptProblems: not self-asserted (review 9, M1)", () => {
  const expected = expectedGates([ATTACK, "src/__tests__/skipAudit.test.ts"]);

  it("needs exactly the expected gates: none missing, none extra, none twice", () => {
    const ok = record({ sha: SHA, tree: TREE, results: pass(expected), at: "t", dirty: [] });
    expect(receiptProblems(ok, SHA, { expected, tree: TREE })).toEqual([]);
    const short = record({ sha: SHA, tree: TREE, results: pass(expected.filter((id: string) => id !== "dod-done")), at: "t", dirty: [] });
    expect(receiptProblems(short, SHA, { expected, tree: TREE })).toEqual(["missing gate(s): dod-done"]);
    const extra = record({ sha: SHA, tree: TREE, results: pass([...expected, "src/__tests__/other.test.ts"]), at: "t", dirty: [] });
    expect(receiptProblems(extra, SHA, { expected, tree: TREE })).toEqual(["unexpected gate(s): src/__tests__/other.test.ts"]);
    const twice = record({ sha: SHA, tree: TREE, results: pass([...expected, "imports"]), at: "t", dirty: [] });
    expect(receiptProblems(twice, SHA, { expected, tree: TREE })).toEqual(["gate(s) listed twice: imports"]);
  });

  it("needs an attack gate, the commit's tree, and a clean tree", () => {
    expect(receiptProblems(record({ sha: SHA, tree: TREE, results: pass(["a"]), at: "t", dirty: [] }), SHA)).toEqual([expect.stringMatching(/no attack gate/)]);
    expect(receiptProblems(record({ sha: SHA, results: greenWithAttack, at: "t", dirty: [] }), SHA)).toEqual([expect.stringMatching(/no tree hash/)]);
    expect(receiptProblems(record({ sha: SHA, tree: TREE, results: greenWithAttack, at: "t", dirty: [] }), SHA, { tree: "d".repeat(40) })).toEqual([expect.stringMatching(/is not the commit's tree/)]);
    const dirty = record({ sha: SHA, tree: TREE, results: greenWithAttack, at: "t", dirty: ["src/a.ts"] });
    expect(receiptProblems(dirty, SHA)).toEqual(expect.arrayContaining(["not green", expect.stringMatching(/dirty tree/)]));
    const { dirty: _d, ...noDirty } = record({ sha: SHA, tree: TREE, results: greenWithAttack, at: "t", dirty: [] });
    expect(receiptProblems(noDirty, SHA)).toEqual([expect.stringMatching(/dirty tree \(or the tree state is not recorded\)/)]);
  });

  it("a --runner receipt is cloud class, carries the runner's hash, and never stands in for the Mac receipt", () => {
    const H = "1".repeat(64);
    const cloud = record({ sha: SHA, tree: TREE, results: greenWithAttack, runner: "/x/v4.sh", runnerSha256: H, at: "t", dirty: [] });
    expect(cloud).toMatchObject({ runner: "/x/v4.sh", class: "cloud", runnerSha256: H });
    expect(receiptProblems(cloud, SHA, { runnerSha256: H })).toEqual([]);
    expect(receiptProblems(cloud, SHA, { runnerSha256: "2".repeat(64) })).toEqual([expect.stringMatching(/hashes to 2{64}, not the receipt's/)]);
    expect(receiptProblems(cloud, SHA, { runnerSha256: null })).toEqual([expect.stringMatching(/not readable here/)]);
    expect(receiptProblems(cloud, SHA, { requireFull: true })).toEqual([expect.stringMatching(/cloud-class receipt .* can never stand in for the Mac/)]);
    expect(receiptProblems({ ...cloud, runnerSha256: null }, SHA)).toEqual([expect.stringMatching(/no sha256 of the runner/)]);
    // relabelled as the Mac receipt: the class does not match its runner
    expect(receiptProblems({ ...cloud, class: "full" }, SHA)).toEqual([expect.stringMatching(/a --runner receipt is cloud class/)]);
    const full = record({ sha: SHA, tree: TREE, results: greenWithAttack, at: "t", dirty: [] });
    expect(full).toMatchObject({ runner: "vitest", class: "full", runnerSha256: null });
    expect(receiptProblems(full, SHA, { requireFull: true })).toEqual([]);
  });

  it("the runner's hash covers the helper scripts it runs from its folder (review 10, L9)", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-helpers-"));
    try {
      mkdirSync(join(dir, "node"));
      writeFileSync(join(dir, "v.sh"), 'here=$(cd "$(dirname "$0")" && pwd)\nnode --import "$here/node/register.mjs" "$here/node/runner.mjs" "$1"\n');
      writeFileSync(join(dir, "node", "register.mjs"), 'import { register } from "node:module";\nregister("./hooks.mjs", import.meta.url);\n');
      writeFileSync(join(dir, "node", "hooks.mjs"), "export {};\n");
      writeFileSync(join(dir, "node", "runner.mjs"), 'import "./shim.mjs";\nimport "../../outside.mjs";\n');
      writeFileSync(join(dir, "node", "shim.mjs"), "console.log('pass 1 fail 0');\n");
      expect(runnerHelpers(join(dir, "v.sh"))).toEqual(["node/hooks.mjs", "node/register.mjs", "node/runner.mjs", "node/shim.mjs"]);
      const before = runnerSha256(join(dir, "v.sh"));
      expect(before).not.toBe(createHash("sha256").update(readFileSync(join(dir, "v.sh"))).digest("hex"));
      // One changed helper (two levels down) changes the hash; the runner file is the same.
      writeFileSync(join(dir, "node", "shim.mjs"), "console.log('pass 9 fail 0');\n");
      expect(runnerSha256(join(dir, "v.sh"))).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the runner's hash is the sha256 of its file, found by path or on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-hash-"));
    try {
      writeFileSync(join(dir, "r.sh"), "echo pass 1 fail 0\n");
      expect(runnerSha256(join(dir, "r.sh"))).toBe(createHash("sha256").update("echo pass 1 fail 0\n").digest("hex"));
      expect(runnerSha256(join(dir, "none.sh"))).toBeNull();
      expect(runnerSha256("node")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the expected list of this checkout is every command gate, then every attack and gate file", () => {
    const files = receiptTestFiles(repo);
    expect(files.filter((f: string) => f.startsWith("security/attacks/")).length).toBeGreaterThanOrEqual(13);
    expect(expectedGates(files)).toEqual([...COMMAND_GATES.map((g: { id: string }) => g.id), ...files]);
  });
});

describe("train-offline --verify checks a receipt against the checkout (review 9, M1)", () => {
  it("passes the exact receipt, refuses a missing gate, a wrong tree, a changed runner, and a cloud receipt with --require-full", () => {
    const dir = mkdtempSync(join(tmpdir(), "train-verify-"));
    try {
      mkdirSync(join(dir, "security/attacks"), { recursive: true });
      writeFileSync(join(dir, "security/attacks/a1.test.ts"), "// attack\n");
      writeFileSync(join(dir, ".gitignore"), "reports/\n");
      const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "c");
      const head = git("rev-parse", "HEAD");
      const tree = git("rev-parse", "HEAD^{tree}");
      const runner = join(dir, "..", `${dir.split("/").pop()}-runner.sh`);
      writeFileSync(runner, "echo pass 1 fail 0\n");
      const ids = expectedGates(["security/attacks/a1.test.ts"]);
      const put = (r: object) => {
        mkdirSync(join(dir, "reports"), { recursive: true });
        writeFileSync(join(dir, receiptPath(head)), JSON.stringify(r));
      };
      const verify = (...extra: string[]) => spawnSync("node", [join(repo, "scripts/train-offline.mjs"), "--verify", "--root", dir, ...extra], { encoding: "utf8" });
      const good = record({ sha: head, tree, results: pass(ids), at: "t", dirty: [] });
      put(good);
      expect(verify().status).toBe(0);
      expect(verify("--require-full").status).toBe(0);
      put(record({ sha: head, tree, results: pass(ids.filter((id: string) => id !== "dod-done")), at: "t", dirty: [] }));
      expect(verify().stderr).toMatch(/missing gate\(s\): dod-done/);
      put({ ...good, tree: "d".repeat(40) });
      expect(verify().status).toBe(1);
      const cloud = record({ sha: head, tree, results: pass(ids), runner, runnerSha256: createHash("sha256").update("echo pass 1 fail 0\n").digest("hex"), at: "t", dirty: [] });
      put(cloud);
      expect(verify().status).toBe(0);
      const full = verify("--require-full");
      expect(full.status).toBe(1);
      expect(full.stderr).toMatch(/can never stand in for the Mac/);
      writeFileSync(runner, "echo pass 9 fail 0\n");
      expect(verify().stderr).toMatch(/hashes to [0-9a-f]{64}, not the receipt's/);
      rmSync(runner);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the test-file gates (review 9, M5 and L2)", () => {
  type Spawn = (cmd: string, args: string[]) => { stdout: string; stderr: string; status: number };
  const a = "src/__tests__/dod.test.ts";
  const b = "src/__tests__/handoff.test.ts";

  it("without a runner, vitest's JSON reporter: a file whose every test skipped is not green", () => {
    const calls: string[][] = [];
    const spawn: Spawn = (cmd, args) => {
      calls.push([cmd, ...args]);
      const out = args.find((x) => x.startsWith("--outputFile="))!.slice("--outputFile=".length);
      const results = [
        { name: join(repo, a), status: "passed", assertionResults: [{ status: "passed" }, { status: "skipped" }] },
        { name: join(repo, b), status: "passed", assertionResults: [{ status: "skipped" }, { status: "skipped" }] },
      ];
      writeFileSync(out, JSON.stringify({ testResults: results }));
      return { stdout: "", stderr: "", status: 0 };
    };
    const gates = testGates(repo, [a, b, "src/__tests__/missing.test.ts"], null, spawn);
    const res = gates.map((g: { id: string; run: () => { ok: boolean; detail: string } }) => [g.id, g.run()]);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(1, 4)).toEqual(["vitest", "run", "--reporter=json"]);
    expect(res).toEqual([
      [a, { ok: true, detail: "pass 1 fail 0" }],
      [b, { ok: false, detail: "pass 0 fail 0" }],
      ["src/__tests__/missing.test.ts", { ok: false, detail: "no result in vitest's JSON report" }],
    ]);
  });

  it("a failed file with no test result (a load error) is red", () => {
    const spawn: Spawn = (_c, args) => {
      writeFileSync(args.find((x) => x.startsWith("--outputFile="))!.slice(13), JSON.stringify({ testResults: [{ name: join(repo, a), status: "failed", assertionResults: [] }] }));
      return { stdout: "", stderr: "", status: 1 };
    };
    expect(testGates(repo, [a], null, spawn)[0].run()).toEqual({ ok: false, detail: "pass 0 fail 1" });
  });

  it("with no security/attacks at all, a red attacks gate comes first", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-attacks-"));
    try {
      const gates = testGates(dir, [], "/x/v4.sh");
      expect(gates.map((g: { id: string }) => g.id)).toEqual(["attacks"]);
      expect(gates[0].run()).toMatchObject({ ok: false, detail: expect.stringMatching(/needs at least one/) });
      expect(testGates(repo, [ATTACK], "/x/v4.sh").map((g: { id: string }) => g.id)).toEqual([ATTACK]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the import check", () => {
  it("reads real imports, not imports written inside strings, comments or regexes", () => {
    const text = [
      'import a from "./a";',
      'export { b } from "../b";',
      'import "./side";',
      'const c = await import("./lazy");',
      'const fixture = "import z from \'./inString\'";',
      "// import y from './inComment';",
      'expect(t).toMatch(/^import "\\.\\/inRegex";/m);',
    ].join("\n");
    expect(specifiers(text)).toEqual(expect.arrayContaining(["./a", "../b", "./side", "./lazy"]));
    expect(specifiers(text)).not.toContain("./inString");
    expect(specifiers(text)).not.toContain("./inComment");
    expect(specifiers(text)).not.toContain("./inRegex");
  });

  it("resolves extensions, index files, .js → .ts, Vite queries and the @/ alias", () => {
    const files = new Set(["/r/src/x.ts", "/r/src/dir/index.tsx", "/r/src/y.ts", "/r/src/w.json"]);
    const has = (p: string) => files.has(p);
    expect(resolves("./x", "/r/src/m.ts", "/r", has)).toBe(true);
    expect(resolves("./dir", "/r/src/m.ts", "/r", has)).toBe(true);
    expect(resolves("./y.js", "/r/src/m.ts", "/r", has)).toBe(true);
    expect(resolves("./x?raw", "/r/src/m.ts", "/r", has)).toBe(true);
    expect(resolves("@/w.json", "/r/src/deep/m.ts", "/r", has)).toBe(true);
    expect(resolves("./gone", "/r/src/m.ts", "/r", has)).toBe(false);
  });

  it("is green on this checkout", () => {
    const { files, broken } = brokenImports(repo);
    expect(files).toBeGreaterThan(1000);
    expect(broken).toEqual([]);
  });
});

describe("a broken import fails train:offline --all fast, and no receipt is written", () => {
  it("red in ≤ 90 s, the later gates not run, a run record but no receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "train-receipt-"));
    try {
      mkdirSync(join(dir, "scripts/lib"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      for (const f of ["scripts/check-imports.mjs", "scripts/lib/importCheck.mjs"]) copyFileSync(join(repo, f), join(dir, f));
      symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
      writeFileSync(join(dir, ".gitignore"), "node_modules\n.ci-local/\n");
      writeFileSync(join(dir, "src/a.ts"), 'import { b } from "./b";\nexport const a = b;\n');
      writeFileSync(join(dir, "src/b.ts"), "export const b = 1;\n");
      const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "green");
      const run = () => spawnSync("node", [join(repo, "scripts/train-offline.mjs"), "--only", "imports", "--root", dir], { encoding: "utf8" });
      expect(run().status).toBe(0);

      writeFileSync(join(dir, "src/a.ts"), 'import { b } from "./bee";\nexport const a = b;\n');
      git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "broken import");
      const t0 = Date.now();
      const r = spawnSync("node", [join(repo, "scripts/train-offline.mjs"), "--all", "--root", dir], { encoding: "utf8" });
      const ms = Date.now() - t0;
      expect(r.status).toBe(1);
      expect(ms).toBeLessThanOrEqual(90_000);
      expect(`${r.stdout}${r.stderr}`).toMatch(/src\/a\.ts: import "\.\/bee" names no file/);
      expect(`${r.stdout}${r.stderr}`).toMatch(/no receipt — .*imports \(fail\)/);
      expect(existsSync(join(dir, "reports"))).toBe(false);
      const head = git("rev-parse", "HEAD").stdout.trim();
      const runs = readdirSync(join(dir, ".ci-local/runs")).filter((f) => f.startsWith(head));
      expect(runs).toHaveLength(1);
      const rec = JSON.parse(readFileSync(join(dir, ".ci-local/runs", runs[0]), "utf8"));
      expect(rec.sha).toBe(head);
      expect(rec.green).toBe(false);
      expect(rec.gates[0]).toMatchObject({ id: "imports", status: "fail" });
      expect(rec.gates.slice(1).every((g: { status: string }) => g.status === "skip")).toBe(true);
      expect(rec).toMatchObject({ dirty: [], runner: "vitest", class: "full", tree: git("rev-parse", "HEAD^{tree}").stdout.trim() });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("a dirty tree is refused by name, and its run record says so (review 9, L1/M2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "train-receipt-dirty-"));
    try {
      mkdirSync(join(dir, "scripts/lib"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      for (const f of ["scripts/check-imports.mjs", "scripts/lib/importCheck.mjs"]) copyFileSync(join(repo, f), join(dir, f));
      symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
      writeFileSync(join(dir, ".gitignore"), "node_modules\n.ci-local/\n");
      // a broken import keeps the run short (fail-fast); the refusal names the dirty tree first
      writeFileSync(join(dir, "src/a.ts"), 'import { b } from "./bee";\nexport const a = b;\n');
      writeFileSync(join(dir, "src/b.ts"), "export const b = 1;\n");
      const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "c");
      writeFileSync(join(dir, "src/b.ts"), "export const b = 2;\n");
      const r = spawnSync("node", [join(repo, "scripts/train-offline.mjs"), "--all", "--root", dir], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no receipt — the tree has 1 uncommitted change\(s\) \(src\/b\.ts\)/);
      expect(existsSync(join(dir, "reports"))).toBe(false);
      const runs = readdirSync(join(dir, ".ci-local/runs"));
      expect(runs).toHaveLength(1);
      const rec = JSON.parse(readFileSync(join(dir, ".ci-local/runs", runs[0]), "utf8"));
      expect(rec).toMatchObject({ green: false, dirty: ["src/b.ts"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
