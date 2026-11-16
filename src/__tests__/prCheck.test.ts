/**
 * Plan 0.19 — `npm run pr:check` (scripts/pr-check.mjs), the local PR gate
 * that replaces Danger: run against a throwaway git repository with a real
 * history, a real diff and real bundle-budget output.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — plain .mjs module without type declarations
import { parseArgs, report, runChecks } from "../../scripts/pr-check.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { REQUIRED_SECTIONS } from "../../scripts/lib/prGate.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { keygen, registryEntry, signReceipt } from "../../scripts/review-sign.mjs";

const ROOT = resolve(__dirname, "../..");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-prcheck-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.org");
  git("config", "user.name", "T");
  mkdirSync(join(dir, "src/ai"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "src/ai/privacyLedger.ts"), 'const RULES = [{ host: "api.openai.com" }];\n');
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/ok": { version: "1.0.0", license: "MIT" } } }));
  // The budget script with what it loads: its budgets (W6.26) and libraries.
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  for (const f of ["scripts/bundle-budget.mjs", "scripts/bundle-budgets.json", "scripts/lib/budgetRatchet.mjs", "scripts/lib/sourcemaps.mjs"]) cpSync(join(ROOT, f), join(dir, f));
  git("add", "-A");
  git("commit", "-q", "-m", "base [skip ci]");
  return { dir, git, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const body = REQUIRED_SECTIONS.map((h: string) => `${h}\n\ncontent`).join("\n\n");

describe("pr:check", () => {
  it("a clean PR passes: [skip ci], body, ledger, licences, sizes against the base's", () => {
    const r0 = repo();
    try {
      writeFileSync(join(r0.dir, "src/a.ts"), 'export const a = 2;\nexport const go = () => fetch("https://api.openai.com/v1/x");\n');
      mkdirSync(join(r0.dir, "src/__tests__"));
      writeFileSync(join(r0.dir, "src/__tests__/a.test.ts"), "test\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "feat: a [skip ci]");
      writeFileSync(join(r0.dir, "body.md"), body);
      writeFileSync(join(r0.dir, "base.json"), JSON.stringify({ totalKb: 100, classes: { "main bundle": { kb: 90, files: 1 }, other: { kb: 10, files: 1 } } }));
      // A real dist/ for the real bundle-budget script: one small app chunk.
      mkdirSync(join(r0.dir, "dist/assets"), { recursive: true });
      writeFileSync(join(r0.dir, "dist/assets/app-abc123.js"), "x".repeat(5000));
      const r = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--body", "body.md", "--base-sizes", join(r0.dir, "base.json")]));
      const by = Object.fromEntries(r.sections.map((s: { title: string; status: string }) => [s.title, s.status]));
      expect(by).toMatchObject({ "Commits carry [skip ci]": "ok", "PR body sections": "ok", "Network calls in the privacy ledger": "ok", "The project's domain": "ok", Tests: "ok", "Bundle size": "ok" });
      expect(r.failed).toBe(false);
      const md = report(r);
      expect(md).toContain("| main bundle | 90.0 KB |");
      expect(md).toContain("**PR check: passed.**");
    } finally {
      r0.done();
    }
  });

  it("fails on a subject without [skip ci], a missing section, an unregistered fetch, the domain, a GPL package", () => {
    const r0 = repo();
    try {
      const dom = ["lumen", "md"].join(".");
      writeFileSync(join(r0.dir, "src/a.ts"), `export const t = () => fetch("https://tracker.example.io/c");\n// see https://${dom}/x\n`);
      writeFileSync(join(r0.dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/ok": { version: "1.0.0", license: "MIT" }, "node_modules/copyleft": { version: "2.0.0", license: "GPL-3.0" } } }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "feat: track");
      writeFileSync(join(r0.dir, "body.md"), "## What and why\n\nx\n");
      const r = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--body", "body.md", "--no-size"]));
      const by = Object.fromEntries(r.sections.map((s: { title: string; status: string }) => [s.title, s.status]));
      expect(by).toMatchObject({ "Commits carry [skip ci]": "fail", "PR body sections": "fail", "Network calls in the privacy ledger": "fail", "The project's domain": "fail", "Licences of production packages": "fail", Tests: "warn", "Bundle size": "skipped" });
      expect(r.failed).toBe(true);
      const md = report(r);
      expect(md).toContain("- `feat: track`");
      expect(md).toContain("host not in the privacy ledger: tracker.example.io");
      expect(md).toContain("| copyleft | 2.0.0 | GPL-3.0 | new | fail |");
      expect(md).toContain("**PR check: failed.**");
    } finally {
      r0.done();
    }
  });

  it("W10.D20: a snapshot edited with nothing that produces it fails; regenerated with its source, it passes", () => {
    const r0 = repo();
    try {
      mkdirSync(join(r0.dir, "src/__tests__/__snapshots__/render"), { recursive: true });
      writeFileSync(join(r0.dir, "src/__tests__/__snapshots__/render/doc-a.html"), "<p>a</p>\n");
      writeFileSync(join(r0.dir, "README.md"), "# A\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "test: snapshot [skip ci]");
      // A hand edit: the snapshot moves, nothing that renders it does.
      writeFileSync(join(r0.dir, "src/__tests__/__snapshots__/render/doc-a.html"), "<p>whatever passes</p>\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "test: snapshot edit [skip ci]");
      const edited = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      const gate = edited.sections.find((s: { title: string }) => s.title === "Snapshots are regenerated, not edited");
      expect(gate.status).toBe("fail");
      expect(gate.lines[0]).toContain("src/__tests__/__snapshots__/render/doc-a.html");
      expect(edited.failed).toBe(true);
      // A README edit does not vouch for it (audit r3: README.md renders into no snapshot).
      writeFileSync(join(r0.dir, "README.md"), "# A, changed\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "docs: readme [skip ci]");
      const readme = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~2", "--no-size"]));
      expect(readme.sections.find((s: { title: string }) => s.title === "Snapshots are regenerated, not edited").status).toBe("fail");
      // The same snapshot with a document the render set reads: regenerated, fine.
      writeFileSync(join(r0.dir, "SECURITY.md"), "# Security, changed\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "docs: a [skip ci]");
      const regenerated = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~3", "--no-size"]));
      expect(regenerated.sections.find((s: { title: string }) => s.title === "Snapshots are regenerated, not edited").status).toBe("ok");
    } finally {
      r0.done();
    }
  });

  it("fails a diff that brings a max-lines baseline back (W6.25; W10.E31: the gate has none)", () => {
    const r0 = repo();
    try {
      writeFileSync(join(r0.dir, "src/a.ts"), "export const a = 2;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "fix: a [skip ci]");
      const clean = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      expect(clean.sections.find((s: { title: string }) => s.title === "Max-lines has no baseline").status).toBe("ok");
      writeFileSync(join(r0.dir, "scripts/max-lines-baseline.json"), JSON.stringify({ max: 800, files: { "src/big.ts": 900 } }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: baseline [skip ci]");
      const back = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      const gate = back.sections.find((s: { title: string }) => s.title === "Max-lines has no baseline");
      expect(gate.status).toBe("fail");
      expect(gate.lines).toEqual(["- `scripts/max-lines-baseline.json` exists. The gate allows no exceptions: split the file instead."]);
      expect(back.failed).toBe(true);
    } finally {
      r0.done();
    }
  });

  it("plan W4.28: a sensitive path fails with --pr until the human-reviewed label is newer than the last commit", () => {
    const r0 = repo();
    try {
      mkdirSync(join(r0.dir, ".github"));
      writeFileSync(join(r0.dir, ".github/CODEOWNERS"), "/src/sync/e2ee/ @talstilkol\n");
      // W10.D3: only receipts signed with a key in security/reviewers.json count.
      const sKey = keygen();
      mkdirSync(join(r0.dir, "security"));
      writeFileSync(join(r0.dir, "security/reviewers.json"), JSON.stringify({ reviewers: registryEntry("S", sKey.privatePem, { login: "s-rev", emails: ["s@example.org"] }) }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: owners [skip ci]");
      mkdirSync(join(r0.dir, "src/sync/e2ee"), { recursive: true });
      writeFileSync(join(r0.dir, "src/sync/e2ee/kdf.ts"), "export const iterations = 600000;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "feat: kdf [skip ci]");
      const head = r0.git("rev-parse", "HEAD").trim();
      const pr = (labels: string[], labelledAt: string, sha = head) => () => ({
        number: 9, labels, author: "a", headSha: sha, headDate: "2026-11-12T09:00:00Z", reviews: [],
        events: labels.length ? [{ event: "labeled", label: "human-reviewed", created_at: labelledAt, actor: "a" }] : [],
      });
      const status = (o: Record<string, unknown>) => runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size", ...(o.pr ? ["--pr", "9"] : [])]), ...o }).sections.find((s: { title: string }) => s.title === "Human review of sensitive paths");
      expect(status({}).status).toBe("warn");
      expect(status({ pr: "9", loadPr: pr([], "") }).status).toBe("fail");
      expect(status({ pr: "9", loadPr: pr(["human-reviewed"], "2026-11-12T08:00:00Z") }).status).toBe("fail");
      expect(status({ pr: "9", loadPr: pr(["human-reviewed"], "2026-11-12T10:00:00Z") }).status).toBe("ok");
      const other = status({ pr: "9", loadPr: pr(["human-reviewed"], "2026-11-12T10:00:00Z", "f".repeat(40)) });
      expect(other.status).toBe("fail");
      expect(other.lines[0]).toMatch(/is not PR #9's head/);
    } finally {
      r0.done();
    }
  });

  it("fails a diff that raises a budget, extends an exception or loosens a perf limit (W6.26), and passes one that lowers them", () => {
    const r0 = repo();
    try {
      const budgets = JSON.parse(readFileSync(join(r0.dir, "scripts/bundle-budgets.json"), "utf8"));
      writeFileSync(join(r0.dir, "perf-gate.config.json"), JSON.stringify({ runs: 5, profiles: { desktop: { assert: { fcp: { error: 1200 }, lcp: { error: 3500 } } } } }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: perf config [skip ci]");
      const set = (startup: number, exp: string, fcp: number) => {
        const b = structuredClone(budgets);
        b.startup.budgetKb = startup;
        b.rules.find((r: { expires?: string }) => r.expires).expires = exp;
        writeFileSync(join(r0.dir, "scripts/bundle-budgets.json"), JSON.stringify(b, null, 2));
        writeFileSync(join(r0.dir, "perf-gate.config.json"), JSON.stringify({ runs: 5, profiles: { desktop: { assert: { fcp: { error: fcp }, lcp: { error: 3500 } } } } }));
        r0.git("add", "-A");
        r0.git("commit", "-q", "-m", "chore: budgets [skip ci]");
      };
      const exp = budgets.rules.find((r: { expires?: string }) => r.expires).expires;
      set(budgets.startup.budgetKb + 10, "2099-01-01", 1500);
      const up = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      const gate = up.sections.find((s: { title: string }) => s.title === "Budgets only go down");
      expect(gate.status).toBe("fail");
      expect(gate.lines.slice(0, 3)).toEqual([
        `- \`scripts/bundle-budgets.json\` startup total: ${budgets.startup.budgetKb} → ${budgets.startup.budgetKb + 10} (raised).`,
        `- \`scripts/bundle-budgets.json\` vendor: excalidraw core: ${exp} → 2099-01-01 (an exception's expiry moved later).`,
        "- `perf-gate.config.json` desktop fcp error: 1200 → 1500 (raised).",
      ]);
      expect(up.failed).toBe(true);
      set(budgets.startup.budgetKb - 10, exp, 1100);
      const down = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      expect(down.sections.find((s: { title: string }) => s.title === "Budgets only go down")).toMatchObject({ status: "ok", lines: ["`scripts/bundle-budgets.json`, `perf-gate.config.json`: nothing raised."] });
    } finally {
      r0.done();
    }
  });

  it("W10.D14: dependency review — a changed lockfile at a known-bad version fails", () => {
    const r0 = repo();
    try {
      mkdirSync(join(r0.dir, "security"));
      writeFileSync(join(r0.dir, "security/known-bad.json"), JSON.stringify({ entries: [{ file: "package-lock.json", name: "nanoid", range: "<3.3.16", severity: "high", advisories: ["GHSA-28wg-ghj8-5hjv"], status: "fixed" }] }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: known-bad [skip ci]");
      const section = () => runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]) }).sections.find((x: { title: string }) => x.title === "Dependency review");
      expect(section().status).toBe("ok"); // only known-bad.json changed, nothing is at a bad version
      const lock = (v: string) => JSON.stringify({ packages: { "node_modules/ok": { version: "1.0.0", license: "MIT" }, "node_modules/nanoid": { version: v, license: "MIT" } } });
      writeFileSync(join(r0.dir, "package-lock.json"), lock("3.3.3"));
      r0.git("commit", "-qam", "deps: nanoid [skip ci]");
      const bad = section();
      expect(bad.status).toBe("fail");
      expect(bad.lines.join("\n")).toMatch(/nanoid is back at a known-bad version: 3\.3\.3/);
      writeFileSync(join(r0.dir, "package-lock.json"), lock("3.3.20"));
      r0.git("commit", "-qam", "deps: nanoid fixed [skip ci]");
      expect(section().status).toBe("ok");
    } finally {
      r0.done();
    }
  });

  it("plan W6.11: a sensitive path fails with --pr or --review until an independent receipt for the head is there", () => {
    const r0 = repo();
    try {
      mkdirSync(join(r0.dir, ".github"));
      writeFileSync(join(r0.dir, ".github/CODEOWNERS"), "/src/sync/e2ee/ @talstilkol\n");
      // W10.D3: only receipts signed with a key in security/reviewers.json count; T6-H1: the merge base's copy.
      const sKey = keygen();
      const tKey = keygen();
      mkdirSync(join(r0.dir, "security"));
      writeFileSync(join(r0.dir, "security/reviewers.json"), JSON.stringify({ reviewers: { ...registryEntry("S", sKey.privatePem, { login: "s-rev", emails: ["s@example.org"] }), ...registryEntry("T", tKey.privatePem, { login: "t-rev", emails: ["t@example.org"] }) } }));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: owners [skip ci]");
      const base = r0.git("rev-parse", "HEAD").trim();
      mkdirSync(join(r0.dir, "src/sync/e2ee"), { recursive: true });
      writeFileSync(join(r0.dir, "src/sync/e2ee/kdf.ts"), "export const iterations = 600000;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "feat: kdf [skip ci]");
      const head = r0.git("rev-parse", "HEAD").trim();
      const unsigned = (o: Record<string, unknown> = {}) => ({
        format: "lumen-review", version: 1, pr: 9, base, head, author: "K", reviewer: "S", access: "read-only", date: "2026-11-12T18:00:00Z",
        files: ["/src/sync/e2ee/"], attackTests: [{ path: "src/__tests__/kdfAttack.test.ts", result: "4/4 pass" }], findings: [], verdict: "approve", ...o,
      });
      const receipt = (o: Record<string, unknown> = {}) => signReceipt(unsigned(o), sKey.privatePem);
      const comment = (r: object) => "Review\n\n```lumen-review\n" + JSON.stringify(r) + "\n```\n";
      const pr = (bodies: string[]) => () => ({ number: 9, labels: [], author: "a", headSha: head, headDate: "2026-11-12T09:00:00Z", reviews: [], events: [], comments: bodies.map((body, i) => ({ id: i + 1, user: "rev", association: "OWNER", body })) });
      const section = (o: Record<string, unknown>, extra: string[] = []) =>
        runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", base, "--no-size", ...(o.pr ? ["--pr", "9"] : []), ...extra]), loadOpenPrs: () => [], ...o }).sections.find((s: { title: string }) => s.title === "Independent review of sensitive paths");
      expect(section({}).status).toBe("warn");
      expect(section({ pr: "9", loadPr: pr([]) }).status).toBe("fail");
      expect(section({ pr: "9", loadPr: pr([comment(receipt())]) }).status).toBe("ok");
      // Review 14.11: a comment by an account without write access (anyone, on a public repository) does not count.
      const stranger = () => ({ ...pr([])(), comments: [{ id: 7, user: "someone", association: "NONE", body: comment(receipt()) }] });
      const st = section({ pr: "9", loadPr: stranger });
      expect(st.status).toBe("fail");
      expect(st.lines.join("\n")).toMatch(/@someone has no write access/);
      // A push after the review: the receipt is for an older head.
      const stale = section({ pr: "9", loadPr: pr([comment(receipt({ head: "a".repeat(40) }))]) });
      expect(stale.status).toBe("fail");
      expect(stale.lines.join("\n")).toMatch(/not the head/);
      // The author reviewing itself, or an open high finding, does not count.
      expect(section({ pr: "9", loadPr: pr([comment(receipt({ reviewer: "k" }))]) }).status).toBe("fail");
      expect(section({ pr: "9", loadPr: pr([comment(receipt({ findings: [{ id: "F1", severity: "high", status: "open" }] }))]) }).status).toBe("fail");
      // W10.D3: unsigned does not count; T6-M1: the comment's account (every lane posts as the
      // owner's) is no reason — but a reviewer who opened the PR, or wrote or committed a
      // commit in the range (here git user "T"), does not count.
      expect(section({ pr: "9", loadPr: pr([comment(unsigned())]) }).lines.join("\n")).toMatch(/not signed/);
      const own = () => ({ ...pr([])(), comments: [{ id: 8, user: "a", association: "OWNER", body: comment(receipt()) }] });
      expect(section({ pr: "9", loadPr: own }).status).toBe("ok");
      const byAuthor = () => ({ ...pr([comment(receipt())])(), author: "s-rev" });
      expect(section({ pr: "9", loadPr: byAuthor }).lines.join("\n")).toMatch(/S is the PR's author or wrote or committed a commit in its range/);
      // T6-L2: bound to this PR and this merge base.
      expect(section({ pr: "9", loadPr: pr([comment(receipt({ pr: 8 }))]) }).lines.join("\n")).toMatch(/it is for PR #8, not #9/);
      expect(section({ pr: "9", loadPr: pr([comment(receipt({ base: "c".repeat(40) }))]) }).lines.join("\n")).toMatch(/not this PR's merge base/);
      const byCommitter = signReceipt(unsigned({ reviewer: "T" }), tKey.privatePem);
      const ct = section({ pr: "9", loadPr: pr([comment(byCommitter)]) });
      expect(ct.status).toBe("fail");
      expect(ct.lines.join("\n")).toMatch(/T is the PR's author or wrote or committed a commit in its range/);
      // Offline: a receipt file for this checkout's HEAD, with the PR named (--pr with a stub loader).
      writeFileSync(join(r0.dir, "review.json"), JSON.stringify(receipt()));
      expect(section({ pr: "9", loadPr: pr([]) }, ["--review", "review.json"]).status).toBe("ok");
      // Without --pr the PR it is for can't be checked, so it does not count.
      expect(section({}, ["--review", "review.json"]).lines.join("\n")).toMatch(/can't be checked here \(run with --pr/);
      writeFileSync(join(r0.dir, "review.json"), JSON.stringify(receipt({ files: ["src/other.ts"] })));
      expect(section({ pr: "9", loadPr: pr([]) }, ["--review", "review.json"]).status).toBe("fail");
    } finally {
      r0.done();
    }
  });

  /**
   * T6-H1, the review's end-to-end attack ($S/rev-t6/tests/gateE2E.mjs), kept as a
   * permanent test: a PR adds its own reviewer key to security/reviewers.json, changes a
   * sensitive file and signs its own receipt. On verify/train-6 (f4ed3b4a8f) the gate
   * passed it; the registry now comes from the merge base, so it fails.
   */
  it("T6-H1: a PR that adds its own reviewer key and signs its own receipt is refused", () => {
    const r0 = repo();
    try {
      mkdirSync(join(r0.dir, ".github"));
      writeFileSync(join(r0.dir, ".github/CODEOWNERS"), "/src/sync/e2ee/ @talstilkol\n/security/ @talstilkol\n");
      mkdirSync(join(r0.dir, "security"));
      const honest = keygen();
      writeFileSync(join(r0.dir, "security/reviewers.json"), JSON.stringify({ reviewers: registryEntry("S", honest.privatePem, { login: "s-rev", emails: ["s@example.org"] }) }));
      mkdirSync(join(r0.dir, "src/sync/e2ee"), { recursive: true });
      writeFileSync(join(r0.dir, "src/sync/e2ee/keyring.ts"), "export const k = 1;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: base [skip ci]");
      const base = r0.git("rev-parse", "HEAD").trim();
      // The attack commit, by lane-A: its own key under a fresh name, and a backdoor.
      const bot = keygen();
      const reg = JSON.parse(readFileSync(join(r0.dir, "security/reviewers.json"), "utf8"));
      reg.reviewers["independent-bot"] = registryEntry("independent-bot", bot.privatePem, { login: "independent-bot", emails: ["bot@example.org"] })["independent-bot"];
      writeFileSync(join(r0.dir, "security/reviewers.json"), JSON.stringify(reg, null, 2));
      writeFileSync(join(r0.dir, "src/sync/e2ee/keyring.ts"), "export const k = 1;\n// backdoor\n");
      execFileSync("git", ["-c", "user.name=lane-A", "-c", "user.email=a@x", "commit", "-qam", "feat: x [skip ci]"], { cwd: r0.dir });
      const head = r0.git("rev-parse", "HEAD").trim();
      const self = signReceipt(
        { format: "lumen-review", version: 1, pr: 9, base, head, author: "lane-A", reviewer: "independent-bot", access: "read-only", date: "2026-11-15T04:00:00Z", files: ["/security/", "/src/sync/"], attackTests: [{ path: "x", result: "1/1" }], findings: [], verdict: "approve" },
        bot.privatePem,
      );
      writeFileSync(join(r0.dir, "self.json"), JSON.stringify(self));
      const loadPr = () => ({ number: 9, labels: [], author: "talstilkol", headSha: head, headDate: "2026-11-15T04:00:00Z", reviews: [], events: [], comments: [] });
      const out = runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", base, "--no-size", "--pr", "9", "--review", join(r0.dir, "self.json")]), loadOpenPrs: () => [], loadPr });
      const s = out.sections.find((x: { title: string }) => x.title === "Independent review of sensitive paths");
      expect(s.status).toBe("fail");
      expect(s.lines.join("\n")).toMatch(/reviewer independent-bot is not in security\/reviewers.json/);
      expect(s.lines.join("\n")).toMatch(/This PR changes security\/reviewers.json: receipts are checked against the merge base's registry/);
      // The same receipt signed by a reviewer the base already trusts does count.
      const good = signReceipt({ ...self, reviewer: "S", signature: undefined }, honest.privatePem);
      writeFileSync(join(r0.dir, "good.json"), JSON.stringify(good));
      const ok = runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", base, "--no-size", "--pr", "9", "--review", join(r0.dir, "good.json")]), loadOpenPrs: () => [], loadPr });
      expect(ok.sections.find((x: { title: string }) => x.title === "Independent review of sensitive paths").status).toBe("ok");
      // Nor can the PR make a path non-sensitive by dropping it from CODEOWNERS: the base's entries still apply.
      writeFileSync(join(r0.dir, ".github/CODEOWNERS"), "/docs/ @talstilkol\n");
      execFileSync("git", ["-c", "user.name=lane-A", "-c", "user.email=a@x", "commit", "-qam", "chore: owners [skip ci]"], { cwd: r0.dir });
      const dropped = runChecks({ ...parseArgs(["--cwd", r0.dir, "--base", base, "--no-size", "--pr", "9"]), loadOpenPrs: () => [], loadPr: () => ({ ...loadPr(), headSha: r0.git("rev-parse", "HEAD").trim() }) });
      expect(dropped.sections.find((x: { title: string }) => x.title === "Independent review of sensitive paths").status).toBe("fail");
    } finally {
      r0.done();
    }
  });

  it("fails a budget number written into bundle-budget.mjs itself (W6.26)", () => {
    const r0 = repo();
    try {
      const f = join(r0.dir, "scripts/bundle-budget.mjs");
      writeFileSync(f, readFileSync(f, "utf8").replace("const BUDGETS = compile(SPEC);", 'const BUDGETS = [{ name: "all", re: /x/, budgetKb: 9999 }, ...compile(SPEC)];'));
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: sneak [skip ci]");
      const r = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1", "--no-size"]));
      const gate = r.sections.find((s: { title: string }) => s.title === "Budgets only go down");
      expect(gate.status).toBe("fail");
      expect(gate.lines[0]).toMatch(/^- `scripts\/bundle-budget\.mjs:\d+` sets a budget in code/);
    } finally {
      r0.done();
    }
  });

  it("no stacks (W6.22): a feature-branch base fails with its stack depth, an old merge base and a criss-cross fail", () => {
    const r0 = repo();
    try {
      const env = (date: string) => ({ ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
      const at = (date: string, ...a: string[]) => execFileSync("git", a, { cwd: r0.dir, encoding: "utf8", env: env(date) });
      // A base 30 days old, and a feature branch that stacks on it.
      at("2026-10-01T12:00:00Z", "commit", "-q", "--amend", "--no-edit", "--date", "2026-10-01T12:00:00Z");
      r0.git("switch", "-q", "-c", "feat/base");
      writeFileSync(join(r0.dir, "src/b.ts"), "export const b = 1;\n");
      r0.git("add", "-A");
      at("2026-10-01T12:00:00Z", "commit", "-q", "-m", "feat: b [skip ci]");
      r0.git("switch", "-q", "-c", "feat/top");
      writeFileSync(join(r0.dir, "src/c.ts"), "export const c = 1;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "feat: c [skip ci]");
      const now = ["--now", "2026-11-12T12:00:00Z", "--no-size"];
      const stacked = runChecks(parseArgs(["--cwd", r0.dir, "--base", "feat/base", "--train", "verify/train-2", ...now]));
      const gate = stacked.sections.find((s: { title: string }) => s.title === "Based on the train head");
      expect(gate.status).toBe("fail");
      expect(gate.lines[0]).toContain("- The base `feat/base` is not `verify/train-2` or `main`: a stacked PR.");
      expect(gate.lines[1]).toBe("- The merge base with `feat/base` is 42 days old (limit 7). Merge or restack onto the head of `feat/base`.");
      expect(gate.lines.at(-1)).toBe("- Stack depth at least 2 (limit 1): this PR → `feat/base` → (no open PR has this branch as its head). Restack onto the train head.");
      // A fresh stack (no age failure), with the open PRs given offline: the base rule and the depth fail on their own.
      const prsFile = join(r0.dir, ".git", "prs.json");
      writeFileSync(prsFile, JSON.stringify([{ number: 7, head: "feat/base", base: "main" }]));
      const fresh = runChecks(parseArgs(["--cwd", r0.dir, "--base", "feat/base", "--train", "verify/train-2", "--max-age-days", "60", "--prs", prsFile, ...now]));
      const freshGate = fresh.sections.find((s: { title: string }) => s.title === "Based on the train head");
      expect(freshGate.status).toBe("fail");
      expect(freshGate.lines).toEqual([
        "- The base `feat/base` is not `verify/train-2` or `main`: a stacked PR. Restack it onto the train head: `node scripts/restack.mjs --branch <this branch> --base feat/base` prints the commands.",
        "- Up to date with `feat/base`; the merge base with `feat/base` is 42 days old (limit 60).",
        "- Stack depth 2 (limit 1): this PR → #7 `feat/base` → `main`. Restack onto the train head.",
      ]);
      expect(fresh.failed).toBe(true);
      // The same branch against main, with a 60-day limit: only the base warning is gone… and main has moved on.
      r0.git("switch", "-q", "main");
      writeFileSync(join(r0.dir, "src/m.ts"), "export const m = 1;\n");
      r0.git("add", "-A");
      r0.git("commit", "-q", "-m", "chore: m [skip ci]");
      r0.git("switch", "-q", "feat/top");
      const onMain = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main", "--max-age-days", "60", ...now]));
      expect(onMain.sections.find((s: { title: string }) => s.title === "Based on the train head")).toMatchObject({
        status: "warn",
        lines: ["- The base `main` is the trunk.", "- 1 commit behind `main`. Merge or restack onto its head before the train."],
      });
      // Criss-cross: feat/top merges main's commit while main merges feat/top's earlier one.
      r0.git("merge", "-q", "--no-ff", "-m", "Merge main [skip ci]", "main");
      r0.git("switch", "-q", "main");
      r0.git("merge", "-q", "--no-ff", "-m", "Merge feat/top~1 [skip ci]", "feat/top~1");
      r0.git("switch", "-q", "feat/top");
      expect(r0.git("merge-base", "--all", "main", "HEAD").trim().split("\n")).toHaveLength(2);
      const cc = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main", "--max-age-days", "60", ...now]));
      const ccGate = cc.sections.find((s: { title: string }) => s.title === "Based on the train head");
      expect(ccGate.status).toBe("fail");
      expect(ccGate.lines[1]).toBe("- Criss-cross: 2 merge bases with `main`. Merge `main` into the branch once more, or restack it.");
      expect(cc.failed).toBe(true);
    } finally {
      r0.done();
    }
  });

  it("no dist/: the size check is skipped with what to do", () => {
    const r0 = repo();
    try {
      r0.git("commit", "-q", "--allow-empty", "-m", "chore: x [skip ci]");
      const r = runChecks(parseArgs(["--cwd", r0.dir, "--base", "main~1"]));
      const size = r.sections.find((s: { title: string }) => s.title === "Bundle size");
      expect(size.status).toBe("skipped");
      expect(size.lines[0]).toMatch(/npm run build/);
    } finally {
      r0.done();
    }
  });
});
