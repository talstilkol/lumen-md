/**
 * Plan W13.W2 — `npm run eval:card -- --agent <id>` and `-- --suite writing
 * --check`: a writing agent passes only with a complete card whose dataset
 * version is its set's current manifest, on ≥ 150 items per language.
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — a plain .mjs module without types
import { main } from "../../scripts/eval-card.mjs";

const ROOT = join(__dirname, "../..");

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "evalcard-w-"));
  cpSync(join(ROOT, "eval/writing"), join(dir, "eval/writing"), { recursive: true });
  cpSync(join(ROOT, "eval/cards/writing"), join(dir, "eval/cards/writing"), { recursive: true });
  return dir;
}
const run = (argv: string[], root: string) => {
  const out: string[] = [];
  const code = main(argv, { root, log: (s: string) => out.push(s), err: (s: string) => out.push(s) });
  return { code, out: out.join("\n") };
};

describe("eval:card for the writing agents (W13.W2)", () => {
  it("the committed cards pass, one agent at a time and as a suite", () => {
    for (const a of ["styleCoach", "toneShifter", "concision"]) expect(run(["--agent", a], ROOT).code).toBe(0);
    const r = run(["--suite", "writing", "--check"], ROOT);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/3\/3 writing agents/);
  });

  it("an agent without a card fails", () => {
    expect(run(["--agent", "noSuchAgent"], ROOT).code).toBe(1);
  });

  it("a stale card fails: the set changed after the card was written", () => {
    const dir = sandbox();
    const f = join(dir, "eval/writing/styleCoach/en.jsonl");
    writeFileSync(f, readFileSync(f, "utf8") + JSON.stringify({ id: "extra", lang: "en", split: "dev", origin: "synthetic", level: "professional", text: "x", expect: [] }) + "\n");
    const r = run(["--agent", "styleCoach"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/does not match its manifest/);
  });

  it("an incomplete card fails, and so does a synthetic set tagged heldout", () => {
    const dir = sandbox();
    const p = join(dir, "eval/cards/writing/toneShifter.json");
    const rep = JSON.parse(readFileSync(p, "utf8"));
    rep.card.tag = "heldout";
    writeFileSync(p, JSON.stringify(rep));
    expect(run(["--agent", "toneShifter"], dir).out).toMatch(/synthetic/);
    delete rep.card.model;
    writeFileSync(p, JSON.stringify(rep));
    expect(run(["--suite", "writing", "--check"], dir).code).toBe(1);
  });

  it("the committed sets are exactly what the generator writes (scripts/eval/writing-sets.mjs --check)", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/eval/writing-sets.mjs"), "--check"], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("a folder of eval/writing without a manifest fails the suite (review 13 M3: plain fixtures live in eval/fixtures/writing)", () => {
    const dir = sandbox();
    mkdirSync(join(dir, "eval/writing/plainFixtures"), { recursive: true });
    writeFileSync(join(dir, "eval/writing/plainFixtures/en.jsonl"), "{}\n");
    const r = run(["--suite", "writing", "--check"], dir);
    expect(r.out).toMatch(/eval\/writing\/plainFixtures has no manifest\.json/);
    expect(r.out).toMatch(/3\/4 writing agents/);
    expect(r.code).toBe(1);
  });

  it("--check is the gate: without it the suite only reports; with no suite it is refused", () => {
    const dir = sandbox();
    mkdirSync(join(dir, "eval/writing/plainFixtures"), { recursive: true });
    const report = run(["--suite", "writing"], dir);
    expect(report.code).toBe(0);
    expect(report.out).toMatch(/report only/);
    expect(run(["--suite", "writing", "--check"], dir).code).toBe(1);
    expect(run(["--check"], ROOT).code).toBe(2);
  });

  it("a writing card whose dataset.name is not a path in the repository fails", () => {
    const dir = sandbox();
    const p = join(dir, "eval/cards/writing/styleCoach.json");
    const rep = JSON.parse(readFileSync(p, "utf8"));
    rep.card.dataset.name = "eval/writing/styleCoach-gone";
    writeFileSync(p, JSON.stringify(rep));
    const r = run(["--agent", "styleCoach"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/card\.dataset\.name eval\/writing\/styleCoach-gone: no such file or folder/);
    // A note after the path is allowed; the path itself must be there.
    expect(run(["eval/cards/writing"], ROOT).code).toBe(0);
  });

  it("an unknown suite is refused", () => {
    expect(run(["--suite", "nope"], ROOT).code).toBe(1);
  });
});
