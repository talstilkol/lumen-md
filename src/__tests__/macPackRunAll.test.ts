/**
 * Integrator INT6a: `npm run mac:pack` (scripts/mac-pack/run-all.mjs) runs
 * every lane's Mac pack entry, judges each `expect` in its lane's own shape,
 * and exits non-zero when any entry fails. These tests plant the results
 * (an injected runner writes the files a real command would) and check that
 * a failing entry, a wrong value, a stale file or a failed dependency each
 * make the run NOT OK, that shared steps run once, and that the owner index
 * merges the actions several lanes ask for.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { classify, loadPacks, main, order, renderMarkdown, runAll } from "../../scripts/mac-pack/run-all.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { normalize } from "../../scripts/mac-pack/lib/expect.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { movesHead, rewrite, splitTop } from "../../scripts/mac-pack/lib/shell.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { slice } from "../../scripts/mac-pack/pw-from-shared.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { group, loadOwnerPacks, main as ownerIndex } from "../../scripts/mac-pack/owner-index.mjs";

const REPO = resolve(__dirname, "../..");

type Entry = Record<string, unknown>;
function root(packs: Record<string, Entry[]>) {
  const dir = mkdtempSync(join(tmpdir(), "macpack-"));
  mkdirSync(join(dir, "plan/mac-pack"), { recursive: true });
  for (const [lane, list] of Object.entries(packs)) writeFileSync(join(dir, `plan/mac-pack/${lane}.json`), JSON.stringify(list));
  return dir;
}

/** A runner that plants results: `plant[cmd]` = {code, files:{path: json}, stdout}. */
function planted(dir: string, plant: Record<string, { code: number; files?: Record<string, unknown>; stdout?: string }>) {
  const calls: string[] = [];
  const exec = async (cmd: string) => {
    calls.push(cmd);
    const p = plant[cmd] ?? { code: 0 };
    for (const [f, body] of Object.entries(p.files ?? {})) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), typeof body === "string" ? body : JSON.stringify(body));
    }
    return { code: p.code, stdout: p.stdout ?? "" };
  };
  return { exec, calls };
}

const vitestOk = { success: true, numFailedTests: 0, numPassedTests: 5 };

describe("mac:pack aggregator", () => {
  it("passes when every entry's planted results meet its expect", async () => {
    const dir = root({
      L1: [{ id: "L1/a", cmd: "run-a", expect: { exit: 0, json: { file: "reports/mac-pack/L1/a.json", ok: true, total: 3 } }, needs: [] }],
      L7: [{ id: "L7-b", cmd: "run-b", expect: "exit 0; reports/mac-pack/L7/b.vitest.json: .success == true && .numFailedTests == 0 && .numPassedTests > 0", needs: [] }],
    });
    const { exec } = planted(dir, {
      "run-a": { code: 0, files: { "reports/mac-pack/L1/a.json": { ok: true, total: 3 } } },
      "run-b": { code: 0, files: { "reports/mac-pack/L7/b.vitest.json": vitestOk } },
    });
    const sum = await runAll({ root: dir, exec });
    expect(sum.counts).toMatchObject({ pass: 2, fail: 0, blocked: 0 });
    expect(sum.ok).toBe(true);
  });

  it("is NOT OK when one entry fails: a non-zero exit, a wrong value, or a stale file", async () => {
    const dir = root({
      L2: [
        { id: "L2-exit", cmd: "run-exit", expect: { exit: 0 }, needs: [] },
        { id: "L2-value", cmd: "run-value", expect: { exit: 0, json: [{ file: ".mac-pack/L2/v.json", path: "numFailedTests", op: "==", value: 0 }] }, needs: [] },
        { id: "L2-stale", cmd: "run-stale", expect: { exit: 0, json: [{ file: ".mac-pack/L2/old.json", path: "ok", op: "==", value: true }] }, needs: [] },
        { id: "L2-good", cmd: "run-good", expect: { exit: 0 }, needs: [] },
      ],
    });
    mkdirSync(join(dir, ".mac-pack/L2"), { recursive: true });
    writeFileSync(join(dir, ".mac-pack/L2/old.json"), JSON.stringify({ ok: true }));
    utimesSync(join(dir, ".mac-pack/L2/old.json"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const { exec } = planted(dir, {
      "run-exit": { code: 1 },
      "run-value": { code: 0, files: { ".mac-pack/L2/v.json": { numFailedTests: 2 } } },
    });
    const sum = await runAll({ root: dir, exec });
    const st = Object.fromEntries(sum.entries.map((e: { id: string; status: string }) => [e.id, e.status]));
    expect(st).toEqual({ "L2-exit": "fail", "L2-value": "fail", "L2-stale": "fail", "L2-good": "pass" });
    expect(sum.ok).toBe(false);
    const stale = sum.entries.find((e: { id: string }) => e.id === "L2-stale").checks.find((c: { kind: string }) => c.kind === "json");
    expect(String(stale.actual)).toMatch(/stale/);
    expect(renderMarkdown(sum)).toMatch(/NOT OK/);
  });

  it("the CLI exits 1 on a failing entry and 0 when all pass, and writes both summaries", async () => {
    const bad = root({ L1: [{ id: "L1/x", cmd: "exit 3", expect: { exit: 0 }, needs: [] }, { id: "L1/y", cmd: "true", expect: { exit: 0 }, needs: [] }] });
    expect(await main(["--root", bad])).toBe(1);
    const s = JSON.parse(readFileSync(join(bad, "reports/mac-pack/summary.json"), "utf8"));
    expect(s.counts).toMatchObject({ pass: 1, fail: 1 });
    expect(readFileSync(join(bad, "reports/mac-pack/summary.md"), "utf8")).toMatch(/L1\/x/);
    const good = root({ L1: [{ id: "L1/y", cmd: "mkdir -p out && echo '{\"ok\":true}' > out/r.json", expect: { exit: 0, json: [{ file: "out/r.json", path: ["ok"], equals: true }] }, needs: [] }] });
    expect(await main(["--root", good])).toBe(0);
    expect(await main(["--root", good, "--only", "nope"])).toBe(2);
  });

  it("blocks an entry whose named dependency failed, and never runs it", async () => {
    const dir = root({ L3: [
      { id: "L3-run", cmd: "batch", expect: { exit: 0 }, needs: [] },
      { id: "L3-after", cmd: "after", expect: { exit: 0 }, needs: ["L3-run", "a Mac"] },
    ] });
    const { exec, calls } = planted(dir, { batch: { code: 1 } });
    const sum = await runAll({ root: dir, exec });
    expect(sum.entries.find((e: { id: string }) => e.id === "L3-after").status).toBe("blocked");
    expect(calls).not.toContain("after");
    expect(sum.ok).toBe(false);
  });

  it("runs shared steps once, slices the one e2e report, and runs a repeated command once", async () => {
    const pw = (file: string, status: string) => ({ title: file, file, specs: [{ title: "t", file, tests: [{ projectName: "chromium", status }, { projectName: "webkit", status: "expected" }] }] });
    const report = { config: {}, suites: [pw("ink.spec.ts", "expected"), pw("pdf-ink.spec.ts", "unexpected")], errors: [], stats: { expected: 3, unexpected: 1, flaky: 0, skipped: 0 } };
    const dir = root({
      L5: [{ id: "L5.setup", cmd: "git switch verify/train-7 && git pull --ff-only && npm ci && npx playwright install chromium firefox webkit", expect: { exit: 0 }, needs: [] }],
      L8: [
        { id: "L8-e2e", cmd: "npm ci && PLAYWRIGHT_JSON_OUTPUT_NAME=reports/mac-pack/L8/ink.json npx playwright test e2e/ink.spec.ts --project=chromium --reporter=json", expect: { exit: 0, json: "reports/mac-pack/L8/ink.json", checks: [{ path: ["stats", "expected"], op: "==", value: 1 }, { path: ["stats", "unexpected"], op: "==", value: 0 }] }, needs: [] },
        { id: "L8-g1", batch: "g", cmd: "golden", expect: { exit: 0 }, needs: [] },
        { id: "L8-g2", batch: "g", cmd: "golden", expect: { exit: 0 }, needs: [] },
      ],
    });
    const realExec = async (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("npx playwright test --project=chromium")) {
        mkdirSync(join(dir, "reports/mac-pack/shared"), { recursive: true });
        writeFileSync(join(dir, "reports/mac-pack/shared/e2e.pw.json"), JSON.stringify(report));
        return { code: 1, stdout: "" };
      }
      if (cmd.startsWith("true && node scripts/mac-pack/pw-from-shared.mjs")) {
        // what the rewritten segment does, without a shell: slice the shared report
        const r = slice(report, ["e2e/ink.spec.ts"], ["chromium"]);
        mkdirSync(join(dir, "reports/mac-pack/L8"), { recursive: true });
        writeFileSync(join(dir, "reports/mac-pack/L8/ink.json"), JSON.stringify(r.report));
        return { code: r.code, stdout: "" };
      }
      return { code: 0, stdout: "" };
    };
    const calls: string[] = [];
    const sum = await runAll({ root: dir, exec: realExec });
    expect(calls.filter((c) => c.startsWith("npm ci"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("npx playwright test"))).toHaveLength(1);
    expect(calls.filter((c) => c === "golden")).toHaveLength(1);
    expect(calls.some((c) => /git (switch|pull)/.test(c))).toBe(false);
    expect(sum.entries.map((e: { status: string }) => e.status)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("an entry that moves the branch never runs inside the aggregate", async () => {
    const dir = root({ L2: [{ id: "L2-rel", cmd: "git fetch origin && git switch -c rel abc && npm run release", expect: { exit: 0 }, needs: [] }] });
    const { exec, calls } = planted(dir, {});
    const sum = await runAll({ root: dir, exec });
    expect(sum.entries[0].status).toBe("own-run");
    expect(calls).toHaveLength(0);
    expect(movesHead("npx playwright test -g \"git pull\" && git merge-base --is-ancestor a HEAD")).toBe(false);
  });
});

describe("mac:pack pieces", () => {
  it("splits only at top level and leaves loops, subshells and pipes alone", () => {
    expect(splitTop("a && (b && c) | d; for x in 1 2; do npm ci; done").map((s: { text: string }) => s.text)).toEqual(["a", "(b && c)", "d", "for x in 1 2", "do npm ci", "done"]);
    const shared = { setup: { ok: true }, modelsDay: { ok: true } };
    expect(rewrite("npm ci && npm run models:day && npm run x", shared).cmd).toBe("true && true && npm run x");
    expect(rewrite("cd mcp-server && npm ci", shared).cmd).toBe("cd mcp-server && npm ci");
    expect(rewrite("for f in a; do npm ci; done", shared).cmd).toBe("for f in a; do npm ci; done");
    expect(rewrite("npm ci", { setup: { ok: false } }).blockedBy).toEqual(["setup"]);
  });

  it("slices per file and project the way Playwright filters (ink ≠ pdf-ink)", () => {
    const rep = { suites: [{ file: "ink.spec.ts", specs: [{ title: "a", tests: [{ projectName: "chromium", status: "expected" }] }] }, { file: "pdf-ink.spec.ts", specs: [{ title: "b", tests: [{ projectName: "chromium", status: "unexpected" }] }] }] };
    expect(slice(rep, ["e2e/ink.spec.ts"], ["chromium"])).toMatchObject({ code: 0, total: 1 });
    expect(slice(rep, ["e2e/pdf-ink.spec.ts"], ["chromium"]).code).toBe(1);
    expect(slice(rep, ["e2e/ink.spec.ts"], ["webkit"])).toMatchObject({ code: 1, total: 0 });
  });

  it("reads every lane's expect shape", () => {
    expect(normalize("exit 0 and reports/mac-pack/L4/W1.3.json .ok == true; e2e: e2e/x.spec.ts [chromium]; still owed after it (.owed): a phone").checks).toEqual([
      { kind: "exit", value: 0 },
      { kind: "json", file: "reports/mac-pack/L4/W1.3.json", path: ".ok", op: "==", value: true },
    ]);
    expect(normalize("exit 0 for both (mutation ≥ 80)").manual).toEqual(["for both (mutation ≥ 80)"]);
    expect(normalize({ check: "test -d node_modules/vite", means: "installed" }).checks).toEqual([{ kind: "shell", cmd: "test -d node_modules/vite" }]);
    expect(normalize({ exit: 0, file: "a.txt", regex: "ok\\. (\\d+) passed", group1Gte: 23 }).checks[1]).toMatchObject({ kind: "regex", group1Gte: 23 });
    expect(normalize({ exit: 0, count: { glob: "release/*.{apk,aab}", gte: 2 } }).checks[1]).toEqual({ kind: "count", glob: "release/*.{apk,aab}", gte: 2 });
  });

  it("loads the follow-up lanes' FC<n>.json after the L<n>.json lanes, each by number", () => {
    const e = (id: string) => [{ id, cmd: `run-${id}`, expect: { exit: 0 }, needs: [] }];
    const dir = root({ FC10: e("FC10-a"), L10: e("L10-a"), FC3: e("FC3-a"), L2: e("L2-a"), X1: e("X1-a") });
    expect(loadPacks(dir).map((x: { lane: string; id: string }) => `${x.lane}:${x.id}`)).toEqual(["L2:L2-a", "L10:L10-a", "FC3:FC3-a", "FC10:FC10-a"]);
  });

  it("loads the real packs of every lane: unique ids, every named need exists, no loop", () => {
    const all = loadPacks(REPO);
    expect(new Set(all.map((e: { lane: string }) => e.lane)).size).toBeGreaterThanOrEqual(8);
    const ordered = order(classify(all));
    expect(ordered).toHaveLength(all.length);
    const pos = new Map(ordered.map((e: { id: string }, i: number) => [e.id, i]));
    for (const e of ordered) for (const n of e.needIds) expect(pos.get(n)).toBeLessThan(pos.get(e.id));
  });
});

describe("owner index", () => {
  it("merges the action several lanes ask for into one row", () => {
    const rows = group([
      { lane: "L2", id: "L2-O-a", decision: "Turn Buildkite on once: create the Buildkite organisation", recommendation: "A" },
      { lane: "L7", id: "L7-b", decision: "Same Buildkite decision as W10.D4: gitleaks in the pipeline", recommendation: "A" },
      { lane: "L1", id: "L1/c", task: "W6.20", decision: "Run session 1" },
    ]);
    expect(rows[0]).toMatchObject({ key: "buildkite", first: true });
    expect(rows[0].items.map((i: { id: string }) => i.id)).toEqual(["L2-O-a", "L7-b"]);
    expect(rows).toHaveLength(2);
  });

  it("plan/owner-pack/index.md and index.he.md are what the lanes' JSON gives", () => {
    expect(loadOwnerPacks(REPO).length).toBeGreaterThan(0);
    expect(ownerIndex(["--check"], REPO)).toBe(0);
  });
});
