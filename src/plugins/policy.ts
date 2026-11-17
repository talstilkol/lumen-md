/**
 * Managed plugin policy (plan W13.L4): which plugins a team, a family or a
 * class may install, and which private registries they may install from.
 *
 * Two sources:
 *   - the device policy, set in this device's settings by whoever manages
 *     it (stored locally, never synced). It may list `policyKeys`;
 *   - the vault policy, `.lumen/plugin-policy.json`, which travels with a
 *     shared vault. It must be signed (Ed25519 over the canonical JSON of
 *     `policy`) by a key the device trusts for policies: one in the device
 *     policy's `policyKeys`, or one this device was told to trust. A vault
 *     policy that is present but not validly signed by a trusted key
 *     blocks every install (fail closed) and says why.
 *
 * Rules, every policy at once: a `deny` match blocks; when a policy has an
 * `allow` list, only what it lists may be installed; when a policy sets
 * `onlyListedRegistries`, a plugin installs only from the registries it
 * lists. A listed registry's key is trusted for that registry's index.
 *
 * Entries: "<id>" or "<id>@<version>" or "<id>@>=<version>"; an id may end
 * in ".*" for a whole publisher ("org.school.*").
 */
import { get as idbGet, set as idbSet } from "idb-keyval";
import { fingerprintOf, verifyWithKey } from "./signing";
import { semverAtLeast } from "./runtime/manifest";

export interface PolicyRegistry {
  name: string;
  /** The registry's base URL (where index.json and index.json.sig are). */
  url: string;
  /** Its Ed25519 public key, base64 SPKI: the key its index.json.sig is made with. */
  key: string;
}

export interface PluginPolicy {
  version: 1;
  name?: string;
  allow?: string[];
  deny?: string[];
  registries?: PolicyRegistry[];
  onlyListedRegistries?: boolean;
  /** Device policy only: the keys (SHA-256 fingerprints of SPKI) that may sign a vault policy. */
  policyKeys?: string[];
}

export interface SignedPolicyFile {
  policy: PluginPolicy;
  signature: { alg: "Ed25519"; publicKey: string; signature: string };
}

export type PolicySource = "device" | "vault";

export interface LoadedPolicy {
  source: PolicySource;
  policy: PluginPolicy | null;
  /** Why a present policy cannot be used; it then blocks every install. */
  error?: string;
  signedBy?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Machine-readable rule: "denied", "not-allowed", "registry", "invalid-policy". */
  rule?: "denied" | "not-allowed" | "registry" | "invalid-policy";
  reason?: string;
  source?: PolicySource;
  policyName?: string;
}

export const VAULT_POLICY_PATH = ".lumen/plugin-policy.json";
const DEVICE_POLICY_KEY = "lumen.plugins.device-policy";
const TRUSTED_POLICY_KEYS = "lumen.plugins.policy-keys";

/** JSON with sorted keys: what the signature covers. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

const ENTRY_RE = /^([a-z0-9][a-z0-9.-]{1,63}(?:\.\*)?)(?:@(>=)?(\d+\.\d+\.\d+))?$/;

/** Validate a policy's shape; throws with the first problem. */
export function parsePolicy(raw: unknown): PluginPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("a policy is an object");
  const p = raw as Record<string, unknown>;
  if (p.version !== 1) throw new Error('"version" must be 1');
  const list = (k: string): string[] | undefined => {
    const v = p[k];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`"${k}" must be a list of strings`);
    if (k !== "policyKeys") for (const x of v as string[]) if (!ENTRY_RE.test(x)) throw new Error(`"${k}": ${JSON.stringify(x)} is not "<id>", "<id>@<version>" or "<id>@>=<version>"`);
    if (k === "policyKeys") for (const x of v as string[]) if (!/^[0-9a-f]{64}$/.test(x)) throw new Error(`"policyKeys": ${JSON.stringify(x)} is not a SHA-256 fingerprint`);
    return v as string[];
  };
  const registries = p.registries;
  if (registries !== undefined) {
    if (!Array.isArray(registries)) throw new Error('"registries" must be a list');
    for (const r of registries as Record<string, unknown>[]) {
      if (typeof r?.name !== "string" || typeof r.url !== "string" || typeof r.key !== "string") throw new Error("a registry is { name, url, key }");
      let u: URL;
      try {
        u = new URL(r.url);
      } catch {
        throw new Error(`registry ${r.name}: "url" is not a URL`);
      }
      if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) throw new Error(`registry ${r.name}: https only`);
    }
  }
  if (p.onlyListedRegistries !== undefined && typeof p.onlyListedRegistries !== "boolean") throw new Error('"onlyListedRegistries" must be true or false');
  return {
    version: 1,
    ...(typeof p.name === "string" ? { name: p.name.slice(0, 120) } : {}),
    ...(list("allow") ? { allow: list("allow") } : {}),
    ...(list("deny") ? { deny: list("deny") } : {}),
    ...(registries ? { registries: (registries as PolicyRegistry[]).map((r) => ({ name: r.name, url: r.url.replace(/\/+$/, ""), key: r.key })) } : {}),
    ...(p.onlyListedRegistries ? { onlyListedRegistries: true } : {}),
    ...(list("policyKeys") ? { policyKeys: list("policyKeys") } : {}),
  };
}

/** Does `entry` name this plugin version? */
export function entryMatches(entry: string, id: string, version: string): boolean {
  const m = ENTRY_RE.exec(entry);
  if (!m) return false;
  const [, pat, atLeast, v] = m;
  const idOk = pat.endsWith(".*") ? id.startsWith(pat.slice(0, -1)) : id === pat;
  if (!idOk) return false;
  if (!v) return true;
  return atLeast ? semverAtLeast(version, v) : version === v;
}

const sameRegistry = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** The decision for one install, under every loaded policy. */
export function decide(policies: readonly LoadedPolicy[], target: { id: string; version: string; registry: string }): PolicyDecision {
  for (const lp of policies) {
    if (lp.error) return { allowed: false, rule: "invalid-policy", reason: lp.error, source: lp.source };
  }
  for (const lp of policies) {
    const p = lp.policy;
    if (!p) continue;
    const name = p.name;
    if ((p.deny ?? []).some((e) => entryMatches(e, target.id, target.version))) return { allowed: false, rule: "denied", reason: `${target.id} is on the deny list`, source: lp.source, policyName: name };
    if (p.allow && !p.allow.some((e) => entryMatches(e, target.id, target.version))) return { allowed: false, rule: "not-allowed", reason: `${target.id}@${target.version} is not on the allow list`, source: lp.source, policyName: name };
    if (p.onlyListedRegistries && !(p.registries ?? []).some((r) => sameRegistry(r.url, target.registry))) return { allowed: false, rule: "registry", reason: `${target.registry} is not one of the policy's registries`, source: lp.source, policyName: name };
  }
  return { allowed: true };
}

/** The registry key a policy vouches for at `base`, if any. */
export function policyRegistryKey(policies: readonly LoadedPolicy[], base: string): PolicyRegistry | null {
  for (const lp of policies) for (const r of lp.policy?.registries ?? []) if (sameRegistry(r.url, base)) return r;
  return null;
}

/**
 * Check a vault policy file: valid JSON, a valid policy, signed by a key in `trusted` (fingerprints).
 * Never throws: a problem becomes `error`, which blocks installs.
 */
export async function loadVaultPolicy(text: string | null, trusted: ReadonlySet<string>): Promise<LoadedPolicy | null> {
  if (text === null) return null;
  let file: SignedPolicyFile;
  try {
    file = JSON.parse(text) as SignedPolicyFile;
  } catch {
    return { source: "vault", policy: null, error: `${VAULT_POLICY_PATH} is not JSON` };
  }
  let policy: PluginPolicy;
  try {
    policy = parsePolicy(file?.policy);
  } catch (e) {
    return { source: "vault", policy: null, error: `${VAULT_POLICY_PATH}: ${(e as Error).message}` };
  }
  const sig = file.signature;
  if (!sig || sig.alg !== "Ed25519" || typeof sig.publicKey !== "string" || typeof sig.signature !== "string") return { source: "vault", policy: null, error: `${VAULT_POLICY_PATH} is not signed` };
  const fp = await fingerprintOf(sig.publicKey).catch(() => "");
  if (!fp || !trusted.has(fp)) return { source: "vault", policy: null, error: `${VAULT_POLICY_PATH} is signed by a key this device does not trust for policies`, signedBy: fp };
  const ok = await verifyWithKey(new TextEncoder().encode(canonicalJson(file.policy)), sig.signature, sig.publicKey);
  if (!ok) return { source: "vault", policy: null, error: `${VAULT_POLICY_PATH}: the signature does not match the policy`, signedBy: fp };
  // The device-only field never comes from a vault: a vault cannot name its own signers.
  const { policyKeys: _ignored, ...rest } = policy;
  return { source: "vault", policy: rest, signedBy: fp };
}

/* ─── This device: its policy and the policy keys it trusts (local, never synced) ─── */

export async function getDevicePolicy(): Promise<PluginPolicy | null> {
  const raw = await idbGet(DEVICE_POLICY_KEY).catch(() => undefined);
  if (!raw) return null;
  try {
    return parsePolicy(raw);
  } catch {
    return null;
  }
}

export async function setDevicePolicy(p: PluginPolicy | null): Promise<void> {
  await idbSet(DEVICE_POLICY_KEY, p ? parsePolicy(p) : null);
}

export async function trustedPolicyKeys(device: PluginPolicy | null): Promise<Set<string>> {
  const own = ((await idbGet(TRUSTED_POLICY_KEYS).catch(() => undefined)) as string[] | undefined) ?? [];
  return new Set([...own, ...(device?.policyKeys ?? [])]);
}

export async function trustPolicyKey(fingerprint: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("a policy key is a SHA-256 fingerprint");
  const own = ((await idbGet(TRUSTED_POLICY_KEYS).catch(() => undefined)) as string[] | undefined) ?? [];
  if (!own.includes(fingerprint)) await idbSet(TRUSTED_POLICY_KEYS, [...own, fingerprint]);
}

/** Every policy in force here: the device's, then the vault's. `readVaultFile` returns null when the file is absent. */
export async function loadPolicies(readVaultFile: (path: string) => Promise<string | null>): Promise<LoadedPolicy[]> {
  const device = await getDevicePolicy();
  const out: LoadedPolicy[] = [];
  if (device) out.push({ source: "device", policy: device });
  const vault = await loadVaultPolicy(await readVaultFile(VAULT_POLICY_PATH).catch(() => null), await trustedPolicyKeys(device));
  if (vault) out.push(vault);
  return out;
}
