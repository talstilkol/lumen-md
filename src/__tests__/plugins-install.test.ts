/**
 * Plan 11.2 (c) — install trust and lifecycle: the registry is up to date
 * with the examples; a bundle must match the registry's sha256; a signed
 * bundle must verify against a trusted key; an update never grants a new
 * capability by itself; uninstall removes the plugin's data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundlePayload, parseBundle, serializeBundle } from "../plugins/runtime/bundle";
import { carriedGrants, installPlugin, listInstalled, setGrants, uninstallPlugin, verifyBundle } from "../plugins/runtime/installed";
import { parseManifest } from "../plugins/runtime/manifest";

const startPlugin = vi.fn(async () => ({}));
vi.mock("../plugins/runtime/manager", () => ({ startPlugin: (...a: unknown[]) => startPlugin(...(a as [])), stopPlugin: async () => undefined, clearPluginData: async (id: string) => void localStorage.removeItem(`lumen.plugin.settings.${id}`) }));

const root = resolve(__dirname, "../..");
const bundleText = readFileSync(join(root, "public/plugins/bundles/lumen.example.word-stats-1.0.0.lumenplugin.json"), "utf8");
const registry = JSON.parse(readFileSync(join(root, "public/plugins/registry.json"), "utf8")) as { plugins: { id: string; sha256: string }[] };

beforeEach(async () => {
  localStorage.clear();
  startPlugin.mockClear();
  const { set } = await import("idb-keyval");
  await set("lumen.plugins.installed", []);
  await set("lumen.plugins.trusted-keys", {});
});

describe("registry", () => {
  it("is built from the examples and up to date (scripts/build-plugin-registry.mjs --check)", () => {
    expect(() => execFileSync("node", [join(root, "scripts/build-plugin-registry.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
    expect(registry.plugins.map((p) => p.id).sort()).toEqual(["lumen.example.callout", "lumen.example.outline", "lumen.example.word-stats"]);
  });
});

describe("verifyBundle", () => {
  const b = parseBundle(bundleText);
  const pinned = registry.plugins.find((p) => p.id === "lumen.example.word-stats")!.sha256;

  it("accepts the registry's bytes, refuses anything else", async () => {
    await expect(verifyBundle(b, pinned)).resolves.toEqual({ sha256: pinned, trust: "pinned" });
    await expect(verifyBundle({ ...b, main: b.main + "\n// tampered" }, pinned)).rejects.toThrow(/do not match/);
  });
  it("a file with no signature is unverified", async () => {
    await expect(verifyBundle(b)).resolves.toMatchObject({ trust: "unverified" });
  });
  it("a signature by a trusted key makes it 'signed'; a bad signature refuses it; an untrusted signer vouches nothing", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ type: "spki", format: "der" });
    const fp = createHash("sha256").update(spki).digest("hex");
    const signature = sign(null, Buffer.from(bundlePayload(b.manifestText, b.main)), privateKey).toString("base64");
    const signed = parseBundle(serializeBundle({ manifestText: b.manifestText, main: b.main, signature, signedBy: fp }));
    await expect(verifyBundle(signed)).resolves.toMatchObject({ trust: "unverified" }); // not trusted yet
    const { trustKey } = await import("../plugins/signing");
    await trustKey(fp, spki.toString("base64"));
    await expect(verifyBundle(signed)).resolves.toMatchObject({ trust: "signed" });
    await expect(verifyBundle({ ...signed, main: signed.main + " " })).rejects.toThrow(/signature is invalid/);
  });
});

describe("install lifecycle", () => {
  const b = parseBundle(bundleText);
  it("grants are only what the user ticked, capped by the manifest", async () => {
    await installPlugin(b, { sha256: "s", trust: "pinned", source: "registry", grants: ["commands", "vault:write", "network:https://evil.example"] });
    expect((await listInstalled())[0].grants).toEqual(["commands"]);
    expect(startPlugin).toHaveBeenCalledTimes(1);
    await setGrants(b.manifest.id, ["commands", "panel"]);
    expect((await listInstalled())[0].grants).toEqual(["commands", "panel"]);
    expect(startPlugin).toHaveBeenCalledTimes(2); // restarted with the new grants
  });
  it("an update keeps granted capabilities it still asks for and grants nothing new", () => {
    const prev = { grants: ["commands", "panel"] } as never;
    const next = parseManifest({ ...JSON.parse(b.manifestText), version: "2.0.0", capabilities: [{ id: "commands", reason: "r" }, { id: "network:https://api.example.com", reason: "r" }] });
    expect(carriedGrants(prev, next)).toEqual(["commands"]);
  });
  it("uninstall removes the plugin and its data", async () => {
    await installPlugin(b, { sha256: "s", trust: "pinned", source: "registry", grants: [] });
    localStorage.setItem(`lumen.plugin.settings.${b.manifest.id}`, "{}");
    await uninstallPlugin(b.manifest.id);
    expect(await listInstalled()).toEqual([]);
    expect(localStorage.getItem(`lumen.plugin.settings.${b.manifest.id}`)).toBeNull();
  });
});

describe("parseBundle", () => {
  it.each([
    ["{", /invalid JSON/],
    ['{"format":"other"}', /format/],
    ['{"format":"lumen-plugin/1","manifest":{},"main":""}', /must be strings/],
    [JSON.stringify({ format: "lumen-plugin/1", manifest: "{}", main: "" }), /schema/],
    [JSON.stringify({ format: "lumen-plugin/1", manifest: JSON.parse(bundleText).manifest, main: "", signature: "x" }), /go together/],
  ])("refuses %s", (text, re) => {
    expect(() => parseBundle(text)).toThrow(re);
  });
});
