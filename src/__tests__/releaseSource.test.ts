/**
 * W13.T3 + W13.T4: release:verify asks for the source side of a release —
 * a SLSA 1.2 source VSA for the release commit (level 2) and an SSH-signed
 * tag by an allowed signer — and fails without either.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAllowedSigners, signSshSig, verifySshSig, verifyTag } from "../../scripts/supply-chain/sshsig.mjs";
import { attest, checkVsa, evaluate, protections, refMatches } from "../../scripts/supply-chain/source-vsa-lib.mjs";
import { factsFor } from "../../scripts/supply-chain/source-vsa.mjs";
import { releaseIdentity, sourceProblems } from "../../scripts/supply-chain/verify-release.mjs";
import { generateKeys, signData } from "../../scripts/supply-chain/minisign.mjs";

const ROOT = process.cwd();
const ed = () => {
  const k = generateKeyPairSync("ed25519");
  return { pem: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), pub: k.publicKey.export({ type: "spki", format: "pem" }).toString() };
};
const RULESETS = JSON.parse(readFileSync(join(ROOT, "security/github-ruleset.json"), "utf8")).rulesets;
const SHA = "a".repeat(40);
const facts = (over: Record<string, unknown> = {}) => ({ ref: "refs/heads/verify/train-7", commit: SHA, previous: null, isAncestor: null, committed: RULESETS, live: RULESETS, receipts: null, ...over });

describe("SSH signatures (SSHSIG) as git makes them", () => {
  it("verifies a real OpenSSH signature from this repository's history", (ctx) => {
    // A commit signed with ssh-keygen (gpg.format=ssh): proof the format is OpenSSH's, not only our own.
    const raw = spawnSync("git", ["cat-file", "commit", "2592f84994176ddee1a265619a842d26fc882187"], { cwd: ROOT, encoding: "utf8" });
    if (raw.status !== 0) return ctx.skip("skip-reason: a shallow clone without that commit");
    const kept: string[] = [];
    const sig: string[] = [];
    let inSig = false;
    for (const l of raw.stdout.split("\n")) {
      if (l.startsWith("gpgsig ")) {
        inSig = true;
        sig.push(l.slice(7));
      } else if (inSig && l.startsWith(" ")) sig.push(l.slice(1));
      else {
        inSig = false;
        kept.push(l);
      }
    }
    expect(verifySshSig(Buffer.from(kept.join("\n")), sig.join("\n"), "git").ok).toBe(true);
    expect(verifySshSig(Buffer.from(kept.join("\n") + " "), sig.join("\n"), "git").ok).toBe(false);
    expect(verifySshSig(Buffer.from(kept.join("\n")), sig.join("\n"), "file").ok).toBe(false);
  });

  it("round-trips, and parses allowed_signers with options and comments", () => {
    const k = ed();
    const s = signSshSig(Buffer.from("hello"), k.pem);
    expect(verifySshSig(Buffer.from("hello"), s.armored).ok).toBe(true);
    const list = parseAllowedSigners(`# comment\n\ntal namespaces="git" ${s.publicLine} release tags\nother ssh-rsa AAAAB3Nza\nx@y,z valid-after="20260101" ${s.publicLine}\n`);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ principals: ["tal"], namespaces: ["git"] });
    expect(list[1]).toMatchObject({ principals: ["x@y", "z"], validAfter: "20260101" });
  });

  it("the committed allowed_signers has no key yet: no tag verifies until the owner adds one", () => {
    expect(parseAllowedSigners(readFileSync(join(ROOT, "security/allowed_signers"), "utf8"))).toEqual([]);
  });
});

describe("SLSA source track: evaluation and VSA", () => {
  it("ref patterns and the rules that protect a train", () => {
    expect(refMatches("refs/heads/verify/*", "refs/heads/verify/train-7")).toBe(true);
    expect(refMatches("refs/heads/verify/*", "refs/heads/verify/a/b")).toBe(false);
    expect(refMatches("~DEFAULT_BRANCH", "refs/heads/main")).toBe(true);
    const p = protections(RULESETS, "refs/heads/verify/train-7");
    expect(p.has("non_fast_forward") && p.has("deletion")).toBe(true);
    expect(protections(RULESETS, "refs/heads/feature/x").size).toBe(0);
  });

  it("level 2 needs the server's rulesets and an unbroken history", () => {
    expect(evaluate(facts()).level).toBe(2);
    expect(evaluate(facts({ live: null })).level).toBe(1);
    expect(evaluate(facts({ live: [] })).level).toBe(1);
    expect(evaluate(facts({ previous: "b".repeat(40), isAncestor: false })).level).toBe(1);
    expect(evaluate(facts({ previous: "b".repeat(40), isAncestor: true })).level).toBe(2);
    expect(evaluate(facts({ ref: "refs/heads/feature/x" })).level).toBe(0);
  });

  it("a signed VSA passes the consumer's check only for its commit and a trusted key", () => {
    const k = ed();
    const { vsa } = attest(facts(), k.pem);
    expect(checkVsa(vsa, { commit: SHA, trustedPems: [k.pub] })).toMatchObject({ ok: true, ref: "refs/heads/verify/train-7", levels: ["SLSA_SOURCE_LEVEL_1", "SLSA_SOURCE_LEVEL_2"] });
    expect(checkVsa(vsa, { commit: "c".repeat(40), trustedPems: [k.pub] }).problems.join()).toMatch(/not the release commit/);
    expect(checkVsa(vsa, { commit: SHA, trustedPems: [ed().pub] }).problems.join()).toMatch(/no signature by a trusted key/);
    expect(checkVsa(vsa, { commit: SHA, trustedPems: [] }).ok).toBe(false);
    const weak = attest(facts({ live: null }), k.pem).vsa;
    expect(checkVsa(weak, { commit: SHA, trustedPems: [k.pub] }).problems.join()).toMatch(/FAILED|SLSA_SOURCE_LEVEL_2/);
    const tampered = { ...vsa, payload: Buffer.from(Buffer.from(vsa.payload, "base64").toString().replace("PASSED", "PASSED ")).toString("base64") };
    expect(checkVsa(tampered, { commit: SHA, trustedPems: [k.pub] }).ok).toBe(false);
  });

  it("facts from this repository: the committed ruleset protects the trains", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const f = factsFor(ROOT, { ref: "refs/heads/verify/train-7", commit: head, previous: null, live: null });
    expect(evaluate(f).checks.find((c) => c.id === "declared-continuity")?.ok).toBe(true);
  });
});

describe("npm run release:verify, end to end", () => {
  let dir = "";
  let repo = "";
  let rel = "";
  let commit = "";
  const run = (args: string[] = []) => spawnSync(process.execPath, [join(ROOT, "scripts/supply-chain/verify-release.mjs"), rel, "--pub", join(rel, "release-key.pub"), "--root", repo, ...args], { encoding: "utf8" });
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], { cwd: repo, encoding: "utf8" }).trim();
  const tagger = "tagger t <t@example.com> 1763337600 +0000";
  let tagKey: ReturnType<typeof signSshSig> & { pem: string };
  let vsaKey: ReturnType<typeof ed>;

  const makeTag = (name: string, body: string) => {
    const sha = execFileSync("git", ["mktag"], { cwd: repo, input: body, encoding: "utf8" }).trim();
    g("update-ref", `refs/tags/${name}`, sha);
  };
  const signedTag = (version: string, pem: string, target = commit) => {
    const payload = `object ${target}\ntype commit\ntag v${version}\n${tagger}\n\nLumen ${version}\n`;
    makeTag(`v${version}`, payload + signSshSig(Buffer.from(payload), pem).armored);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lumen-release-source-"));
    repo = join(dir, "repo");
    rel = join(dir, "release");
    mkdirSync(join(repo, "security"), { recursive: true });
    mkdirSync(rel);
    g("init", "-q");
    writeFileSync(join(repo, "README.md"), "x\n");
    g("add", "-A");
    g("commit", "-qm", "base");
    commit = g("rev-parse", "HEAD");
    // The release: one file, SHA256SUMS and the SBOM, signed with a minisign key whose trusted comment names the commit.
    const mk = generateKeys();
    writeFileSync(join(rel, "release-key.pub"), mk.publicKey);
    writeFileSync(join(rel, "app.txt"), "app\n");
    writeFileSync(join(rel, "sbom.cdx.json"), JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "x" }] }));
    writeFileSync(join(rel, "SHA256SUMS"), `${createHash("sha256").update("app\n").digest("hex")}  app.txt\n`);
    for (const n of ["SHA256SUMS", "sbom.cdx.json"]) writeFileSync(join(rel, `${n}.minisig`), signData(readFileSync(join(rel, n)), mk.pem, { trusted: `lumen-md 1.2.3 commit:${commit} file:${n} timestamp:0` }));
    // Trust: the source key and the tag signer.
    vsaKey = ed();
    const tk = ed();
    tagKey = { ...signSshSig(Buffer.from(""), tk.pem), pem: tk.pem };
    writeFileSync(join(repo, "security/source-vsa.json"), JSON.stringify({ keys: [vsaKey.pub] }));
    writeFileSync(join(repo, "security/allowed_signers"), `tal namespaces="git" ${tagKey.publicLine} release\n`);
    writeFileSync(join(rel, "source-vsa.json"), JSON.stringify(attest(facts({ commit, ref: "refs/heads/main" }), vsaKey.pem).vsa));
    signedTag("1.2.3", tagKey.pem);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a release with its source VSA and a signed tag verifies (exit 0)", () => {
    const r = run();
    expect(`${r.stdout}${r.stderr}`).toMatch(/^OK: 1 files match SHA256SUMS.*source VSA \(SLSA_SOURCE_LEVEL_2\) and tag v1\.2\.3 is signed by an allowed signer/);
    expect(r.status).toBe(0);
  });

  it("fails without the VSA", () => {
    const keep = readFileSync(join(rel, "source-vsa.json"));
    rmSync(join(rel, "source-vsa.json"));
    try {
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/source-vsa\.json is missing/);
    } finally {
      writeFileSync(join(rel, "source-vsa.json"), keep);
    }
  });

  it("fails with a VSA for another commit, or from an untrusted key", () => {
    const keep = readFileSync(join(rel, "source-vsa.json"));
    try {
      writeFileSync(join(rel, "source-vsa.json"), JSON.stringify(attest(facts({ commit: "d".repeat(40), ref: "refs/heads/main" }), vsaKey.pem).vsa));
      expect(run().stdout).toMatch(/not the release commit/);
      writeFileSync(join(rel, "source-vsa.json"), JSON.stringify(attest(facts({ commit, ref: "refs/heads/main" }), ed().pem).vsa));
      expect(run().stdout).toMatch(/no signature by a trusted key/);
    } finally {
      writeFileSync(join(rel, "source-vsa.json"), keep);
    }
  });

  it("an unsigned tag fails", () => {
    makeTag("v1.2.3", `object ${commit}\ntype commit\ntag v1.2.3\n${tagger}\n\nLumen 1.2.3\n`);
    try {
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/tag v1\.2\.3: the tag is not signed/);
    } finally {
      signedTag("1.2.3", tagKey.pem);
    }
  });

  it("a tag signed by a key not in allowed_signers fails, and so does one on another commit", () => {
    signedTag("1.2.3", ed().pem);
    expect(run().stdout).toMatch(/does not allow for git/);
    g("commit", "-q", "--allow-empty", "-m", "other");
    signedTag("1.2.3", tagKey.pem, g("rev-parse", "HEAD"));
    expect(run().stdout).toMatch(/points at [0-9a-f]{40}, not the release commit/);
    signedTag("1.2.3", tagKey.pem);
    expect(run().status).toBe(0);
  });

  it("no tag at all fails", () => {
    expect(sourceProblems({ identity: { version: "9.9.9", commit }, vsa: null, trustedPems: [], tagRaw: null, allowedSigners: "" }).join()).toMatch(/not in this repository/);
    expect(releaseIdentity("lumen-md 1.2.3 commit:" + commit + " file:SHA256SUMS timestamp:0")).toEqual({ version: "1.2.3", commit });
    expect(releaseIdentity("something else")).toBeNull();
  });

  it("verifyTag directly: namespace, expiry", () => {
    const payload = `object ${commit}\ntype commit\ntag v1\n${tagger}\n\nm\n`;
    const k = ed();
    const s = signSshSig(Buffer.from(payload), k.pem, "file");
    expect(verifyTag(payload + s.armored, `a ${s.publicLine}`).problems.join()).toMatch(/namespace "file"/);
    const s2 = signSshSig(Buffer.from(payload), k.pem);
    expect(verifyTag(payload + s2.armored, `a valid-before="20200101" ${s2.publicLine}`).ok).toBe(false);
    expect(verifyTag(payload + s2.armored, `a ${s2.publicLine}`).ok).toBe(true);
  });
});
