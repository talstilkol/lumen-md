/**
 * Plan W6.11: a sensitive change (.github/CODEOWNERS) needs an independent
 * review receipt for its head commit (scripts/lib/independentReview.mjs).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractReceipts,
  independentReviewVerdict,
  receiptComment,
  receiptFor,
  receiptProblems,
  uncovered,
  parseReviewers,
  commentReceipts,
  excludedIdentities,
  isCatchAll,
  reviewerExcluded,
  // @ts-expect-error -- plain .mjs script, no types
} from "../../scripts/lib/independentReview.mjs";
// @ts-expect-error -- plain .mjs script, no types
import { keygen, registryEntry, signReceipt } from "../../scripts/review-sign.mjs";
// @ts-expect-error -- plain .mjs script, no types
import { parseCodeowners, sensitiveChanges } from "../../scripts/lib/humanReview.mjs";

const HEAD = "3f80047a28d66e086ff2b50459353fc66e82b31d";
const BASE = "1d2c3b4a5f60718293a4b5c6d7e8f90a1b2c3d4e";
const entries = parseCodeowners(readFileSync(join(__dirname, "../../.github/CODEOWNERS"), "utf8"));
const sensitive = sensitiveChanges(["src/sync/e2ee/lan/rpc.ts", "src/__tests__/lanPreAuthAttack.test.ts", "src/storage/vault/atomic.ts"], entries);

const receipt = (o: Record<string, unknown> = {}) => ({
  format: "lumen-review",
  version: 1,
  pr: 495,
  base: BASE,
  head: HEAD,
  author: "train-2",
  reviewer: "S",
  access: "read-only",
  date: "2026-11-12T18:00:00Z",
  files: ["/src/sync/e2ee/", "src/storage/vault/atomic.ts"],
  attackTests: [{ path: "src/__tests__/lanPreAuthAttack.test.ts", result: "6/6 pass", failsWithoutFix: 3 }],
  findings: [{ id: "E56-1", severity: "medium", status: "fixed", summary: "device map before the proof", fix: "rev12/fixes/train2-lansync.patch" }],
  verdict: "approve",
  ...o,
});

// W10.D3: only a signed receipt counts, so the receipts here are signed with
// S's key and checked against a registry that lists it.
const sKey = keygen();
const S_ID = { login: "s-reviewer", emails: ["s@example.org"] };
const registry = parseReviewers(JSON.stringify({ reviewers: registryEntry("S", sKey.privatePem, S_ID) }));
/** T6-L2: what pr:check binds a receipt to — the PR being checked and its merge base. */
const BIND = { pr: 495, base: BASE };
const signed = (o: Record<string, unknown> = {}) => signReceipt(receipt(o), sKey.privatePem);

describe("review receipts", () => {
  it("only CODEOWNERS paths are sensitive here", () => {
    expect(sensitive.map((s: { file: string }) => s.file)).toEqual(["src/sync/e2ee/lan/rpc.ts", "src/storage/vault/atomic.ts"]);
  });

  it("a well-formed receipt for the head counts", () => {
    expect(receiptProblems(receipt())).toEqual([]);
    expect(receiptFor(signed(), HEAD, sensitive, registry, null, BIND)).toEqual([]);
    const v = independentReviewVerdict(sensitive, [{ source: "file", receipt: signed() }], { head: HEAD, strict: true, reviewers: registry, ...BIND });
    expect(v.status).toBe("ok");
    expect(v.lines[0]).toMatch(/by S \(author train-2, read-only\).*1 attack test, findings 1 medium/);
  });

  it("each rule that makes a review independent and complete", () => {
    const why = (o: Record<string, unknown>) => receiptFor(signed(o), HEAD, sensitive, registry, null, BIND).join(" | ");
    expect(why({ reviewer: "Train-2" })).toMatch(/reviewer is the author/);
    expect(why({ access: "write" })).toMatch(/read-only/);
    expect(why({ head: HEAD.slice(0, 9) })).toMatch(/40-character/);
    expect(why({ head: "f".repeat(40) })).toMatch(/not the head/);
    expect(why({ attackTests: [] })).toMatch(/attack test/);
    expect(why({ files: ["/src/sync/e2ee/"] })).toMatch(/does not cover 1 sensitive file: `src\/storage\/vault\/atomic.ts`/);
    expect(why({ findings: [{ id: "X", severity: "critical", status: "open" }] })).toMatch(/1 critical or high finding is open: X/);
    expect(why({ findings: [{ id: "X", severity: "high", status: "accepted" }] })).toBe("");
    expect(why({ findings: [{ id: "X", severity: "severe", status: "open" }] })).toMatch(/severity must be one of/);
    expect(why({ verdict: "changes-requested" })).toMatch(/verdict is "changes-requested"/);
    expect(why({ format: "other" })).toMatch(/format must be/);
  });

  it("files may be paths or CODEOWNERS patterns", () => {
    expect(uncovered(sensitive, ["src/sync/e2ee/lan/rpc.ts", "/src/storage/vault/"])).toEqual([]);
    expect(uncovered(sensitive, ["src/sync/"])).toEqual(["src/storage/vault/atomic.ts"]);
  });

  it("the comment form round-trips, and a broken block is reported, not skipped", () => {
    const text = `${receiptComment(receipt())}\n\nand\n\n\`\`\`lumen-review\n{ nope\n\`\`\``;
    const got = extractReceipts(text);
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual(receipt());
    expect(receiptProblems(got[1])[0]).toMatch(/not JSON/);
    expect(extractReceipts("```json\n{}\n```")).toEqual([]);
  });

  it("no receipt: a warning offline, a failure with --pr; a stale one next to a good one is listed", () => {
    expect(independentReviewVerdict(sensitive, [], { head: HEAD, strict: false }).status).toBe("warn");
    expect(independentReviewVerdict(sensitive, [], { head: HEAD, strict: true }).status).toBe("fail");
    expect(independentReviewVerdict([], [], { head: HEAD, strict: true }).status).toBe("ok");
    const v = independentReviewVerdict(
      sensitive,
      [
        { source: "comment 1", receipt: signed({ head: "a".repeat(40) }) },
        { source: "comment 2", receipt: signed() },
      ],
      { head: HEAD, strict: true, reviewers: registry, ...BIND },
    );
    expect(v.status).toBe("ok");
    expect(v.lines.join("\n")).toMatch(/comment 1: not counted — it is for `aaaaaaaaa`/);
    const stale = independentReviewVerdict(sensitive, [{ source: "comment 1", receipt: signed({ head: "a".repeat(40) }) }], { head: HEAD, strict: true, reviewers: registry, ...BIND });
    expect(stale.status).toBe("fail");
  });
});

/**
 * W10.D3 (research R3.3): the 8-case matrix. Only a receipt from an account
 * with write access, signed with the registered key of its reviewer, for the
 * head, by someone who neither opened the PR nor wrote or committed any of
 * its commits, counts.
 */
describe("W10.D3: who may approve", () => {
  const regWithIds = registry;
  const ctx = (o: Record<string, unknown> = {}) => ({ head: HEAD, strict: true, reviewers: regWithIds, ...BIND, ...o });
  const comment = (user: string, association: string, r: object) => ({ id: 1, user, association, body: receiptComment(r) });
  const verdict = (receipts: unknown[], o: Record<string, unknown> = {}) => independentReviewVerdict(sensitive, receipts, ctx(o));

  it("1. a valid signed receipt from a collaborator counts", () => {
    const v = verdict(commentReceipts([comment("s-reviewer", "COLLABORATOR", signed())]));
    expect(v.status).toBe("ok");
    expect(v.lines[0]).toMatch(/signature verified/);
  });

  it("2. a stranger's receipt (author_association NONE or CONTRIBUTOR) is refused, even when validly signed", () => {
    for (const assoc of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", undefined]) {
      const v = verdict(commentReceipts([comment("stranger", assoc as string, signed())]));
      expect(v.status, String(assoc)).toBe("fail");
      expect(v.lines.join("\n")).toMatch(/has no write access/);
    }
  });

  it("3. the PR author's own receipt is refused by identity (the registry's login), whoever posted it", () => {
    const ex = excludedIdentities({ prAuthor: "s-reviewer" });
    expect(verdict(commentReceipts([comment("talstilkol", "OWNER", signed())]), { excluded: ex }).lines.join("\n")).toMatch(/S is the PR's author or wrote or committed a commit in its range/);
    expect(verdict([{ source: "file", receipt: signed() }], { excluded: ex }).lines.join("\n")).toMatch(/S is the PR's author or wrote or committed a commit in its range/);
  });

  it("4. a receipt by an author or committer of a commit in the range is refused (by name or email)", () => {
    const byEmail = excludedIdentities({ commits: [{ authorName: "Someone", authorEmail: "x@example.org", committerName: "Other", committerEmail: "S@example.org" }] });
    expect(verdict([{ source: "file", receipt: signed() }], { excluded: byEmail }).status).toBe("fail");
    const byName = excludedIdentities({ commits: [{ authorName: "S", authorEmail: "y@example.org" }] });
    expect(verdict([{ source: "file", receipt: signed() }], { excluded: byName }).status).toBe("fail");
    const clean = excludedIdentities({ prAuthor: "talstilkol", commits: [{ authorName: "Claude", authorEmail: "noreply@anthropic.com" }] });
    expect(verdict([{ source: "file", receipt: signed() }], { excluded: clean }).status).toBe("ok");
  });

  it("5. a receipt for an older head is refused", () => {
    expect(verdict([{ source: "file", receipt: signed({ head: "b".repeat(40) }) }]).lines.join("\n")).toMatch(/not the head/);
  });

  it("6. an unsigned receipt is refused, and with no registry nothing counts", () => {
    expect(verdict([{ source: "file", receipt: receipt() }]).lines.join("\n")).toMatch(/not signed/);
    const none = independentReviewVerdict(sensitive, [{ source: "file", receipt: signed() }], { head: HEAD, strict: true, reviewers: null });
    expect(none.status).toBe("fail");
    expect(none.lines.join("\n")).toMatch(/security\/reviewers.json is missing, and an unsigned receipt does not count/);
  });

  it("7-9. tampering: a field changed after signing, a signature by another key, a reviewer swapped", () => {
    const t1 = { ...signed(), verdict: "approve", files: ["/src/"] };
    expect(verdict([{ source: "file", receipt: t1 }]).lines.join("\n")).toMatch(/does not verify/);
    const mallory = keygen();
    const t2 = signReceipt(receipt(), mallory.privatePem);
    expect(verdict([{ source: "file", receipt: t2 }]).lines.join("\n")).toMatch(/does not verify with S's key/);
    const t3 = { ...signed(), reviewer: "T" };
    expect(verdict([{ source: "file", receipt: t3 }]).lines.join("\n")).toMatch(/reviewer T is not in security\/reviewers.json/);
  });

  it("a catch-all file list never counts", () => {
    expect(verdict([{ source: "file", receipt: signed({ files: ["*"] }) }]).status).toBe("fail");
  });
});

/**
 * The T6 review's attacks on the gate ($S/rev-t6/tests/gateUnit.mjs), kept as
 * permanent tests. Each failed on verify/train-6 (f4ed3b4a8f) before this fix.
 */
describe("T6 review: attacks on the review gate", () => {
  const ctx = (o: Record<string, unknown> = {}) => ({ head: HEAD, strict: true, reviewers: registry, ...BIND, ...o });
  const sens = [{ file: "src/sync/e2ee/keyring.ts" }, { file: "security/reviewers.json" }, { file: "src-tauri/src/updates.rs" }];
  const broad = ["/src/", "/security/", "/src-tauri/"];

  it("T6-L1: every spelling of a catch-all is refused by what it matches", () => {
    for (const pat of ["**/**", "/**/", "**/", "*/", "/*/", "**/*.*", "?*/", "/**/**", "*", "**", "/", "/**", "**/*"]) {
      expect(isCatchAll(pat), pat).toBe(true);
      expect(receiptFor(signed({ files: [pat] }), HEAD, sens, registry, null, BIND).join(), pat).toMatch(/covers the whole repository/);
    }
    for (const pat of ["/src/sync/e2ee/", "src/sync/e2ee/keyring.ts", "/security/", "/src-tauri/", "**/keyring.ts", "/src/**"]) expect(isCatchAll(pat), pat).toBe(false);
    expect(receiptFor(signed({ files: broad }), HEAD, sens, registry, null, BIND)).toEqual([]);
  });

  it("T6-M1: a receipt posted from the shared owner account counts when its signature and identity hold", () => {
    const body = "```lumen-review\n" + JSON.stringify(signed({ files: broad })) + "\n```";
    const got = commentReceipts([{ id: 1, user: "talstilkol", association: "OWNER", body }]);
    expect(got[0].rejected).toBeUndefined();
    const v = independentReviewVerdict(sens, got, ctx({ excluded: excludedIdentities({ prAuthor: "talstilkol", commits: [{ authorName: "lane-A", authorEmail: "a@x" }] }) }));
    expect(v.status).toBe("ok");
    // …and still not from an account without write access.
    expect(commentReceipts([{ id: 2, user: "x", association: "NONE", body }])[0].rejected).toMatch(/no write access/);
  });

  it("T6-L2: a receipt replayed on another PR, or against another base with the same head, does not count", () => {
    const r = signed({ files: broad });
    expect(receiptFor(r, HEAD, sens, registry, null, { pr: 2, base: BASE }).join()).toMatch(/it is for PR #495, not #2/);
    expect(receiptFor(r, HEAD, sens, registry, null, { pr: 495, base: "e".repeat(40) }).join()).toMatch(/reviewed against the base `1d2c3b4a5`, not this PR's merge base `eeeeeeeee`/);
    expect(receiptFor(r, HEAD, sens, registry, null, {}).join()).toMatch(/can't be checked here \(run with --pr/);
    // Both are signed: changing them after signing breaks the signature.
    expect(receiptFor({ ...r, pr: 2 }, HEAD, sens, registry, null, { pr: 2, base: BASE }).join()).toMatch(/does not verify/);
    // And a receipt must name them.
    const { pr: _p, base: _b, ...bare } = receipt({ files: broad });
    void _p;
    void _b;
    expect(receiptProblems(bare).join()).toMatch(/pr must be.*base must be/);
  });

  it("T6-H1: a registry entry must name the reviewer's login and emails, so the exclusion always matches", () => {
    const k = keygen();
    const bare = parseReviewers(JSON.stringify({ reviewers: { "independent-bot": { publicKey: registryEntry("x", k.privatePem, S_ID).x.publicKey } } }));
    expect(bare.keys.size).toBe(0);
    expect(bare.problems.join()).toMatch(/independent-bot: unusable entry \("login"/);
    const noMail = parseReviewers(JSON.stringify({ reviewers: { b: { publicKey: registryEntry("x", k.privatePem, S_ID).x.publicKey, login: "b" } } }));
    expect(noMail.problems.join()).toMatch(/"emails"/);
    expect(() => registryEntry("b", k.privatePem)).toThrow(/login/);
    // With login and emails, a committer in the range is matched by email even under another name.
    const rp = signed({ files: broad });
    expect(reviewerExcluded(rp, registry, excludedIdentities({ commits: [{ authorName: "Tal", authorEmail: "S@example.org" }] }))).toBe(true);
    expect(reviewerExcluded(rp, registry, excludedIdentities({ prAuthor: "S-Reviewer" }))).toBe(true);
    expect(reviewerExcluded(rp, registry, excludedIdentities({ prAuthor: "talstilkol", commits: [{ authorName: "lane-A", authorEmail: "a@x" }] }))).toBe(false);
  });

  it("tamper: a finding changed after signing does not verify", () => {
    const t = { ...signed({ files: broad }), findings: [{ id: "x", severity: "high", status: "fixed" }] };
    expect(receiptFor(t, HEAD, sens, registry, null, BIND).join()).toMatch(/does not verify/);
  });
});
