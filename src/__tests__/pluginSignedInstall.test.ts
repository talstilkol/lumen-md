/**
 * W10.B3 (audit W4.32, 11.2): install from a signed plugin registry.
 *
 * The sample registry here is synthetic: built in the test around a small
 * sample plugin written below (no top-level await, so it also runs on the
 * older QuickJS build of the offline shim), and signed with the owner
 * tooling (scripts/lib/plugin-registry-sign.mjs) using a key made for this
 * test.
 * The files are served by an in-memory HTTP stand-in; everything after the
 * download is the app's real code: the privacy ledger, signing.ts
 * (WebCrypto Ed25519), the SHA-256 checks, the scan, and the QuickJS
 * sandbox (through the in-process worker of the other plugin tests).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
// @ts-expect-error — a plain .mjs module of the build scripts
import { generateSigningKey, signRegistryBytes, verifyRegistryBytes } from "../../scripts/lib/plugin-registry-sign.mjs";
import { installFromRegistry, installedPlugins, uninstallPlugin, InstallRefused } from "../plugins/install";
import { trustKey, untrustKey } from "../plugins/signing";
import { runningPlugins } from "../plugins/runtime/manager";
import { getPluginCommands } from "../plugins/pluginSystem";
import { useAppStore } from "../store/useStore";
import { __resetLedger, ledgerEntries } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";
import { fakePluginWorker } from "./helpers/pluginWorker";

const BASE = "https://plugins.example.org/registry";
const ID = "sample.word-stamp";
const MANIFEST = JSON.stringify(
  {
    schema: 1,
    id: ID,
    name: "Word stamp (sample)",
    version: "1.0.0",
    description: "Sample plugin for the signed-install test: inserts the note's word count and remembers how often it ran.",
    author: "Lumen tests",
    license: "MIT",
    main: "main.js",
    capabilities: [
      { id: "commands", reason: "Adds the “Insert word count” command" },
      { id: "document:read", reason: "Counts the words of the open note" },
      { id: "document:write", reason: "Inserts the count" },
      { id: "settings", reason: "Remembers how often it ran" },
    ],
  },
  null,
  2,
);
const CODE = `// Sample plugin (synthetic, for pluginSignedInstall.test.ts).
lumen.commands.register({ id: "insert", label: "Insert word count" }, async () => {
  const text = await lumen.document.getText();
  const words = text.split(/\\s+/).filter(Boolean).length;
  const s = await lumen.settings.get();
  await lumen.settings.set({ runs: (s.runs || 0) + 1 });
  await lumen.document.insertText("<!-- words: " + words + " -->");
});
`;
const enc = new TextEncoder();
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

type Files = Map<string, Uint8Array>;

/** A sample registry: index.json listing the sample plugin, and its two files. */
function sampleRegistry(): { files: Files; indexText: string } {
  const manifest = enc.encode(MANIFEST);
  const code = enc.encode(CODE);
  const indexText =
    JSON.stringify({ plugins: [{ id: ID, name: "Word stamp (sample)", versions: [{ version: "1.0.0", path: "word-stamp", sha256: sha(code), manifestSha256: sha(manifest) }] }] }, null, 2) + "\n";
  const files: Files = new Map([
    [`${BASE}/index.json`, enc.encode(indexText)],
    [`${BASE}/word-stamp/lumen-plugin.json`, manifest],
    [`${BASE}/word-stamp/main.js`, code],
  ]);
  return { files, indexText };
}

function sign(files: Files, privateKeyPem: string): void {
  const sig = signRegistryBytes(files.get(`${BASE}/index.json`)!, privateKeyPem);
  files.set(`${BASE}/index.json.sig`, enc.encode(JSON.stringify(sig)));
}

/** An HTTP stand-in for the registry host: serves the map, 404 otherwise; counts requests. */
function server(files: Files) {
  const hits: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hits.push(url);
    const body = files.get(url);
    return body ? new Response(body.slice(), { status: 200, headers: { "content-length": String(body.length) } }) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetch: f, hits };
}

const flip = (b: Uint8Array, at: number) => {
  const c = b.slice();
  c[at] ^= 0x01;
  return c;
};

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InstallRefused) return e.reason;
    throw e;
  }
  return "installed";
}

let key: ReturnType<typeof generateSigningKey>;

beforeEach(async () => {
  localStorage.clear();
  __resetLedger();
  setAiPolicy("local-first");
  key = generateSigningKey();
  await trustKey(key.fingerprint, key.spkiBase64);
});

afterEach(async () => {
  await uninstallPlugin(ID).catch(() => undefined);
  await untrustKey(key.fingerprint);
});

describe("install → use → remove from a signed registry", () => {
  it("downloads through the ledger, checks signature and hashes, runs the plugin in QuickJS, and removal clears its permissions and data", async () => {
    const { files } = sampleRegistry();
    sign(files, key.privateKeyPem);
    const srv = server(files);

    const { instance, record } = await installFromRegistry(BASE, ID, undefined, { fetch: srv.fetch, createWorker: fakePluginWorker });

    // Every download is in the privacy ledger.
    const listed = ledgerEntries().filter((e) => e.host === "plugins.example.org");
    expect(listed.map((e) => e.category)).toEqual(["static-asset", "static-asset", "static-asset", "static-asset"]);
    expect(listed.every((e) => e.decision === "allowed" && e.status === 200)).toBe(true);
    expect(srv.hits).toEqual([`${BASE}/index.json`, `${BASE}/index.json.sig`, `${BASE}/word-stamp/lumen-plugin.json`, `${BASE}/word-stamp/main.js`]);

    // Running, with the permissions its manifest declares, and recorded.
    expect(instance.alive).toBe(true);
    expect(runningPlugins().map((p) => p.id)).toEqual([ID]);
    expect(record.grants).toEqual(["commands", "document:read", "document:write", "settings"]);
    expect((await installedPlugins())[ID]?.version).toBe("1.0.0");

    // Use: the command it registered from inside the sandbox reads the note, stores a setting and writes.
    await expect.poll(() => getPluginCommands().map((c) => c.id)).toContain(`plugin:${ID}:insert`);
    useAppStore.getState().setContent("שלום עולם and hello\n");
    getPluginCommands().find((c) => c.id === `plugin:${ID}:insert`)!.action();
    await expect.poll(() => useAppStore.getState().doc.content, { timeout: 5000 }).toContain("<!-- words: 4 -->");
    expect(JSON.parse(localStorage.getItem(`lumen.plugin.settings.${ID}`) ?? "{}")).toEqual({ runs: 1 });

    await uninstallPlugin(ID);
    expect(runningPlugins()).toEqual([]);
    expect(instance.alive).toBe(false);
    expect(getPluginCommands().filter((c) => c.id.startsWith(`plugin:${ID}:`))).toEqual([]);
    expect(localStorage.getItem(`lumen.plugin.settings.${ID}`)).toBeNull();
    expect(await installedPlugins()).toEqual({});
  });
});

describe("a registry with one changed byte is refused", () => {
  it("index.json: a flipped byte anywhere fails the signature, and no plugin code is downloaded or run", async () => {
    const { files } = sampleRegistry();
    sign(files, key.privateKeyPem);
    const index = files.get(`${BASE}/index.json`)!;
    const positions = [0, 1, Math.floor(index.length / 3), Math.floor(index.length / 2), index.length - 70, index.length - 2, index.length - 1];
    for (const at of positions) {
      const bad = new Map(files);
      bad.set(`${BASE}/index.json`, flip(index, at));
      const srv = server(bad);
      expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: srv.fetch, createWorker: fakePluginWorker })), `byte ${at}`).toBe("registry-signature");
      expect(srv.hits.some((u) => u.endsWith("main.js"))).toBe(false);
    }
    expect(runningPlugins()).toEqual([]);
    expect(await installedPlugins()).toEqual({});
  });

  it("the code: one changed byte fails its SHA-256 and nothing runs", async () => {
    const { files } = sampleRegistry();
    sign(files, key.privateKeyPem);
    files.set(`${BASE}/word-stamp/main.js`, flip(files.get(`${BASE}/word-stamp/main.js`)!, 200));
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("sha256-code");
    expect(runningPlugins()).toEqual([]);
  });

  it("the manifest (its permissions): one changed byte fails its SHA-256", async () => {
    const { files } = sampleRegistry();
    sign(files, key.privateKeyPem);
    files.set(`${BASE}/word-stamp/lumen-plugin.json`, flip(files.get(`${BASE}/word-stamp/lumen-plugin.json`)!, 40));
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("sha256-manifest");
    expect(runningPlugins()).toEqual([]);
  });

  it("the signature: one changed byte fails", async () => {
    const { files } = sampleRegistry();
    sign(files, key.privateKeyPem);
    const sig = JSON.parse(new TextDecoder().decode(files.get(`${BASE}/index.json.sig`)!)) as { signature: string };
    const raw = Uint8Array.from(atob(sig.signature), (c) => c.charCodeAt(0));
    raw[10] ^= 0x01;
    files.set(`${BASE}/index.json.sig`, enc.encode(JSON.stringify({ ...sig, signature: btoa(String.fromCharCode(...raw)) })));
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("registry-signature");
  });
});

describe("who may sign", () => {
  it("an unsigned registry is refused", async () => {
    const { files } = sampleRegistry();
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("registry-unsigned");
  });

  it("a valid signature by a key the app does not trust is refused, even with the key written in the .sig file", async () => {
    const { files } = sampleRegistry();
    const stranger = generateSigningKey();
    sign(files, stranger.privateKeyPem);
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("registry-untrusted-signer");
    expect(runningPlugins()).toEqual([]);
  });

  it("the owner tooling's own check agrees: one changed byte is a bad signature", () => {
    const { indexText } = sampleRegistry();
    const bytes = enc.encode(indexText);
    const sig = signRegistryBytes(bytes, key.privateKeyPem);
    expect(verifyRegistryBytes(bytes, sig, key.spkiBase64)).toBe("ok");
    expect(verifyRegistryBytes(flip(bytes, 5), sig, key.spkiBase64)).toBe("bad-signature");
    expect(verifyRegistryBytes(bytes, sig, generateSigningKey().spkiBase64)).toBe("wrong-key");
  });
});

describe("W11.S14: a version taken down after a failed review", () => {
  /** The sample registry with its one version marked delisted (as review-plugins.mjs --takedown writes it), signed. */
  const delisted = () => {
    const { files, indexText } = sampleRegistry();
    const index = JSON.parse(indexText);
    index.plugins[0].versions[0].delisted = { at: "2026-11-16T10:00:00.000Z", rules: ["eval"] };
    files.set(`${BASE}/index.json`, enc.encode(JSON.stringify(index, null, 2) + "\n"));
    sign(files, key.privateKeyPem);
    return files;
  };

  it("is never installed, latest or by its version, and no code is downloaded", async () => {
    for (const version of [undefined, "1.0.0"]) {
      const srv = server(delisted());
      expect(await refusal(installFromRegistry(BASE, ID, version, { fetch: srv.fetch, createWorker: fakePluginWorker }))).toBe("delisted");
      expect(srv.hits).toEqual([`${BASE}/index.json`, `${BASE}/index.json.sig`]);
    }
    expect(runningPlugins()).toEqual([]);
    expect(await installedPlugins()).toEqual({});
  });

  it("a takedown without its date and rules is a malformed registry", async () => {
    const { files, indexText } = sampleRegistry();
    const index = JSON.parse(indexText);
    index.plugins[0].versions[0].delisted = true;
    files.set(`${BASE}/index.json`, enc.encode(JSON.stringify(index)));
    sign(files, key.privateKeyPem);
    expect(await refusal(installFromRegistry(BASE, ID, undefined, { fetch: server(files).fetch, createWorker: fakePluginWorker }))).toBe("registry-format");
  });
});
