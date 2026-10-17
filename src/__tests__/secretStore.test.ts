/** T36 — secrets are encrypted at rest, migrated from plaintext, keychain on desktop. */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStore, get, set, keys } from "idb-keyval";
import {
  __resetSecretStore,
  flushSecrets,
  getSecret,
  initSecretStore,
  isSecretName,
  secretStoreMode,
  setSecret,
} from "../lib/secretStore";

const tauriStore = new Map<string, string>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { name?: string; value?: string | null }) => {
    if (cmd === "secret_available") return true;
    if (cmd === "secret_get") return tauriStore.get(args!.name!) ?? null;
    if (cmd === "secret_set") {
      if (args!.value == null) tauriStore.delete(args!.name!);
      else tauriStore.set(args!.name!, args!.value);
      return null;
    }
    throw new Error(cmd);
  },
}));

async function freshDb() {
  __resetSecretStore();
  localStorage.clear();
  const db = createStore("lumen-secrets", "kv");
  for (const k of await keys(db)) await (await import("idb-keyval")).del(k, db);
}

describe("secretStore", () => {
  beforeEach(async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    tauriStore.clear();
    await freshDb();
  });

  it("knows which names are secrets", () => {
    expect(isSecretName("lumen.ai.key.anthropic")).toBe(true);
    expect(isSecretName("lumen.cloud.dropbox.refresh")).toBe(true);
    expect(isSecretName("lumen.ai.policy")).toBe(false);
  });

  it("moves plaintext keys out of localStorage and the legacy git token out of IndexedDB", async () => {
    localStorage.setItem("lumen.ai.key.anthropic", "sk-ant-123");
    localStorage.setItem("lumen.cloud.github.token", "ghp_abc");
    localStorage.setItem("lumen.ai.policy", "local-first");
    await set("lumen.git.token.v1", "ghp_git");
    await initSecretStore();
    expect(secretStoreMode()).toBe("encrypted");
    expect(getSecret("lumen.ai.key.anthropic")).toBe("sk-ant-123");
    expect(getSecret("lumen.git.token.v1")).toBe("ghp_git");
    expect(localStorage.getItem("lumen.ai.key.anthropic")).toBeNull();
    expect(localStorage.getItem("lumen.cloud.github.token")).toBeNull();
    expect(localStorage.getItem("lumen.ai.policy")).toBe("local-first");
    expect(await get("lumen.git.token.v1")).toBeUndefined();
  });

  it("stores ciphertext only, and a reload decrypts it again", async () => {
    await initSecretStore();
    setSecret("lumen.ai.key.gemini", "AIza-secret-value");
    await flushSecrets();
    const db = createStore("lumen-secrets", "kv");
    const raw = await get("lumen.ai.key.gemini", db);
    expect(JSON.stringify(raw)).not.toContain("AIza");
    expect(new TextDecoder().decode((raw as { data: ArrayBuffer }).data)).not.toContain("AIza");
    const key = (await get("__key__", db)) as CryptoKey;
    expect(key.extractable).toBe(false);

    __resetSecretStore();
    await initSecretStore();
    expect(getSecret("lumen.ai.key.gemini")).toBe("AIza-secret-value");
    setSecret("lumen.ai.key.gemini", null);
    await flushSecrets();
    expect(await get("lumen.ai.key.gemini", db)).toBeUndefined();
  });

  it("uses the OS keychain in the desktop app; only names stay in localStorage", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    localStorage.setItem("lumen.collab.password", "room-pass");
    await initSecretStore();
    expect(secretStoreMode()).toBe("keychain");
    expect(tauriStore.get("lumen.collab.password")).toBe("room-pass");
    expect(localStorage.getItem("lumen.collab.password")).toBeNull();
    setSecret("lumen.ai.key.mistral", "mk-1");
    await flushSecrets();
    expect(tauriStore.get("lumen.ai.key.mistral")).toBe("mk-1");
    expect(JSON.parse(localStorage.getItem("lumen.secrets.index")!)).toEqual(expect.arrayContaining(["lumen.ai.key.mistral"]));
    expect(localStorage.getItem("lumen.secrets.index")).not.toContain("mk-1");

    __resetSecretStore();
    await initSecretStore();
    expect(getSecret("lumen.ai.key.mistral")).toBe("mk-1");
  });
});
