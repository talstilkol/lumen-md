/**
 * W13.L5 — author signatures: a plugin version is signed keyless with
 * Sigstore (cosign sign-blob after a GitHub login), and the registry shows
 * "verified author" only when the signature verifies and its identity is
 * the GitHub account the manifest names. Verification here is the real
 * sigstore-js (npm's own) against the offline Sigstore stand-in's trust
 * root (scripts/supply-chain/sigstore-local.mjs): only the roots are local.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs modules of the build scripts
import { authorStatement, certificateIdentity, identityMatches, signAuthor, sigstoreJs, verifyAuthor, versionFiles, GITHUB_ACTIONS, GITHUB_OAUTH } from "../../scripts/lib/plugin-author.mjs";
// @ts-expect-error — as above
import { localSigstore } from "../../scripts/supply-chain/sigstore-local.mjs";
// @ts-expect-error — as above
import { SITE_SCHEMA, verifySite } from "../../scripts/lib/registrySite.mjs";
// @ts-expect-error — as above
import { generateSigningKey, signRegistryBytes, verifyRegistryBytes } from "../../scripts/lib/plugin-registry-sign.mjs";
import { parseManifest } from "../plugins/runtime/manifest";

const sjs = sigstoreJs();
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

function versionDir(github = "alice", code = 'lumen.commands.register({ id: "hi", label: "Hi" }, () => undefined);\n') {
  const dir = mkdtempSync(join(tmpdir(), "author-"));
  const manifest = JSON.stringify({ schema: 1, id: "org.alice.hello", name: "Hello", version: "1.2.0", description: "d", author: "Alice", license: "MIT", main: "main.js", publisher: { github }, capabilities: [{ id: "commands", reason: "r" }] }, null, 2);
  writeFileSync(join(dir, "lumen-plugin.json"), manifest);
  writeFileSync(join(dir, "main.js"), code);
  return dir;
}

describe("identity: the certificate must be the manifest's GitHub account", () => {
  it("a GitHub login matches only that account's no-reply address; a workflow only a repository of that account", () => {
    expect(identityMatches({ san: "123456+alice@users.noreply.github.com", issuer: GITHUB_OAUTH }, "alice")).toEqual({ ok: true });
    expect(identityMatches({ san: "Alice@users.noreply.github.com", issuer: GITHUB_OAUTH }, "alice")).toEqual({ ok: true });
    expect(identityMatches({ san: "alice@gmail.com", issuer: GITHUB_OAUTH }, "alice").ok).toBe(false);
    expect(identityMatches({ san: "99+mallory@users.noreply.github.com", issuer: GITHUB_OAUTH }, "alice").ok).toBe(false);
    expect(identityMatches({ san: "99+alice@users.noreply.github.com.evil.example", issuer: GITHUB_OAUTH }, "alice").ok).toBe(false);
    expect(identityMatches({ san: "https://github.com/alice/hello/.github/workflows/release.yml@refs/tags/v1.2.0", issuer: GITHUB_ACTIONS }, "alice")).toEqual({ ok: true });
    expect(identityMatches({ san: "https://github.com/mallory/alice/.github/workflows/release.yml@refs/tags/v1", issuer: GITHUB_ACTIONS }, "alice").ok).toBe(false);
    expect(identityMatches({ san: "123+alice@users.noreply.github.com", issuer: "https://accounts.google.com" }, "alice").ok).toBe(false);
    expect(identityMatches({ san: "x", issuer: GITHUB_OAUTH }, "-bad-").ok).toBe(false);
  });

  it("the manifest's publisher is validated", () => {
    expect(parseManifest({ schema: 1, id: "org.a.b", name: "n", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "main.js", capabilities: [], publisher: { github: "alice" } }).publisher).toEqual({ github: "alice" });
    expect(() => parseManifest({ schema: 1, id: "org.a.b", name: "n", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "main.js", capabilities: [], publisher: { github: "a b" } })).toThrow(/publisher/);
  });
});

describe.skipIf(!sjs)("keyless signing and verification (sigstore-js; skipped only where npm's verifier is absent)", () => {
  const fake = localSigstore();
  const sign = async (dir: string, email: string) => signAuthor({ dir, local: { sigstore: fake, email } });

  it("the author's own signature verifies, and the certificate names who signed", async () => {
    const dir = versionDir();
    await sign(dir, "123456+alice@users.noreply.github.com");
    const f = versionFiles(dir);
    expect(certificateIdentity(f.bundle)).toEqual({ san: "123456+alice@users.noreply.github.com", issuer: GITHUB_OAUTH });
    const r = await verifyAuthor({ bundle: f.bundle, statement: f.statement, github: "alice", trustedRoot: fake.trustedRoot });
    expect(r).toMatchObject({ ok: true, github: "alice" });
    expect(f.statement.toString()).toBe(`lumen-plugin-author-v1\norg.alice.hello@1.2.0\nmanifest sha256:${sha(readFileSync(join(dir, "lumen-plugin.json")))}\nmain sha256:${sha(readFileSync(join(dir, "main.js")))}\n`);
  });

  it("a signature from another identity is refused", async () => {
    const dir = versionDir("alice");
    await sign(dir, "666+mallory@users.noreply.github.com");
    const f = versionFiles(dir);
    const r = await verifyAuthor({ bundle: f.bundle, statement: f.statement, github: "alice", trustedRoot: fake.trustedRoot });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/mallory.*not alice's no-reply address/);
  });

  it("changed code after signing, another Sigstore's root, or no signature: refused", async () => {
    const dir = versionDir();
    await sign(dir, "123456+alice@users.noreply.github.com");
    writeFileSync(join(dir, "main.js"), "lumen.vault.read('secrets.md');\n");
    const f = versionFiles(dir);
    expect((await verifyAuthor({ bundle: f.bundle, statement: f.statement, github: "alice", trustedRoot: fake.trustedRoot })).reason).toMatch(/^Sigstore: /);
    const dir2 = versionDir();
    await sign(dir2, "123456+alice@users.noreply.github.com");
    const g = versionFiles(dir2);
    expect((await verifyAuthor({ bundle: g.bundle, statement: g.statement, github: "alice", trustedRoot: localSigstore().trustedRoot })).ok).toBe(false);
    expect((await verifyAuthor({ bundle: null, statement: g.statement, github: "alice", trustedRoot: fake.trustedRoot })).reason).toMatch(/no author signature/);
  });

  it("registry:verify's check: every version needs a valid author signature", async () => {
    const dir = versionDir();
    await sign(dir, "123456+alice@users.noreply.github.com");
    const manifest = readFileSync(join(dir, "lumen-plugin.json"));
    const main = readFileSync(join(dir, "main.js"));
    const bundle = readFileSync(join(dir, "author.sigstore.json"));
    const site = (withBundle: boolean) => {
      const files: Record<string, Buffer> = { "lumen-plugin.json": manifest, "main.js": main, ...(withBundle ? { "author.sigstore.json": bundle } : {}) };
      const at = "v1/plugins/org.alice.hello/1.2.0/";
      const map = new Map<string, Buffer>(Object.entries(files).map(([k, v]) => [at + k, v]));
      map.set("v1/index.json", Buffer.from(JSON.stringify({ schema: SITE_SCHEMA, plugins: [{ id: "org.alice.hello", versions: [{ version: "1.2.0", main: "main.js", sha256: sha(main), files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { sha256: sha(v), bytes: v.length }])) }] }] })));
      map.set("SHA256SUMS", Buffer.from(""));
      return (p: string) => Promise.resolve(map.get(p) ?? (p === "SHA256SUMS" ? Buffer.from("") : null));
    };
    const scanVersion = async () => ({ passed: true, findings: [], id: "org.alice.hello", version: "1.2.0" });
    const author = (o: object) => verifyAuthor({ ...o, trustedRoot: fake.trustedRoot });
    expect(await verifySite({ get: site(true), scanVersion, verifyAuthor: author, authorStatement })).toMatchObject({ ok: true, versions: 1 });
    const unsigned = await verifySite({ get: site(false), scanVersion, verifyAuthor: author, authorStatement });
    expect(unsigned.ok).toBe(false);
    expect(unsigned.problems).toEqual(["org.alice.hello@1.2.0: author: no author signature (author.sigstore.json)"]);
  });
});

describe("the Ed25519-signed index stays the second layer", () => {
  it("the 'verified author' mark lives inside index.json, so changing it breaks the registry signature", () => {
    const key = generateSigningKey();
    const index = Buffer.from(JSON.stringify({ plugins: [{ id: "org.alice.hello", versions: [{ version: "1.2.0", author: { github: "alice", issuer: GITHUB_OAUTH } }] }] }));
    const sig = signRegistryBytes(index, key.privateKeyPem);
    expect(verifyRegistryBytes(index, sig, key.spkiBase64)).toBe("ok");
    const forged = Buffer.from(index.toString().replace('"alice"', '"mallory"'));
    expect(verifyRegistryBytes(forged, sig, key.spkiBase64)).toBe("bad-signature");
    expect(authorStatement({ id: "a", version: "1.0.0", manifestBytes: "m", codeBytes: "c" }).toString()).toContain("a@1.0.0");
  });
});
