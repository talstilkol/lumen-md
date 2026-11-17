/**
 * R12.12: the local ci-doctor stack (scripts/ci-doctor/). Signatures are
 * checked on 10 real train-run logs, each run twice (shim v4 measurement
 * runs v4-node and t4-node of the same files; paths redacted), the culprit
 * finder on a synthetic red train built in a temp repo, and the run-filter
 * on tasker's golden outputs.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drain, failureBlocks, maskLine, signatures } from "../../scripts/ci-doctor/failSig.mjs";
import { autonomy, diagnose, loadKedb, recordOutcome, wilson } from "../../scripts/ci-doctor/kedb.mjs";
import { checkQuarantine, classify, entryProblems, quarantine, reportFailure, rerunAlone } from "../../scripts/ci-doctor/flake.mjs";
import { fastSubset, findCulprit, prOfSubject } from "../../scripts/ci-doctor/culprit.mjs";
import { filterOutput, lostErrorLines } from "../../scripts/ci-doctor/runFilter.mjs";

type Sig = { key: string; test: string; head: string; frame: string };
const LOGS = "scripts/ci-doctor/fixtures/train-logs";
const read = (f: string) => readFileSync(join(LOGS, f), "utf8");
const names = readdirSync(LOGS)
  .filter((f) => f.endsWith(".v4-node.log"))
  .map((f) => f.replace(".v4-node.log", ""))
  .sort();

describe("failSig on 10 real train logs, two runs each", () => {
  it("has 10 pairs", () => expect(names).toHaveLength(10));

  it("every log is a real run's output, pinned: PROVENANCE.json names its original and its sha256, and only paths were redacted", () => {
    const prov = JSON.parse(read("PROVENANCE.json")) as { logs: Array<{ fixture: string; original: string; originalSha256: string; sha256: string; change: string }> };
    const logs = readdirSync(LOGS).filter((f) => f.endsWith(".log")).sort();
    expect(prov.logs.map((l) => l.fixture).sort()).toEqual(logs);
    for (const l of prov.logs) {
      // The bytes the independent check compared with the original (wave g2): a hand edit since then fails here.
      expect(createHash("sha256").update(read(l.fixture)).digest("hex"), l.fixture).toBe(l.sha256);
      const [name, run] = l.fixture.replace(/\.log$/, "").split(".");
      expect(l.original, l.fixture).toMatch(new RegExp(`^P/v4/meas/${run}/${name}\\.test\\.tsx?\\.log$`));
      expect(["none (verbatim)", "paths redacted only"]).toContain(l.change);
      expect(l.change === "none (verbatim)", l.fixture).toBe(l.sha256 === l.originalSha256);
      // Redacted: no machine path is left.
      expect(read(l.fixture), l.fixture).not.toMatch(/\/home\/(?!u\/)[a-z]+\/|%2Fhome%2F(?!u%2F)|-home-[a-z]+\/[0-9a-f]{8}-/);
    }
  });

  it("the same failure gets the same key in both runs, though paths, timings and colours differ", () => {
    const changed: string[] = [];
    for (const n of names) {
      const a = (signatures(read(`${n}.v4-node.log`)) as Sig[]).map((s) => s.key);
      const b = (signatures(read(`${n}.t4-node.log`)) as Sig[]).map((s) => s.key);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length);
      if (a.join() !== b.join()) changed.push(n);
    }
    // syncExplained really failed differently the second time ("server is not defined" → an assertion).
    expect(changed).toEqual(["syncExplained"]);
    // The raw text did differ in 6 of the 10 pairs (worktree paths, a timing, a diff body).
    expect(names.filter((n) => read(`${n}.v4-node.log`) !== read(`${n}.t4-node.log`))).toHaveLength(6);
  });

  it("two different crashes never share a key: the one test that changed its failure, and every test of a log", () => {
    const [a, b] = ["v4-node", "t4-node"].map((r) => (signatures(read(`syncExplained.${r}.log`)) as Sig[])[0]);
    expect(a.test).toBe(b.test);
    expect(a.head).toBe("server is not defined");
    expect(b.head).toBe("expect(received).toMatch(expected)");
    expect(a.key).not.toBe(b.key);
    for (const n of names) {
      const keys = (signatures(read(`${n}.v4-node.log`)) as Sig[]).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("masks what changes between runs and keeps what the failure is", () => {
    expect(maskLine("at TableView (file:///home/u/w-P-e2e/src/views/DatabaseBlock.tsx:501:71)")).toBe("at TableView (src/views/DatabaseBlock.tsx)");
    expect(maskLine('\x1b[33mdata-ms\x1b[39m="131.1" after 5000ms at 2026-11-14T10:00:00Z id 3f9a2c1d7e')).toBe('data-ms="<n>" after <dur> at <ts> id <hex>');
    expect(maskLine("open '/home/u/w-P-t4/src/i18n/locales/he.json'")).toBe("open 'src/i18n/locales/he.json'");
    const s = (signatures(read("DatabaseBlockRender.v4-node.log")) as Sig[])[0];
    expect(s.frame).toBe("src/views/DatabaseBlock.tsx#TableView");
  });

  it("vitest, TAP and a bare stack are cut into blocks too", () => {
    const vitest = " FAIL  src/__tests__/a.test.ts > math > adds\nAssertionError: expected 3 to be 4\n ❯ src/__tests__/a.test.ts:5:3\n Test Files  1 failed (1)";
    expect(failureBlocks(vitest)).toHaveLength(1);
    expect((signatures(vitest) as Sig[])[0]).toMatchObject({ head: "AssertionError: expected <n> to be <n>", frame: "src/__tests__/a.test.ts#?" });
    expect(failureBlocks("TAP version 13\nnot ok 1 - parses\n  ---\n  error: 'boom'\n  ...\nok 2 - other")).toHaveLength(1);
    expect(failureBlocks("building…\nTypeError: x is not a function\n    at run (/home/u/w/scripts/a.mjs:3:1)")[0].test).toBe("(no test)");
  });

  it("Drain groups the error heads of many failures into kinds", () => {
    const heads = names.flatMap((n) => (signatures(read(`${n}.v4-node.log`)) as Sig[]).map((s) => s.head));
    const clusters = drain(heads) as Array<{ template: string; size: number }>;
    expect(clusters.length).toBeLessThan(heads.length);
    const stub = clusters.find((c) => c.template.startsWith("stubbed package"))!;
    expect(stub.template).toBe("stubbed package <*> <*>");
    expect(stub.size).toBe(heads.filter((h) => h.startsWith("stubbed package")).length);
    expect(drain(["a b c", "a b c"])).toEqual([{ id: 1, template: "a b c", size: 2 }]);
  });
});

describe("kedb: known errors; outcomes decide the runbook's autonomy", () => {
  it("names the known errors of the real logs, and leaves the new ones unknown", () => {
    const db = loadKedb();
    const ids = (n: string) => diagnose(read(`${n}.v4-node.log`), db).map((r: { known: { id: string } | null }) => r.known?.id ?? "unknown");
    expect(ids("pdfHebrew")).toEqual(["locale-file-moved"]);
    expect(ids("searchOps")).toEqual(["shim-frozen-module-namespace"]);
    expect(ids("syncExplained")).toEqual(["msw-server-missing", "timeout-under-load"]);
    expect(ids("DatabaseBlockRender")).toEqual(["unknown", "unknown", "unknown", "unknown", "shim-stubbed-package", "shim-stubbed-package"]);
  });

  it("suggest → ask → auto only from outcomes; one recent failure drops auto", () => {
    const run = (ok: number, fail: number) => [...Array(ok).fill({ ok: true }), ...Array(fail).fill({ ok: false })];
    expect(autonomy([])).toBe("suggest");
    expect(autonomy(run(2, 0))).toBe("suggest");
    expect(autonomy(run(3, 0))).toBe("ask");
    expect(autonomy(run(9, 0))).toBe("ask");
    expect(autonomy(run(14, 0))).toBe("ask");
    expect(autonomy(run(16, 0))).toBe("auto");
    expect(autonomy([...run(16, 0), { ok: false }])).toBe("ask");
    expect(autonomy(run(3, 3))).toBe("suggest");
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeCloseTo(0.596, 3);
    expect(hi).toBeCloseTo(0.982, 3);
  });

  it("a hand-written autonomy level is refused; recording an outcome appends it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kedb-"));
    writeFileSync(join(dir, "k.json"), JSON.stringify({ schema: 1, entries: [{ id: "x", match: "y", class: "env", autonomy: "auto" }] }));
    expect(() => loadKedb(join(dir, "k.json"))).toThrow(/computed from outcomes/);
    const db = recordOutcome({ schema: 1, entries: [{ id: "x", match: "y", class: "env", outcomes: [] }] }, "x", true, "2026-11-15T00:00:00Z");
    expect(db.entries[0].outcomes).toEqual([{ at: "2026-11-15T00:00:00Z", ok: true }]);
  });
});

describe("flake: rerun alone, classify, quarantine with an expiry", () => {
  const row = (ok: boolean, alone = false, commit = "c1") => ({ at: "", commit, file: "src/__tests__/a.test.ts", test: "t", key: ok ? null : "k", ok, alone });

  it("classifies from the history", () => {
    expect(classify([row(true), row(false)]).verdict).toBe("flaky");
    expect(classify([row(false), row(false, true), row(false, true)]).verdict).toBe("real");
    expect(classify([row(false), row(true, true), row(true, true)]).verdict).toBe("flaky");
    expect(classify([row(false, false, "c1"), row(true, true, "c2"), row(true, true, "c2")]).verdict).toBe("isolation");
    expect(classify([row(false)]).verdict).toBe("unknown");
  });

  it("rerunAlone runs the file alone N times and records each run", () => {
    const outputs = [
      { code: 1, text: "FAIL suite > t\n    test timed out after 5000ms\nv4: node pass 0 fail 1" },
      { code: 0, text: "v4: node pass 1 fail 0" },
      { code: 0, text: "v4: node pass 1 fail 0" },
    ];
    const cmds: string[] = [];
    const rows = rerunAlone("src/__tests__/a.test.ts", { times: 3, commit: "c1", runner: "shim {file}", exec: (c: string) => (cmds.push(c), outputs.shift()!) });
    expect(cmds).toEqual(Array(3).fill("shim src/__tests__/a.test.ts"));
    expect(rows.map((r: { ok: boolean; alone: boolean }) => [r.ok, r.alone])).toEqual([
      [false, true],
      [true, true],
      [true, true],
    ]);
  });

  it("only a flaky test goes into quarantine, for at most 14 days; expired is red, active is reported, not hidden", () => {
    const now = Date.parse("2026-11-15T00:00:00Z");
    const q0 = { schema: 1, entries: [] };
    expect(() => quarantine(q0, { test: "t", file: "src/__tests__/a.test.ts", reason: "r", history: [row(false, true), row(false, true)], now })).toThrow(/real/);
    expect(() => quarantine(q0, { test: "t", file: "src/__tests__/a.test.ts", reason: "r", history: [row(true), row(false)], now, days: 30 })).toThrow(/14 days/);
    const q = quarantine(q0, { test: "t", file: "src/__tests__/a.test.ts", reason: "times out under load", history: [row(true), row(false)], now });
    expect(q.entries[0].evidence).toMatch(/passed 1 and failed 1 times at c1/);
    expect(reportFailure(q, { test: "t", file: "src/__tests__/a.test.ts" }, now)).toMatchObject({ status: "quarantined" });
    expect(reportFailure(q, { test: "t", file: "src/__tests__/a.test.ts" }, now + 8 * 864e5)).toMatchObject({ status: "red" });
    expect(reportFailure(q, { test: "other", file: "src/__tests__/a.test.ts" }, now)).toEqual({ status: "red" });
    expect(checkQuarantine(q, now + 8 * 864e5).expired).toHaveLength(1);
    expect(entryProblems({ test: "t", file: "f", reason: "r", evidence: "e", since: "2026-11-01", expires: "2026-12-01" })[0]).toMatch(/14 days/);
  });

  it("the committed quarantine is valid and empty", () => {
    const q = JSON.parse(readFileSync("scripts/ci-doctor/quarantine.json", "utf8"));
    expect(checkQuarantine(q)).toEqual({ active: [], expired: [], invalid: [] });
  });
});

describe("culprit: a synthetic red train, bisected locally", () => {
  /** A train: main, then four PR branches merged with --no-ff; PR #3's second commit breaks check.mjs. */
  function train() {
    const repo = mkdtempSync(join(tmpdir(), "ci-doctor-train-"));
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", ...a], { cwd: repo, encoding: "utf8" }).trim();
    g("init", "-q");
    writeFileSync(join(repo, "check.mjs"), "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('app.txt', 'utf8').includes('BUG') ? 1 : 0);\n");
    writeFileSync(join(repo, "app.txt"), "start\n");
    g("add", ".");
    g("commit", "-q", "-m", "base");
    const good = g("rev-parse", "HEAD");
    let inner = "";
    for (const pr of [1, 2, 3, 4]) {
      g("checkout", "-q", "-b", `pr${pr}`, "main");
      for (const k of [1, 2]) {
        writeFileSync(join(repo, `f${pr}-${k}.txt`), "x\n");
        if (pr === 3 && k === 2) writeFileSync(join(repo, "app.txt"), "start\nBUG\n");
        g("add", ".");
        g("commit", "-q", "-m", `pr${pr} commit ${k}`);
        if (pr === 3 && k === 2) inner = g("rev-parse", "HEAD");
      }
      g("checkout", "-q", "main");
      g("merge", "-q", "--no-ff", `pr${pr}`, "-m", `merge(train): #${pr} feature ${pr}`);
    }
    return { repo, good, bad: g("rev-parse", "HEAD"), inner, g };
  }

  it("--first-parent names the train merge and its PR; --all names the commit; the checkout is untouched", () => {
    const t = train();
    const before = t.g("status", "--porcelain");
    const r = findCulprit({ repo: t.repo, good: t.good, bad: t.bad, cmd: ["node", "check.mjs"] });
    expect(r).toMatchObject({ subject: "merge(train): #3 feature 3", pr: 3, merge: true });
    const all = findCulprit({ repo: t.repo, good: t.good, bad: t.bad, cmd: ["node", "check.mjs"], firstParent: false });
    expect(all.culprit).toBe(t.inner);
    expect(all.merge).toBe(false);
    expect(t.g("status", "--porcelain")).toBe(before);
    expect(t.g("worktree", "list").split("\n")).toHaveLength(1);
    expect(t.g("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("the fast subset is the failing test files of the red log; PR numbers come from merge subjects", () => {
    const log = " FAIL  src/__tests__/a.test.ts > x\nError: boom\n FAIL  src/__tests__/b.test.tsx > y\nError: bang\n FAIL  src/__tests__/a.test.ts > z\nError: boom";
    expect(fastSubset(log)).toEqual(["src/__tests__/a.test.ts", "src/__tests__/b.test.tsx"]);
    expect(prOfSubject("Merge pull request #812 from x/y")).toBe(812);
    expect(prOfSubject("merge(i18n): #576 (Yiddish and Ladino) into the train")).toBe(576);
    expect(prOfSubject("fix: no number")).toBeNull();
  });
});

describe("runFilter (from talstilkol/tasker): golden outputs, no error line lost", () => {
  const F = "scripts/ci-doctor/fixtures/run-filter";
  const CASES = JSON.parse(readFileSync(join(F, "cases.json"), "utf8")) as Array<{ file: string; cmd: string; args: string[]; code: number; cwd: string; family: string }>;
  it.each(CASES.map((c) => [c.file, c] as const))("%s", (_f: string, c: (typeof CASES)[number]) => {
    const raw = readFileSync(join(F, c.file), "utf8");
    const r = filterOutput({ cmd: c.cmd, args: c.args, text: raw, code: c.code, cwd: c.cwd, force: true });
    expect(`${r.family}\n${r.summary}\n---\n${r.text}\n`).toBe(readFileSync(join(F, c.file.replace(".txt", ".golden")), "utf8"));
    expect(lostErrorLines(raw, r.text, { cwd: c.cwd, family: r.family })).toEqual([]);
    expect(filterOutput({ cmd: c.cmd, args: c.args, text: raw, code: c.code, cwd: c.cwd }).family).toBe(c.family);
  });
});

describe("local only", () => {
  it("no ci-doctor module calls GitHub Actions, the GitHub API or the network", () => {
    for (const f of readdirSync("scripts/ci-doctor").filter((x) => x.endsWith(".mjs"))) {
      const src = readFileSync(join("scripts/ci-doctor", f), "utf8");
      expect(src, f).not.toMatch(/api\.github\.com|\bgh\s+(?:run|workflow|api)\b|\bfetch\(|actions\/runs|node:https?\b/);
    }
  });
});
