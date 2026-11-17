#!/usr/bin/env node
/**
 * Check a release (plan W1.27): both signatures against the public key,
 * every file against SHA256SUMS, and the SBOM's presence and format.
 * From the command line (`npm run release:verify`) also, for the commit the
 * release names (SHA256SUMS.minisig's trusted comment):
 *   - W13.T3: source-vsa.json, a SLSA source VSA for that commit, signed by a
 *     key in security/source-vsa.json, PASSED at SLSA_SOURCE_LEVEL_2;
 *   - W13.T4: the tag v<version> is an SSH-signed tag of that commit, by a key
 *     in security/allowed_signers (and `git verify-tag` agrees, where
 *     ssh-keygen is installed).
 * Neither can be skipped: a release without them does not verify.
 *
 *   node scripts/supply-chain/verify-release.mjs [release] [--pub security/release-key.pub] [--root .] [--tag-file <raw tag object>]
 *
 * Files listed as dist/… are looked up under --root (the unpacked web
 * bundle); others next to SHA256SUMS. Anyone can run this — it needs only
 * the public key. With minisign installed, the same check is
 *   minisign -Vm release/SHA256SUMS -P <public key>  &&  (cd <root> && sha256sum -c release/SHA256SUMS)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isFile, opts, parseChecksums, sha256File } from "./lib.mjs";
import { formatPublicKey, keyIdHex, parsePublicKey, rawPublicKey, readSecretKey, verifyData } from "./minisign.mjs";
import { checkVsa } from "./source-vsa-lib.mjs";
import { verifyTag } from "./sshsig.mjs";
import { spawnSync } from "node:child_process";

/** The release's version and commit, from SHA256SUMS.minisig's trusted comment ("lumen-md <v> commit:<sha> file:… timestamp:…"). */
export function releaseIdentity(trusted) {
  const m = /^lumen-md (\S+) commit:([0-9a-f]{40})\b/.exec(String(trusted ?? ""));
  return m ? { version: m[1], commit: m[2] } : null;
}

/**
 * W13.T3 + T4: the source VSA and the signed tag of the release commit.
 * `vsa`: the DSSE envelope (or null); `tagRaw`: `git cat-file tag v<version>` (or null).
 * → string[] problems
 */
export function sourceProblems({ identity, vsa, trustedPems, tagRaw, allowedSigners, now = new Date() }) {
  const out = [];
  if (!identity) return ["SHA256SUMS.minisig names no release commit (lumen-md <version> commit:<sha>)"];
  if (!vsa) out.push(`source-vsa.json is missing: make it with npm run release:source-vsa -- --ref main --commit ${identity.commit} --fetch`);
  else out.push(...checkVsa(vsa, { commit: identity.commit, trustedPems }).problems);
  if (!tagRaw) out.push(`tag v${identity.version} is not in this repository (git fetch --tags)`);
  else {
    const t = verifyTag(tagRaw, allowedSigners ?? "", { now });
    out.push(...t.problems.map((p) => `tag v${identity.version}: ${p}`));
    const obj = /^object ([0-9a-f]{40})/.exec(tagRaw)?.[1];
    if (obj && obj !== identity.commit) out.push(`tag v${identity.version} points at ${obj}, not the release commit ${identity.commit}`);
  }
  return out;
}

/** Returns { ok, errors, checked, keyId, keyFrom, identity }. `pem` only stands in for a missing public key (right after signing). */
export function verifyRelease({ dir, root, pub, pem, passphrase }) {
  const errors = [];
  let keyText = pub;
  let keyFrom = "public key";
  if (!keyText && pem) {
    keyText = formatPublicKey(rawPublicKey(readSecretKey(pem, passphrase)));
    keyFrom = "secret key";
  }
  if (!keyText) return { ok: false, errors: ["no public key (security/release-key.pub)"], checked: 0, keyId: "", keyFrom };
  const keyId = keyIdHex(parsePublicKey(keyText).id);
  let identity = null;
  for (const name of ["SHA256SUMS", "sbom.cdx.json"]) {
    const file = join(dir, name);
    if (!isFile(file) || !isFile(`${file}.minisig`)) {
      errors.push(`${name} or its signature is missing`);
      continue;
    }
    try {
      const trusted = verifyData(readFileSync(file), readFileSync(`${file}.minisig`, "utf8"), keyText);
      if (!trusted.includes(`file:${name}`)) errors.push(`${name}.minisig was made for another file (${trusted})`);
      if (name === "SHA256SUMS") identity = releaseIdentity(trusted);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  let checked = 0;
  if (isFile(join(dir, "SHA256SUMS"))) {
    for (const { hash, path } of parseChecksums(readFileSync(join(dir, "SHA256SUMS"), "utf8"))) {
      const at = path.startsWith("dist/") ? join(root, path) : join(dir, path);
      if (!existsSync(at)) errors.push(`${path} is missing`);
      else if (sha256File(at) !== hash) errors.push(`${path} does not match SHA256SUMS`);
      else checked++;
    }
  }
  if (isFile(join(dir, "sbom.cdx.json"))) {
    try {
      const s = JSON.parse(readFileSync(join(dir, "sbom.cdx.json"), "utf8"));
      if (s.bomFormat !== "CycloneDX" || !Array.isArray(s.components) || !s.components.length) errors.push("sbom.cdx.json is not a CycloneDX SBOM with components");
    } catch (e) {
      errors.push(`sbom.cdx.json: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, errors, checked, keyId, keyFrom, identity };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = opts(process.argv);
  const dir = resolve(o.args.find((a, i) => !a.startsWith("--") && !o.args[i - 1]?.startsWith("--")) ?? "release");
  const root = resolve(o.get("--root", "."));
  const pubPath = resolve(o.get("--pub", join(root, "security", "release-key.pub")));
  if (!isFile(pubPath)) {
    console.error(`No public key at ${pubPath}.`);
    process.exit(2);
  }
  const r = verifyRelease({ dir, root, pub: readFileSync(pubPath, "utf8") });
  // W13.T3 + T4: the source VSA and the signed tag; neither can be skipped here.
  const read = (p) => (isFile(p) ? readFileSync(p, "utf8") : null);
  const trust = JSON.parse(read(join(root, "security", "source-vsa.json")) ?? "{}");
  const vsaText = read(join(dir, "source-vsa.json"));
  let tagRaw = o.get("--tag-file", null) ? read(resolve(o.get("--tag-file"))) : null;
  if (!tagRaw && r.identity) {
    const t = spawnSync("git", ["cat-file", "tag", `v${r.identity.version}`], { cwd: root, encoding: "utf8" });
    tagRaw = t.status === 0 ? t.stdout : null;
  }
  const allowed = read(join(root, "security", "allowed_signers"));
  const src = sourceProblems({ identity: r.identity, vsa: vsaText ? JSON.parse(vsaText) : null, trustedPems: trust.keys ?? [], tagRaw, allowedSigners: allowed });
  // Where OpenSSH's ssh-keygen is installed, git's own check must agree (with that program, whatever signer git is set up with).
  const hasSshKeygen = spawnSync("ssh-keygen", ["-Y", "check-novalidate"], { input: "", encoding: "utf8" }).error?.code !== "ENOENT";
  if (!src.length && r.identity && !o.get("--tag-file", null) && hasSshKeygen) {
    const g = spawnSync("git", ["-c", "gpg.ssh.program=ssh-keygen", "-c", `gpg.ssh.allowedSignersFile=${join(root, "security", "allowed_signers")}`, "verify-tag", `v${r.identity.version}`], { cwd: root, encoding: "utf8" });
    if (g.status !== 0) src.push(`git verify-tag v${r.identity.version} refused it: ${String(g.stderr).trim().split("\n")[0]}`);
  }
  const errors = [...r.errors, ...src];
  console.log(!errors.length ? `OK: ${r.checked} files match SHA256SUMS; SHA256SUMS and sbom.cdx.json are signed by key ${r.keyId}; commit ${r.identity.commit.slice(0, 12)} has a source VSA (SLSA_SOURCE_LEVEL_2) and tag v${r.identity.version} is signed by an allowed signer.` : `FAIL:\n  ${errors.join("\n  ")}`);
  process.exit(errors.length ? 1 : 0);
}
