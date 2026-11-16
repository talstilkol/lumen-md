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
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { COMMAND_GATES, TEST_GATES, allGreen, isSha, receiptPath, receiptProblems, record, refusal, runGates } from "../../scripts/lib/trainReceipt.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { brokenImports, resolves, specifiers } from "../../scripts/lib/importCheck.mjs";

const repo = resolve(__dirname, "../..");
const SHA = "a".repeat(40);

describe("the gate list", () => {
  it("starts with the fail-fast import check and holds every gate the task names", () => {
    expect(COMMAND_GATES[0]).toMatchObject({ id: "imports", failFast: true });
    const ids = COMMAND_GATES.map((g: { id: string }) => g.id);
    for (const id of ["typecheck", "code-hygiene", "max-lines", "live-seams", "flags", "plan", "dod-rule", "i18n"]) expect(ids).toContain(id);
    expect(TEST_GATES).toEqual(expect.arrayContaining(["src/__tests__/skipAudit.test.ts", "src/__tests__/codeHealth.test.ts", "src/__tests__/settingsSchema.test.ts"]));
    for (const f of TEST_GATES) expect(existsSync(join(repo, f)), f).toBe(true);
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

  it("a receipt read back is checked against its file name and its gates", () => {
    const rec = record({ sha: SHA, results: green, at: "t", dirty: [] });
    expect(rec.green).toBe(true);
    expect(receiptProblems(rec, SHA)).toEqual([]);
    expect(receiptProblems(rec, "b".repeat(40))).toEqual([expect.stringMatching(/filed as/)]);
    const red = record({ sha: SHA, results: [{ id: "a", status: "fail" }], at: "t", dirty: [] });
    expect(receiptProblems(red, SHA)).toEqual(expect.arrayContaining(["not green"]));
    expect(receiptProblems({ kind: "other" }, SHA)).toEqual(["not a train-offline receipt"]);
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
