/**
 * Author signatures for plugin versions (plan W13.L5): keyless Sigstore.
 *
 * What is signed: the author statement of one version, a few lines that
 * name the plugin, its version, and the SHA-256 of its manifest and of its
 * code. The author signs it with `cosign sign-blob --bundle` after an OIDC
 * login (GitHub); the bundle (author.sigstore.json, Sigstore bundle v0.3:
 * Fulcio certificate, Rekor entry) goes next to the version in the
 * registry.
 *
 * What is checked (registry build, `npm run registry:verify`, the tests):
 * the bundle is valid against Sigstore's trust root (signature over these
 * exact bytes, certificate chain, a transparency-log entry and an SCT), and
 * the certificate's identity is the GitHub account the manifest names in
 * `publisher.github`:
 *   - a GitHub login (issuer https://github.com/login/oauth): the
 *     certificate's email must be that account's no-reply address
 *     (`<login>@users.noreply.github.com` or `<id>+<login>@…`), the only
 *     email GitHub ties to a login;
 *   - GitHub Actions (issuer https://token.actions.githubusercontent.com):
 *     the certificate's URI must be a workflow in a repository the account
 *     owns (`https://github.com/<login>/…`).
 * Anything else is "not verified": a signature by someone else is refused
 * (OX Security showed a badge without a signature behind it is spoofable).
 *
 * The Ed25519-signed registry index (W10.B3) stays the second layer: the
 * app trusts the "verified author" mark only because it is inside the
 * signed index.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const GITHUB_OAUTH = "https://github.com/login/oauth";
export const GITHUB_ACTIONS = "https://token.actions.githubusercontent.com";
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** The bytes an author signs for one version. */
export function authorStatement({ id, version, manifestBytes, codeBytes }) {
  return Buffer.from(`lumen-plugin-author-v1\n${id}@${version}\nmanifest sha256:${sha(manifestBytes)}\nmain sha256:${sha(codeBytes)}\n`);
}

/** Does a certificate identity (SAN, issuer) belong to the GitHub account `login`? */
export function identityMatches({ san, issuer }, login) {
  if (typeof login !== "string" || !LOGIN_RE.test(login)) return { ok: false, reason: `publisher.github ${JSON.stringify(login)} is not a GitHub login` };
  const l = login.toLowerCase();
  const s = String(san ?? "");
  if (issuer === GITHUB_OAUTH) {
    const m = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i.exec(s);
    if (m && m[1].toLowerCase() === l) return { ok: true };
    return { ok: false, reason: `signed by ${s} (GitHub login), not ${login}'s no-reply address` };
  }
  if (issuer === GITHUB_ACTIONS) {
    const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/[A-Za-z0-9._-]+\/\.github\/workflows\/[^@]+@refs\/(tags|heads)\/.+$/.exec(s);
    if (m && m[1].toLowerCase() === l) return { ok: true };
    return { ok: false, reason: `signed by workflow ${s}, not a repository of ${login}` };
  }
  return { ok: false, reason: `issuer ${issuer} is not GitHub` };
}

/** npm's own sigstore-js (every Node install has it), as scripts/supply-chain/verify.mjs finds it. */
export function sigstoreJs(root = process.cwd()) {
  const candidates = [join(root, "node_modules/sigstore/package.json"), join(dirname(process.execPath), "../lib/node_modules/npm/node_modules/sigstore/package.json"), join(dirname(process.execPath), "node_modules/npm/node_modules/sigstore/package.json")];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const req = createRequire(c);
    try {
      return { verify: req("@sigstore/verify"), bundle: req("@sigstore/bundle"), specs: req("@sigstore/protobuf-specs"), tuf: req("@sigstore/tuf") };
    } catch {
      // why: an npm without the verifier inside; try the next place
    }
  }
  return null;
}

/** The certificate's SAN (email or URI) and Fulcio issuer extension, read from the bundle's leaf certificate. */
export function certificateIdentity(bundle) {
  const raw = bundle?.verificationMaterial?.certificate?.rawBytes ?? bundle?.verificationMaterial?.x509CertificateChain?.certificates?.[0]?.rawBytes;
  if (!raw) return null;
  const der = Buffer.from(raw, "base64");
  // SAN: OID 2.5.29.17; issuer: Fulcio's 1.3.6.1.4.1.57264.1.1 (raw string) or .1.8 (DER UTF8String).
  const find = (oidBytes) => {
    const i = der.indexOf(Buffer.from(oidBytes));
    return i < 0 ? null : i + oidBytes.length;
  };
  let san = null;
  const s = find([0x06, 0x03, 0x55, 0x1d, 0x11]);
  if (s !== null) {
    let p = s;
    if (der[p] === 0x01) p += 3; // critical BOOLEAN
    // OCTET STRING → SEQUENCE → [1] rfc822Name | [6] URI
    const skipLen = (q) => (der[q] & 0x80 ? 1 + (der[q] & 0x7f) : 1);
    p += 1 + skipLen(p + 1); // OCTET STRING header
    p += 1 + skipLen(p + 1); // SEQUENCE header
    const tag = der[p];
    const lenBytes = der[p + 1] & 0x80 ? der[p + 1] & 0x7f : 0;
    const len = lenBytes ? der.readUIntBE(p + 2, lenBytes) : der[p + 1];
    const start = p + 2 + lenBytes;
    if (tag === 0x81 || tag === 0x86) san = der.subarray(start, start + len).toString("utf8");
  }
  let issuer = null;
  const i1 = find([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xbf, 0x30, 0x01, 0x01]);
  if (i1 !== null) {
    const len = der[i1 + 1];
    issuer = der.subarray(i1 + 2, i1 + 2 + len).toString("utf8");
  }
  return { san, issuer };
}

/**
 * Verify one version's author bundle. `trustedRoot`: Sigstore's trusted_root.json (an object; offline), or
 * null to fetch it through Sigstore's TUF. Returns { ok, github, san, issuer, reason }.
 */
export async function verifyAuthor({ bundle, statement, github, trustedRoot = null, sjs = sigstoreJs() }) {
  if (!bundle) return { ok: false, reason: "no author signature (author.sigstore.json)" };
  if (!github) return { ok: false, reason: "the manifest names no publisher.github" };
  if (!sjs) return { ok: false, reason: "no Sigstore verifier here (cosign or npm's sigstore-js)" };
  const id = certificateIdentity(bundle);
  if (!id?.san || !id.issuer) return { ok: false, reason: "the bundle carries no Fulcio certificate identity" };
  const who = identityMatches(id, github);
  if (!who.ok) return { ok: false, ...id, reason: who.reason };
  try {
    const root = trustedRoot ? sjs.specs.TrustedRoot.fromJSON(trustedRoot) : await sjs.tuf.getTrustedRoot({});
    const verifier = new sjs.verify.Verifier(sjs.verify.toTrustMaterial(root));
    // sigstore-js matches the identity as a regular expression (String#match): the exact SAN, escaped and anchored,
    // so "1+alice@…" means a plus sign, and "alice@x.com" never matches "alice@x.com.evil.example".
    verifier.verify(sjs.verify.toSignedEntity(sjs.bundle.bundleFromJSON(bundle), statement), { subjectAlternativeName: `^${id.san.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, extensions: { issuer: id.issuer } });
  } catch (e) {
    return { ok: false, ...id, reason: `Sigstore: ${e.code ? `${e.code}: ` : ""}${e.message}` };
  }
  return { ok: true, github, ...id };
}

/** Read a version folder's statement inputs and bundle. */
export function versionFiles(dir) {
  const manifestBytes = readFileSync(join(dir, "lumen-plugin.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const codeBytes = readFileSync(join(dir, manifest.main ?? "main.js"));
  const bundlePath = join(dir, "author.sigstore.json");
  return { manifest, manifestBytes, codeBytes, bundle: existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, "utf8")) : null, statement: authorStatement({ id: manifest.id, version: manifest.version, manifestBytes, codeBytes }) };
}

/**
 * Sign a version folder as its author: writes author.sigstore.json. Real: `cosign sign-blob` (OIDC login in the
 * browser, Fulcio, Rekor). `local`: an offline stand-in (scripts/supply-chain/sigstore-local.mjs) for tests only.
 */
export async function signAuthor({ dir, local = null, spawn = null }) {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const f = versionFiles(dir);
  const out = join(dir, "author.sigstore.json");
  if (local) {
    writeFileSync(out, JSON.stringify(local.sigstore.signBlob(f.statement, { email: local.email, issuer: local.issuer ?? GITHUB_OAUTH }), null, 2) + "\n");
    return out;
  }
  const tmp = join(mkdtempSync(join(tmpdir(), "lumen-author-")), "statement.txt");
  writeFileSync(tmp, f.statement);
  const run = spawn ?? (await import("node:child_process")).spawnSync;
  const r = run("cosign", ["sign-blob", "--yes", "--bundle", out, tmp], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("cosign sign-blob failed (is cosign ≥ 3 installed? it opens a browser for the GitHub login)");
  return out;
}
