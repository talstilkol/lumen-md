/**
 * Windows code signing through SignPath Foundation (plan W11.S15, research
 * R5.10). Smart App Control blocks unsigned apps, and Microsoft's Artifact
 * Signing isn't open to an individual in Israel; SignPath Foundation signs
 * OSI-licensed open-source projects (Lumen is MIT) for free, with its own
 * certificate. No EV certificate is involved.
 *
 * Tauri calls `bundle.windows.signCommand` for every binary it signs (the
 * app exe and the NSIS installer), with %1 as the file's path;
 * scripts/windows/signpath-sign.mjs submits the file to SignPath and puts
 * the signed file back in its place.
 *
 * A release is marked "Windows: signed" only when the SignPath details are
 * there AND the installer it produced verifies (scripts/windows/verify-signature.mjs).
 * Without them the release says so, and never claims a signature.
 */

/** What signpath-sign.mjs needs, from the SignPath organisation the Foundation sets up (W11.O1). */
export const SIGNPATH_ENV = ["SIGNPATH_API_TOKEN", "SIGNPATH_ORGANIZATION_ID", "SIGNPATH_PROJECT_SLUG", "SIGNPATH_SIGNING_POLICY_SLUG"];

/** The signCommand Tauri runs for each file (%1 = the file). */
export const SIGN_COMMAND = "node scripts/windows/signpath-sign.mjs %1";

/** Which SignPath details are present. */
export function windowsSigningPlan(env = process.env) {
  const missing = SIGNPATH_ENV.filter((k) => !String(env[k] ?? "").trim());
  return { configured: missing.length === 0, missing };
}

/** tauri.conf.json with SignPath as the Windows signer (and no certificate thumbprint). */
export function withSignPath(conf) {
  const out = structuredClone(conf);
  out.bundle ??= {};
  const { certificateThumbprint: _t, ...windows } = out.bundle.windows ?? {};
  out.bundle.windows = { ...windows, signCommand: SIGN_COMMAND };
  return out;
}

/**
 * The release's Windows signing record. `verified`: the results of
 * verify-signature.mjs on each Windows installer ([{ name, signed, why }]).
 * Signed only when SignPath was configured and every installer verified.
 */
export function windowsSigningRecord(plan, verified) {
  if (!plan.configured) return { signed: false, reason: `SignPath is not configured (${plan.missing.join(", ")} not set): the Windows installer is unsigned`, files: verified };
  if (!verified.length) return { signed: false, reason: "no Windows installer in this release", files: [] };
  const bad = verified.filter((v) => !v.signed);
  if (bad.length) return { signed: false, reason: `not signed: ${bad.map((b) => `${b.name} (${b.why})`).join("; ")}`, files: verified };
  return { signed: true, reason: "signed through SignPath Foundation; every installer verified", files: verified };
}

/**
 * Does `buf` (a PE file: .exe, .dll) carry an Authenticode signature?
 * Reads the PE header's certificate table (data directory 4) and the
 * WIN_CERTIFICATE it points to. This is a presence check: whether the
 * signature is valid and trusted is signtool's job (`signtool verify /pa`).
 * → { pe: boolean, signed: boolean, why }
 */
export function peSignature(buf) {
  const b = Buffer.from(buf);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return { pe: false, signed: false, why: "not a PE file (no MZ header)" };
  const pe = b.readUInt32LE(0x3c);
  if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x00004550) return { pe: false, signed: false, why: "not a PE file (no PE signature)" };
  const opt = pe + 24;
  const magic = b.readUInt16LE(opt);
  const dirs = magic === 0x20b ? opt + 112 : magic === 0x10b ? opt + 96 : -1;
  if (dirs < 0) return { pe: true, signed: false, why: "unknown optional header" };
  const count = b.readUInt32LE(dirs - 4);
  if (count < 5 || dirs + 5 * 8 > b.length) return { pe: true, signed: false, why: "no certificate table entry" };
  const off = b.readUInt32LE(dirs + 4 * 8);
  const size = b.readUInt32LE(dirs + 4 * 8 + 4);
  if (!off || !size) return { pe: true, signed: false, why: "unsigned: the certificate table is empty" };
  if (off + 8 > b.length || off + size > b.length) return { pe: true, signed: false, why: "the certificate table points past the end of the file" };
  const length = b.readUInt32LE(off);
  const revision = b.readUInt16LE(off + 4);
  const type = b.readUInt16LE(off + 6);
  if (type !== 0x0002 || (revision !== 0x0200 && revision !== 0x0100) || length < 8 || length > size) return { pe: true, signed: false, why: "the certificate table holds no PKCS#7 signature" };
  return { pe: true, signed: true, why: "has an Authenticode (PKCS#7) signature; check it with signtool verify /pa" };
}
