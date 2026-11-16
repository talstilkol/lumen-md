/**
 * Review 11, M5 (#1061): a takedown reaches copies already installed, and an
 * old signed index cannot be replayed to bring a version back.
 *
 * - disableDelisted (run at startup, from main.tsx): for each registry an
 *   installed plugin came from, the signed index is loaded; a version it now
 *   lists as delisted is stopped and its record marked disabled.
 * - The index's `serial`: the app keeps the highest it has seen per registry
 *   and refuses an older one ("registry-rollback"), and one without a serial
 *   once a serial was seen. Signing an index with a serial is the owner's step.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { del as idbDel, set as idbSet } from "idb-keyval";
// @ts-expect-error — a plain .mjs module of the build scripts
import { generateSigningKey, signRegistryBytes } from "../../scripts/lib/plugin-registry-sign.mjs";
import { delistedInstalls, disableDelisted, installedPlugins, InstallRefused, loadSignedRegistry, serialVerdict, type InstalledRecord, type RegistryIndex } from "../plugins/install";
import { trustKey, untrustKey } from "../plugins/signing";
import { __resetLedger } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";

const BASE = "https://plugins.example.org/registry";
const ID = "sample.word-stamp";
const enc = new TextEncoder();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const V = { version: "1.0.0", path: "word-stamp", sha256: sha("code"), manifestSha256: sha("manifest") };

let key: ReturnType<typeof generateSigningKey>;
beforeEach(async () => {
  localStorage.clear();
  __resetLedger();
  setAiPolicy("local-first");
  key = generateSigningKey();
  await trustKey(key.fingerprint, key.spkiBase64);
  await idbDel("lumen.plugins.installed");
  await idbDel("lumen.plugins.registrySerial");
});
afterEach(async () => {
  await untrustKey(key.fingerprint);
});

/** A signed registry host serving one index; counts requests. */
function host(index: Record<string, unknown>) {
  const text = JSON.stringify(index, null, 2) + "\n";
  const files = new Map<string, Uint8Array>([
    [`${BASE}/index.json`, enc.encode(text)],
    [`${BASE}/index.json.sig`, enc.encode(JSON.stringify(signRegistryBytes(enc.encode(text), key.privateKeyPem)))],
  ]);
  const hits: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hits.push(url);
    const body = files.get(url);
    return body ? new Response(body.slice(), { status: 200 }) : new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, hits };
}

const record = (over: Partial<InstalledRecord> = {}): InstalledRecord => ({ id: ID, version: "1.0.0", registry: BASE, sha256: V.sha256, manifestSha256: V.manifestSha256, grants: [], installedAt: 1, ...over });
const listed = (serial?: number) => ({ ...(serial ? { serial } : {}), plugins: [{ id: ID, name: "s", versions: [V] }] });
const down = (serial?: number) => ({ ...(serial ? { serial } : {}), plugins: [{ id: ID, name: "s", versions: [{ ...V, delisted: { at: "2026-11-16T10:00:00.000Z", rules: ["eval"] } }] }] });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof InstallRefused) return e.reason;
    throw e;
  }
  return "ok";
}

describe("a takedown reaches installed copies (review 11, M5)", () => {
  it("delistedInstalls: the installed versions the index took down, from that registry, not yet disabled", () => {
    const idx = down() as RegistryIndex;
    expect(delistedInstalls(idx, { [ID]: record() }, BASE).map((d) => d.record.id)).toEqual([ID]);
    expect(delistedInstalls(idx, { [ID]: record({ registry: "https://other.example/r" }) }, BASE)).toEqual([]);
    expect(delistedInstalls(idx, { [ID]: record({ version: "0.9.0" }) }, BASE)).toEqual([]);
    expect(delistedInstalls(idx, { [ID]: record({ disabled: { at: 1, reason: "delisted", rules: [] } }) }, BASE)).toEqual([]);
    expect(delistedInstalls(listed() as RegistryIndex, { [ID]: record() }, BASE)).toEqual([]);
  });

  it("at startup: an installed version that is now delisted is stopped and disabled; its data is kept", async () => {
    await idbSet("lumen.plugins.installed", { [ID]: record() });
    const srv = host(down(2));
    const stopped: string[] = [];
    expect(await disableDelisted({ fetch: srv.fetch, stop: async (id) => void stopped.push(id), now: 42 })).toEqual([ID]);
    expect(stopped).toEqual([ID]);
    expect((await installedPlugins())[ID].disabled).toEqual({ at: 42, reason: "delisted", rules: ["eval"] });
    // Only the signed index is read; once disabled, a second start does nothing more.
    expect(srv.hits).toEqual([`${BASE}/index.json`, `${BASE}/index.json.sig`]);
    expect(await disableDelisted({ fetch: srv.fetch, stop: async () => undefined })).toEqual([]);
  });

  it("a version still listed stays as it is, and nothing installed means nothing downloaded", async () => {
    const srv = host(listed(1));
    expect(await disableDelisted({ fetch: srv.fetch, stop: async () => undefined })).toEqual([]);
    expect(srv.hits).toEqual([]);
    await idbSet("lumen.plugins.installed", { [ID]: record() });
    expect(await disableDelisted({ fetch: srv.fetch, stop: async () => undefined })).toEqual([]);
    expect((await installedPlugins())[ID].disabled).toBeUndefined();
  });

  it("main.tsx runs it at startup, off the first render", () => {
    const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    expect(main).toMatch(/import\("\.\/plugins\/install"\)\.then\(\(m\) => m\.disableDelisted\(\)\)/);
  });
});

describe("the index serial refuses a replayed older index (review 11, M5)", () => {
  it("serialVerdict", () => {
    expect(serialVerdict(undefined, undefined)).toBe("ok");
    expect(serialVerdict(undefined, 3)).toBe("ok");
    expect(serialVerdict(3, 3)).toBe("ok");
    expect(serialVerdict(3, 4)).toBe("ok");
    expect(serialVerdict(3, 2)).toBe("rollback");
    expect(serialVerdict(3, undefined)).toBe("rollback");
  });

  it("after serial 2 (the takedown), serial 1 and an index with no serial are refused; 2 and 3 load", async () => {
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(down(2)).fetch }))).toBe("ok");
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(listed(1)).fetch }))).toBe("registry-rollback");
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(listed()).fetch }))).toBe("registry-rollback");
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(down(2)).fetch }))).toBe("ok");
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(listed(3)).fetch }))).toBe("ok");
  });

  it("the replay cannot undo a takedown: the old index is refused before anything is read from it", async () => {
    await idbSet("lumen.plugins.installed", { [ID]: record() });
    await loadSignedRegistry(BASE, { fetch: host(down(2)).fetch });
    // The installed copy is checked against a replayed index with no takedown: refused, so not "still listed".
    expect(await refusal(loadSignedRegistry(BASE, { fetch: host(listed(1)).fetch }))).toBe("registry-rollback");
  });

  it("a serial that is not a positive integer is a malformed index", async () => {
    for (const serial of [0, -1, 1.5, "2"]) expect(await refusal(loadSignedRegistry(BASE, { fetch: host({ ...listed(), serial }).fetch }))).toBe("registry-format");
  });
});
