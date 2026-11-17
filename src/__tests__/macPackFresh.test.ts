/**
 * Review 12, H1: `npm run mac:pack` must never count an old result as a pass.
 * Before the fix, a shell `check` read committed files (eval/results/…) with
 * no freshness check, a `run` entry with no `exit` in its expect never looked
 * at its exit code, the shared e2e step held whenever its report existed,
 * entries that still need their own run or a person left the summary "ok",
 * and L7-W10.D13's "then exit 0 of: …" was read as person-only.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { classify, loadPacks, main, runAll } from "../../scripts/mac-pack/run-all.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { normalize } from "../../scripts/mac-pack/lib/expect.mjs";

const REPO = resolve(__dirname, "../..");
const OLD = new Date(2020, 0, 1);

type Entry = Record<string, unknown>;
type Res = { id: string; status: string; checks: { kind: string; ok: boolean; actual: unknown }[] };
function root(packs: Record<string, Entry[]>) {
  const dir = mkdtempSync(join(tmpdir(), "macfresh-"));
  mkdirSync(join(dir, "plan/mac-pack"), { recursive: true });
  for (const [lane, list] of Object.entries(packs)) writeFileSync(join(dir, `plan/mac-pack/${lane}.json`), JSON.stringify(list));
  return dir;
}
const git = (dir: string, ...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
/** A runner: `plant[cmd]` = {code, files} — writes the files, returns the code; anything else runs in bash. */
function runner(dir: string, plant: Record<string, { code: number; files?: Record<string, unknown> }>) {
  return async (cmd: string) => {
    const p = plant[cmd];
    if (!p) {
      try {
        execFileSync("bash", ["-c", cmd], { cwd: dir, stdio: "ignore" });
        return { code: 0, stdout: "" };
      } catch (e) {
        return { code: (e as { status?: number }).status ?? 1, stdout: "" };
      }
    }
    for (const [f, body] of Object.entries(p.files ?? {})) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), JSON.stringify(body));
    }
    return { code: p.code, stdout: "" };
  };
}
const byId = (sum: { entries: Res[] }, id: string) => sum.entries.find((e) => e.id === id) as Res;
const jqOk = (f: string) => `node -e "process.exit(JSON.parse(require('fs').readFileSync('${f}','utf8')).ok===true?0:1)" && cat ${f}`;

describe("mac:pack reads only what this run wrote (review 12, H1)", () => {
  it("an old committed result does not pass a shell check, and the committed file is put back untouched", async () => {
    const res = "eval/results/card.json";
    const dir = root({ L5: [{ id: "L5.card", cmd: "make-card", expect: { check: `test -s ${res} && grep -q '\"ok\": *true' ${res}`, means: "the card" } }] });
    mkdirSync(join(dir, "eval/results"), { recursive: true });
    writeFileSync(join(dir, res), '{"ok": true}\n');
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qm", "planted");
    utimesSync(join(dir, res), OLD, OLD);
    // The run "succeeds" but writes nothing: only the committed card is there.
    const sum = await runAll({ root: dir, exec: runner(dir, { "make-card": { code: 0 } }) });
    expect(byId(sum, "L5.card").status).toBe("fail");
    expect(sum.ok).toBe(false);
    expect(readFileSync(join(dir, res), "utf8")).toBe('{"ok": true}\n');
    expect(git(dir, "status", "--porcelain", "--", "eval")).toBe("");
    expect(existsSync(join(dir, ".mac-pack/aside/L5.card"))).toBe(false);
  });

  it("a file written by this run passes the same shell check; a file still older than the run is refused as stale", async () => {
    const dir = root({ L5: [
      { id: "L5.fresh", cmd: "write-it", expect: { check: jqOk("/tmp/x-never") } },
      { id: "L5.made", cmd: "make", expect: { check: jqOk("out/r.json") } },
    ] });
    const sum = await runAll({ root: dir, exec: runner(dir, { make: { code: 0, files: { "out/r.json": { ok: true } } }, "write-it": { code: 0 } }) });
    expect(byId(sum, "L5.made").status).toBe("pass");
    expect(byId(sum, "L5.fresh").status).toBe("fail");
    // An entry whose command is shared with an earlier one is not moved aside again: the staleness check stands.
    const dir2 = root({ L5: [
      { id: "L5.a", cmd: "same", expect: { exit: 0 } },
      { id: "L5.b", cmd: "same", expect: { check: jqOk("old.json") } },
    ] });
    writeFileSync(join(dir2, "old.json"), '{"ok":true}');
    utimesSync(join(dir2, "old.json"), OLD, OLD);
    const s2 = await runAll({ root: dir2, exec: runner(dir2, { same: { code: 0 } }) });
    const b = byId(s2, "L5.b");
    expect(b.status).toBe("fail");
    expect(String(b.checks.find((c) => c.kind === "shell")?.actual)).toMatch(/stale: old\.json/);
  });

  it("a run entry with no exit in its expect still fails on a non-zero exit; an expect that names another code keeps it", async () => {
    const dir = root({ L3: [
      { id: "L3-json", cmd: "boom", expect: { json: [{ file: "r.json", path: "ok", op: "==", value: true }] } },
      { id: "L3-refuse", cmd: "refuse", expect: "exit 1; r2.json: .refused == true" },
    ] });
    const sum = await runAll({ root: dir, exec: runner(dir, { boom: { code: 1, files: { "r.json": { ok: true } } }, refuse: { code: 1, files: { "r2.json": { refused: true } } } }) });
    expect(byId(sum, "L3-json").status).toBe("fail");
    expect(byId(sum, "L3-json").checks[0]).toMatchObject({ kind: "exit", ok: false, actual: 1 });
    expect(byId(sum, "L3-refuse").status).toBe("pass");
  });

  it("the shared e2e step does not hold on a report left by an earlier run", async () => {
    const dir = root({ L8: [{ id: "L8-e2e", cmd: "PLAYWRIGHT_JSON_OUTPUT_NAME=reports/mac-pack/L8/ink.json npx playwright test e2e/ink.spec.ts --project=chromium --reporter=json", expect: { exit: 0 } }] });
    mkdirSync(join(dir, "reports/mac-pack/shared"), { recursive: true });
    writeFileSync(join(dir, "reports/mac-pack/shared/e2e.pw.json"), JSON.stringify({ suites: [], stats: { expected: 1, unexpected: 0 } }));
    utimesSync(join(dir, "reports/mac-pack/shared/e2e.pw.json"), OLD, OLD);
    const sum = await runAll({ root: dir, exec: async () => ({ code: 1, stdout: "" }) });
    expect(sum.shared.find((s: { id: string }) => s.id === "e2e").ok).toBe(false);
    expect(byId(sum, "L8-e2e").status).toBe("blocked");
  });

  it("own-run entries and parts for a person make the run incomplete, never ok (CLI exit 3)", async () => {
    const own = root({ L2: [
      { id: "L2-ok", cmd: "true", expect: { exit: 0 } },
      { id: "L2-rel", cmd: "git switch -c rel abc && npm run release", expect: { exit: 0 } },
    ] });
    const s1 = await runAll({ root: own, exec: runner(own, {}) });
    expect(s1.result).toBe("incomplete");
    expect(s1.ok).toBe(false);
    expect(await main(["--root", own])).toBe(3);
    const person = root({ L4: [{ id: "L4-x", cmd: "true", expect: "exit 0; look at the PDF on a phone" }] });
    const s2 = await runAll({ root: person, exec: runner(person, {}) });
    expect(byId(s2, "L4-x").status).toBe("pass");
    expect(s2.result).toBe("incomplete");
    const good = root({ L1: [{ id: "L1-y", cmd: "true", expect: { exit: 0 } }] });
    expect(await main(["--root", good])).toBe(0);
  });

  it("L7-W10.D13's 'then exit 0 of: …' is a machine check, and no real run entry is left without one", () => {
    const d13 = loadPacks(REPO).find((e: { id: string }) => e.id === "L7-W10.D13");
    const n = normalize(d13.expect);
    expect(n.checks).toEqual([{ kind: "shell", cmd: expect.stringMatching(/^npx vitest run src\/__tests__\/cryptoDifferential\.test\.ts && npm run build/) }]);
    expect(n.manual).toEqual(["follow steps 1–6 of docs/security/crypto-libs.md"]);
    const bare = classify(loadPacks(REPO)).filter((e: { mode: string; norm: { checks: unknown[] } }) => e.mode === "run" && e.norm.checks.length === 0);
    expect(bare.map((e: { id: string }) => e.id)).toEqual([]);
  });
});
