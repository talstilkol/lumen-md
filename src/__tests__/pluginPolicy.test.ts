/**
 * W13.L4 — managed plugin policy: a signed policy.json (in the vault, or
 * this device's own) with allow / deny lists and private registries. A
 * plugin not on the list is not installed; a private registry the policy
 * names, signed with the key the policy gives, is accepted; a vault policy
 * that is not validly signed by a trusted key blocks every install.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
// @ts-expect-error — a plain .mjs module of the build scripts
import { generateSigningKey, signRegistryBytes } from "../../scripts/lib/plugin-registry-sign.mjs";
// @ts-expect-error — a plain .mjs script
import { canonicalJson as cliCanonical, checkPolicyFile, signPolicy } from "../../scripts/plugin-policy.mjs";
import { canonicalJson, decide, entryMatches, loadPolicies, loadVaultPolicy, parsePolicy, setDevicePolicy, trustPolicyKey, type LoadedPolicy, type PluginPolicy } from "../plugins/policy";
import { installFromRegistry, installedPlugins, uninstallPlugin, InstallRefused } from "../plugins/install";
import { trustKey, untrustKey } from "../plugins/signing";
import { __resetLedger } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";
import { fakePluginWorker } from "./helpers/pluginWorker";

const enc = new TextEncoder();
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

const PUBLIC = "https://plugins.example.org/registry";
const SCHOOL = "https://plugins.school.example/registry";
const plugin = (id: string) => ({
  manifest: JSON.stringify({ schema: 1, id, name: `Sample ${id}`, version: "1.0.0", description: "policy test sample", author: "Lumen tests", license: "MIT", main: "main.js", capabilities: [{ id: "commands", reason: "Adds a command" }] }),
  code: `lumen.commands.register({ id: "hi", label: "Hi" }, () => undefined);\n`,
});

/** A registry at `base` with the given plugins, its index signed by `pem`. */
function registry(base: string, ids: string[], pem: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const plugins = ids.map((id) => {
    const p = plugin(id);
    files.set(`${base}/${id}/lumen-plugin.json`, enc.encode(p.manifest));
    files.set(`${base}/${id}/main.js`, enc.encode(p.code));
    return { id, name: id, versions: [{ version: "1.0.0", path: id, sha256: sha(p.code), manifestSha256: sha(p.manifest) }] };
  });
  const index = enc.encode(JSON.stringify({ plugins }, null, 2) + "\n");
  files.set(`${base}/index.json`, index);
  files.set(`${base}/index.json.sig`, enc.encode(JSON.stringify(signRegistryBytes(index, pem))));
  return files;
}
const serve = (...maps: Map<string, Uint8Array>[]) => {
  const all = new Map(maps.flatMap((m) => [...m]));
  const hits: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hits.push(url);
    const b = all.get(url);
    return b ? new Response(b.slice(), { status: 200 }) : new Response("nf", { status: 404 });
  }) as typeof fetch;
  return { fetch: f, hits };
};
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InstallRefused) return `${e.reason}: ${e.message}`;
    throw e;
  }
  return "installed";
}

let publicKey: ReturnType<typeof generateSigningKey>;
let schoolKey: ReturnType<typeof generateSigningKey>;
let teacher: ReturnType<typeof generateSigningKey>;
beforeEach(async () => {
  localStorage.clear();
  __resetLedger();
  setAiPolicy("local-first");
  publicKey = generateSigningKey();
  schoolKey = generateSigningKey();
  teacher = generateSigningKey();
  await trustKey(publicKey.fingerprint, publicKey.spkiBase64);
  await setDevicePolicy(null);
});
afterEach(async () => {
  for (const id of ["lumen.flashcards", "org.school.quiz", "evil.miner"]) await uninstallPlugin(id).catch(() => undefined);
  await untrustKey(publicKey.fingerprint);
});

const vaultPolicy = (p: PluginPolicy, key = teacher) => JSON.stringify(signPolicy(p, key.privateKeyPem));

describe("rules", () => {
  it("entries: an id, an exact version, a minimum version, a publisher prefix", () => {
    expect(entryMatches("lumen.flashcards", "lumen.flashcards", "2.0.0")).toBe(true);
    expect(entryMatches("lumen.flashcards@1.0.0", "lumen.flashcards", "1.0.1")).toBe(false);
    expect(entryMatches("lumen.flashcards@>=1.2.0", "lumen.flashcards", "1.10.0")).toBe(true);
    expect(entryMatches("lumen.flashcards@>=1.2.0", "lumen.flashcards", "1.1.9")).toBe(false);
    expect(entryMatches("org.school.*", "org.school.quiz", "1.0.0")).toBe(true);
    expect(entryMatches("org.school.*", "org.schoolx.quiz", "1.0.0")).toBe(false);
    expect(() => parsePolicy({ version: 1, allow: ["Not An Id"] })).toThrow(/allow/);
    expect(() => parsePolicy({ version: 1, registries: [{ name: "x", url: "http://evil.example", key: "k" }] })).toThrow(/https only/);
    expect(() => parsePolicy({ version: 2 })).toThrow(/version/);
  });

  it("deny wins, an allow list restricts, onlyListedRegistries pins the source, a broken policy blocks everything", () => {
    const P = (policy: PluginPolicy, source: "device" | "vault" = "vault"): LoadedPolicy => ({ source, policy });
    const t = { id: "lumen.flashcards", version: "1.0.0", registry: PUBLIC };
    expect(decide([], t)).toEqual({ allowed: true });
    expect(decide([P({ version: 1, allow: ["lumen.*"], deny: ["lumen.flashcards"] })], t)).toMatchObject({ allowed: false, rule: "denied" });
    expect(decide([P({ version: 1, allow: ["org.school.*"] })], t)).toMatchObject({ allowed: false, rule: "not-allowed" });
    // Two policies: both must allow.
    expect(decide([P({ version: 1, allow: ["lumen.*"] }, "device"), P({ version: 1, allow: ["org.school.*"] })], t)).toMatchObject({ allowed: false, source: "vault" });
    expect(decide([P({ version: 1, onlyListedRegistries: true, registries: [{ name: "S", url: SCHOOL, key: "k" }] })], t)).toMatchObject({ allowed: false, rule: "registry" });
    expect(decide([{ source: "vault", policy: null, error: "not signed" }], t)).toMatchObject({ allowed: false, rule: "invalid-policy", reason: "not signed" });
  });
});

describe("the signed vault policy", () => {
  const policy: PluginPolicy = { version: 1, name: "Class 7B", allow: ["lumen.flashcards", "org.school.*"] };

  it("the CLI and the app sign and check the same bytes", () => {
    const o = { b: [2, { z: 1, a: undefined }], a: "א" };
    expect(cliCanonical(o)).toBe(canonicalJson(o));
    const file = signPolicy(policy, teacher.privateKeyPem);
    expect(checkPolicyFile(file, [teacher.fingerprint])).toEqual({ ok: true, fingerprint: teacher.fingerprint, trusted: true });
  });

  it("is used when its key is trusted on this device; refused (and blocks) when the key is not trusted, the policy was changed, or it is unsigned", async () => {
    const ok = await loadVaultPolicy(vaultPolicy(policy), new Set([teacher.fingerprint]));
    expect(ok).toMatchObject({ source: "vault", policy, signedBy: teacher.fingerprint });
    expect((await loadVaultPolicy(vaultPolicy(policy), new Set()))?.error).toMatch(/does not trust/);
    const tampered = JSON.parse(vaultPolicy(policy));
    tampered.policy.allow.push("evil.miner");
    expect((await loadVaultPolicy(JSON.stringify(tampered), new Set([teacher.fingerprint])))?.error).toMatch(/signature does not match/);
    expect((await loadVaultPolicy(JSON.stringify({ policy }), new Set([teacher.fingerprint])))?.error).toMatch(/not signed/);
    expect((await loadVaultPolicy("{", new Set()))?.error).toMatch(/not JSON/);
    expect(await loadVaultPolicy(null, new Set())).toBeNull();
  });

  it("a vault cannot name its own signers: policyKeys only count from this device's policy", async () => {
    const sneaky = { ...policy, policyKeys: ["f".repeat(64)] };
    const r = await loadVaultPolicy(vaultPolicy(sneaky), new Set([teacher.fingerprint]));
    expect(r?.policy).not.toHaveProperty("policyKeys");
    // The device policy's policyKeys (or a key this device was told to trust) make the vault's signer trusted.
    await setDevicePolicy({ version: 1, policyKeys: [teacher.fingerprint] });
    const loaded = await loadPolicies(async () => vaultPolicy(policy));
    expect(loaded.map((l) => [l.source, l.error ?? "ok"])).toEqual([
      ["device", "ok"],
      ["vault", "ok"],
    ]);
    await setDevicePolicy(null);
    expect((await loadPolicies(async () => vaultPolicy(policy)))[0].error).toMatch(/does not trust/);
    await trustPolicyKey(teacher.fingerprint);
    expect((await loadPolicies(async () => vaultPolicy(policy)))[0].error).toBeUndefined();
  });
});

describe("the install path honours the policy", () => {
  it("a plugin not on the allow list is not installed (and nothing of it is downloaded)", async () => {
    const srv = serve(registry(PUBLIC, ["lumen.flashcards", "evil.miner"], publicKey.privateKeyPem));
    const policies = [(await loadVaultPolicy(vaultPolicy({ version: 1, allow: ["lumen.flashcards"] }), new Set([teacher.fingerprint])))!];
    expect(await refusal(installFromRegistry(PUBLIC, "evil.miner", undefined, { fetch: srv.fetch, createWorker: fakePluginWorker, policies }))).toMatch(/^policy: .*evil\.miner@1\.0\.0 is not on the allow list/);
    expect(srv.hits.some((u) => u.includes("/evil.miner/"))).toBe(false);
    expect(await installedPlugins()).not.toHaveProperty("evil.miner");
    // The allowed one installs.
    expect(await refusal(installFromRegistry(PUBLIC, "lumen.flashcards", undefined, { fetch: srv.fetch, createWorker: fakePluginWorker, policies }))).toBe("installed");
  });

  it("a broken vault policy blocks installs before any download", async () => {
    const srv = serve(registry(PUBLIC, ["lumen.flashcards"], publicKey.privateKeyPem));
    const policies = [(await loadVaultPolicy(vaultPolicy({ version: 1 }), new Set()))!];
    expect(await refusal(installFromRegistry(PUBLIC, "lumen.flashcards", undefined, { fetch: srv.fetch, createWorker: fakePluginWorker, policies }))).toMatch(/^policy: .*does not trust/);
    expect(srv.hits).toEqual([]);
  });

  it("a signed private registry named by the policy is accepted with the key the policy gives — and only that key", async () => {
    // The school's key is not trusted by the app at all; only the policy vouches for it, for this registry.
    const school = registry(SCHOOL, ["org.school.quiz"], schoolKey.privateKeyPem);
    const p: PluginPolicy = { version: 1, allow: ["org.school.*"], registries: [{ name: "School", url: SCHOOL, key: schoolKey.spkiBase64 }], onlyListedRegistries: true };
    const policies = [(await loadVaultPolicy(vaultPolicy(p), new Set([teacher.fingerprint])))!];
    expect(await refusal(installFromRegistry(SCHOOL, "org.school.quiz", undefined, { fetch: serve(school).fetch, createWorker: fakePluginWorker, policies }))).toBe("installed");
    expect((await installedPlugins())["org.school.quiz"]).toMatchObject({ registry: SCHOOL });
    await uninstallPlugin("org.school.quiz");
    // Without the policy, the school's key is unknown: refused.
    expect(await refusal(installFromRegistry(SCHOOL, "org.school.quiz", undefined, { fetch: serve(school).fetch, createWorker: fakePluginWorker, policies: [] }))).toMatch(/^registry-untrusted-signer/);
    // The same registry signed by another key (the public registry's): refused, even though the app trusts that key.
    const forged = registry(SCHOOL, ["org.school.quiz"], publicKey.privateKeyPem);
    expect(await refusal(installFromRegistry(SCHOOL, "org.school.quiz", undefined, { fetch: serve(forged).fetch, createWorker: fakePluginWorker, policies }))).toMatch(/^registry-untrusted-signer: .*not the key the plugin policy names/);
    // onlyListedRegistries: the public registry is off limits under this policy.
    const pub = serve(registry(PUBLIC, ["org.school.quiz"], publicKey.privateKeyPem));
    expect(await refusal(installFromRegistry(PUBLIC, "org.school.quiz", undefined, { fetch: pub.fetch, createWorker: fakePluginWorker, policies }))).toMatch(/^policy: .*not one of the policy's registries/);
  });
});
