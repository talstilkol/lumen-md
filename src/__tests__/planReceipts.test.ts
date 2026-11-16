// @vitest-environment node
/**
 * Plan W10.G9 (W6.7): the verification level is computed from signed
 * receipts, not typed by hand. Every key and receipt here is made inside the
 * test (in memory or a temp folder) and thrown away; none is a real receipt.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs, no types
import { seal } from "../../scripts/nightly/receipt.mjs";
// @ts-expect-error — plain .mjs, no types
import { signedBytes } from "../../scripts/lib/independentReview.mjs";
import {
  checkReceiptClaims,
  computeLevels,
  evidenceOf,
  fingerprint,
  isManual,
  rank,
  reviewOf,
  verifySealed,
  // @ts-expect-error — plain .mjs, no types
} from "../../scripts/plan/receiptLevels.mjs";

const ROOT = resolve(__dirname, "../..");
const sha = (c: string) => c.repeat(40).slice(0, 40);
const HEAD = sha("a");
const TRAIN = sha("b");
const BASE = sha("c");
const OTHER = sha("d");

function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), pub: publicKey.export({ type: "spki", format: "pem" }).toString(), der: publicKey.export({ type: "spki", format: "der" }).toString("base64"), key: privateKey };
}
const ok = { ok: true };
const fullReport = (commit: string, suites: Record<string, unknown>) => ({ kind: "full", commit: { sha: commit }, suites });
const allSuites = { build: ok, vitest: ok, "e2e chromium": ok, "e2e firefox": ok, "e2e webkit": ok };

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("sealed receipts", () => {
  const k = testKey();
  const keys = new Map([[fingerprint(k.pub), k.pub]]);

  it("a receipt sealed with a trusted key verifies; changed, unsealed or foreign ones don't", () => {
    const sealed = seal(fullReport(TRAIN, allSuites), k.priv);
    expect(verifySealed(sealed, keys).ok).toBe(true);
    const changed = { ...sealed, suites: { ...sealed.suites, vitest: { ok: false } } };
    expect(verifySealed(changed, keys).problems[0]).toMatch(/changed after sealing/);
    expect(verifySealed(fullReport(TRAIN, allSuites), keys).problems).toEqual(["not sealed"]);
    const stranger = testKey();
    expect(verifySealed(seal(fullReport(TRAIN, allSuites), stranger.priv), keys).problems[0]).toMatch(/not trusted/);
  });

  it("a forged signature with the trusted fingerprint is refused", () => {
    const sealed = seal(fullReport(TRAIN, allSuites), k.priv);
    const other = seal(fullReport(TRAIN, { build: ok }), testKey().priv);
    const forged = { ...sealed, receipt: { ...sealed.receipt, signature: other.receipt.signature } };
    expect(verifySealed(forged, keys).problems).toEqual(["the signature does not verify"]);
  });
});

describe("what a receipt proves", () => {
  it("full: build → built, + vitest → node, + e2e in all three browsers → browser; a skipped suite proves nothing", () => {
    expect(evidenceOf(fullReport(TRAIN, { build: ok }))?.level).toBe("built");
    expect(evidenceOf(fullReport(TRAIN, { build: ok, vitest: ok }))?.level).toBe("node");
    expect(evidenceOf(fullReport(TRAIN, allSuites))?.level).toBe("browser");
    expect(evidenceOf(fullReport(TRAIN, { ...allSuites, "e2e webkit": { ok: true, skipped: true } }))?.level).toBe("node");
    expect(evidenceOf(fullReport(TRAIN, { build: { ok: false } }))?.level).toBe(null);
  });

  it("flake: browser only when every browser ran with nothing flaky or broken", () => {
    const b = (browser: string, extra = {}) => ({ browser, tests: 10, flaky: [], broken: [], ...extra });
    const clean = { kind: "flake", commit: { sha: TRAIN }, flake: { browsers: [b("chromium"), b("firefox"), b("webkit")] } };
    expect(evidenceOf(clean)?.level).toBe("browser");
    expect(evidenceOf({ ...clean, flake: { browsers: [b("chromium"), b("firefox"), b("webkit", { flaky: ["x"] })] } })?.level).toBe(null);
    expect(evidenceOf({ ...clean, flake: { browsers: [b("chromium"), b("firefox")] } })?.level).toBe(null);
  });

  it("real: only with the tasks it names and every check passed; a review receipt proves no level", () => {
    expect(evidenceOf({ kind: "real", commit: { sha: TRAIN }, real: { tasks: ["7.2"] }, checks: [ok] })).toMatchObject({ level: "real", tasks: ["7.2"] });
    expect(evidenceOf({ kind: "real", commit: { sha: TRAIN }, real: { tasks: [] }, checks: [ok] })?.level).toBe(null);
    expect(evidenceOf({ kind: "real", commit: { sha: TRAIN }, real: { tasks: ["7.2"] }, checks: [ok, { ok: false }] })?.level).toBe(null);
    expect(evidenceOf({ format: "lumen-review", head: HEAD })).toBe(null);
    expect(evidenceOf({ kind: "full", commit: { sha: "short" }, suites: allSuites })).toBe(null);
  });
});

describe("levels per task and per PR", () => {
  const tasks = [
    { id: "T1", pr: 10, claimed: "browser", phase: 0 },
    { id: "T2", pr: 10, claimed: "node", phase: 0 },
    { id: "T3", pr: 11, claimed: "node", phase: 1 },
    { id: "T4", claimed: "built", phase: 1 },
  ];
  const heads = { "10": HEAD, "11": OTHER };
  // TRAIN contains HEAD; nothing contains OTHER; BASE's objects are missing.
  const contains = (head: string, commit: string) => (commit === BASE ? null : head === HEAD && commit === TRAIN);

  it("a receipt counts only on a commit that contains the PR's current head", () => {
    const r = computeLevels({ tasks, heads, contains, evidence: [{ ...evidenceOf(fullReport(TRAIN, allSuites)), source: "f" }] });
    expect(r.tasks.T1.computed).toBe("browser");
    expect(r.tasks.T3.computed).toBe(null); // pushed after the run: stale
    expect(r.tasks.T4.note).toBe("no PR");
    expect(r.prs["10"]).toMatchObject({ head: HEAD, computed: "browser", tasks: ["T1", "T2"] });
    expect(r.counts.computed).toMatchObject({ browser: 2, none: 2 });
    expect(r.counts.manual).toBe(1); // T3 claims node, nothing proves it
  });

  it("missing git objects are counted as unknown, never guessed", () => {
    const r = computeLevels({ tasks, heads, contains, evidence: [{ commit: BASE, level: "node", kind: "full", source: "f" }] });
    expect(r.unknown).toBe(3); // T1, T2 and T3 each against the missing commit
    expect(r.tasks.T1.computed).toBe(null);
  });

  it("real is the named task's, not every task in the PR", () => {
    const r = computeLevels({ tasks, heads, contains, evidence: [{ commit: TRAIN, level: "real", kind: "real", tasks: ["T2"], source: "r" }] });
    expect(r.tasks.T2.computed).toBe("real");
    expect(r.tasks.T1.computed).toBe(null);
    expect(r.prs["10"].computed).toBe(null);
  });

  it("built is the floor; owner ranks as browser", () => {
    expect(isManual("built", null)).toBe(false);
    expect(isManual("node", null)).toBe(true);
    expect(isManual("owner", "browser")).toBe(false);
    expect(isManual("owner", "node")).toBe(true);
    expect(rank("real")).toBeGreaterThan(rank("owner"));
  });
});

describe("independent review from signed receipts (pr:check's rules)", () => {
  const reviewer = testKey();
  const registry = { keys: new Map([["lane-r", createPublicKey(reviewer.pub)]]), identities: new Map([["lane-r", ["lane-r", "lane-r-login", "r@example.invalid"]]]), problems: [] };
  const receipt = (over: Record<string, unknown> = {}) => {
    const r: Record<string, unknown> = {
      format: "lumen-review",
      version: 1,
      pr: 10,
      base: BASE,
      head: HEAD,
      author: "lane-a",
      reviewer: "lane-r",
      access: "read-only",
      date: "2026-11-16T00:00:00Z",
      files: ["src/sync/x.ts"],
      attackTests: [{ path: "security/attacks/x.test.ts", result: "1/1 pass" }],
      findings: [],
      verdict: "approve",
      ...over,
    };
    return { ...r, signature: sign(null, signedBytes(r), reviewer.key).toString("base64") };
  };
  const pr = { number: 10, head: HEAD, base: BASE, sensitive: [{ file: "src/sync/x.ts", pattern: "/src/sync/" }], reviewers: registry, excluded: new Set(["lane-a"]) };

  it("a signed receipt for this PR, base and head counts", () => {
    expect(reviewOf(pr, [{ source: "file", receipt: receipt() }])).toMatchObject({ status: "signed", reviewer: "lane-r" });
    expect(reviewOf(pr, [])).toEqual({ status: "none" });
  });

  it("unsigned, changed, stale, by the author, or from a stranger's comment: rejected", () => {
    const { signature: _s, ...unsigned } = receipt();
    void _s;
    const cases = [
      { receipt: unsigned, why: /not signed/ },
      { receipt: { ...receipt(), verdict: "approve", findings: [{ id: "x", severity: "high", status: "open" }] }, why: /signature does not verify/ },
      { receipt: receipt({ head: OTHER }), why: /not the head/ },
      { receipt: receipt({ files: ["docs/x.md"] }), why: /does not cover/ },
    ];
    for (const c of cases) {
      const v = reviewOf(pr, [{ source: "file", receipt: c.receipt }]);
      expect(v.status).toBe("rejected");
      expect(v.why.join(" ")).toMatch(c.why);
    }
    expect(reviewOf({ ...pr, excluded: new Set(["lane-r-login"]) }, [{ source: "f", receipt: receipt() }]).why.join(" ")).toMatch(/author or wrote or committed/);
    expect(reviewOf({ ...pr, reviewers: null }, [{ source: "f", receipt: receipt() }]).why.join(" ")).toMatch(/reviewers\.json is missing/);
    expect(reviewOf(pr, [{ source: "c", receipt: receipt(), rejected: "@x has no write access" }]).status).toBe("rejected");
  });
});

describe("plan:check holds the plan's levels to the receipts", () => {
  const plan = (verified: string) => ({ phases: [{ tasks: [{ id: "T1", verified }, { id: "T2", verified: "built" }] }] });
  const receipts = (computed: string | null) => ({ tasks: { T1: { computed }, T2: { computed: null } } });

  it("real without a receipt that proves it always fails", () => {
    expect(checkReceiptClaims(plan("real"), null).problems[0]).toMatch(/T1: verified "real".*no entry/);
    expect(checkReceiptClaims(plan("real"), receipts("browser")).problems[0]).toMatch(/prove browser/);
    expect(checkReceiptClaims(plan("real"), receipts("real")).problems).toEqual([]);
  });

  it("a typed level above the receipts is counted, and fails with strict", () => {
    expect(checkReceiptClaims(plan("browser"), receipts("node"))).toEqual({ problems: [], manual: ["T1"] });
    expect(checkReceiptClaims(plan("browser"), receipts("node"), { strict: true }).problems[0]).toMatch(/T1: verified "browser" but the receipts prove node/);
    expect(checkReceiptClaims(plan("browser"), receipts("browser"), { strict: true })).toEqual({ problems: [], manual: [] });
    expect(checkReceiptClaims(plan("owner"), receipts("browser"), { strict: true }).manual).toEqual([]);
  });
});

describe("npm run plan:receipts", () => {
  it("counts a sealed receipt from the trusted keys and rejects a tampered one, writing only --out", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-receipts-"));
    tmp.push(dir);
    const k = testKey();
    mkdirSync(join(dir, "r", "keys"), { recursive: true });
    writeFileSync(join(dir, "r", "keys", "host.pem"), k.pub);
    const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
    const task = plan.phases.flatMap((p: { tasks: { id: string; pr?: number }[] }) => p.tasks).find((t: { pr?: number }) => t.pr);
    // The commit the receipt names is the PR head itself, so no git object is needed.
    writeFileSync(join(dir, "r", "good.json"), JSON.stringify(seal(fullReport(HEAD, allSuites), k.priv)));
    const bad = seal(fullReport(HEAD, allSuites), k.priv);
    writeFileSync(join(dir, "r", "bad.json"), JSON.stringify({ ...bad, suites: { build: ok } }));
    writeFileSync(join(dir, "heads.json"), JSON.stringify({ [String(task.pr)]: HEAD }));
    const out = join(dir, "out.json");
    const r = spawnSync(process.execPath, ["scripts/plan/receipts.mjs", "--receipts", join(dir, "r"), "--pr-heads", join(dir, "heads.json"), "--out", out], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const res = JSON.parse(readFileSync(out, "utf8"));
    expect(res.sources.evidence).toBe(1);
    expect(res.sources.rejected.map((x: { why: string }) => x.why).join()).toMatch(/changed after sealing/);
    expect(res.tasks[task.id].computed).toBe("browser");
    expect(res.prs[String(task.pr)].computed).toBe("browser");
  });
});
