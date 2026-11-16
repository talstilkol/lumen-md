/**
 * Plan W10.C15 (audit W1.6): backups to a WebDAV server from the panel.
 * `targetFor` builds `providerTarget` over the sync's WebDAV provider (the
 * password from the secret store), and the panel saves such a target. The
 * server is the in-memory WebDAV fake the sync tests use.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryBackend } from "../storage/vault/memory";
import { listBackups, restore, runBackup } from "../backup/backup";
import { targetFor } from "../backup/start";
import { WEBDAV_BACKUP_PASSWORD, loadBackupConfig, saveBackupConfig, type BackupConfig } from "../backup/config";
import { openBackupPanel } from "../backup/BackupPanel";
import { getSecret, setSecret, __resetSecretStore } from "../lib/secretStore";
import { fakeFetch } from "./helpers/fakeServers/http";
import { fakeWebdav } from "./helpers/fakeServers/webdav";
import { setAiPolicy } from "../ai/policy";
import { __resetLedger, ledgerEntries } from "../ai/privacyLedger";

const URL_ = "https://dav.example/remote.php/dav/files/tal/Backups/";
const DAY = 86_400_000;

beforeEach(() => {
  localStorage.clear();
  __resetSecretStore();
  __resetLedger();
  document.body.innerHTML = "";
  // A plain WebDAV backup is refused under local-only (R8-M2), the default without a cloud key.
  setAiPolicy("local-first");
});
afterEach(() => __resetSecretStore());

describe("C15: a WebDAV server as the backup target", () => {
  it("back up, rotate and restore through targetFor (providerTarget over WebDAV)", async () => {
    // The fake serves one collection: the lumen-backups/ folder the target is rooted at.
    const server = fakeWebdav({ baseUrl: `${URL_}lumen-backups/`, username: "tal", password: "pw" });
    const f = fakeFetch(server.handle);
    await setSecret(WEBDAV_BACKUP_PASSWORD, "pw");
    const config: BackupConfig = { kind: "webdav", url: URL_, username: "tal", label: "dav.example", mode: { kind: "plain" } };
    const target = await targetFor(config, { fetch: f, probe: true });
    const vault = createMemoryBackend();
    await vault.write("notes/שלום.md", "עברית");
    // 40 daily backups: rotation keeps a bounded set, and the newest is always there.
    const t0 = Date.UTC(2026, 0, 1, 12);
    let last = "";
    for (let d = 0; d < 40; d++) last = (await runBackup({ vault, target, mode: { kind: "plain" }, now: () => t0 + d * DAY })).name;
    const kept = await listBackups(target);
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(40);
    expect(kept[0]!.name).toBe(last);
    const into = createMemoryBackend();
    const r = await restore({ target, name: last, into, select: { all: true } });
    expect(r.restored).toEqual(["notes/שלום.md"]);
    expect(await (await into.read("notes/שלום.md")).text()).toBe("עברית");
  });

  it("R8-M2: each plain upload is in the privacy ledger, and local-only refuses it before sending; encrypted is not listed", async () => {
    const server = fakeWebdav({ baseUrl: `${URL_}lumen-backups/`, username: "tal", password: "pw" });
    let puts = 0;
    const f = fakeFetch((req) => ((puts += req.method === "PUT" ? 1 : 0), server.handle(req)));
    await setSecret(WEBDAV_BACKUP_PASSWORD, "pw");
    const vault = createMemoryBackend();
    await vault.write("a.md", "x");
    const plain: BackupConfig = { kind: "webdav", url: URL_, username: "tal", label: "dav.example", mode: { kind: "plain" } };
    const r = await runBackup({ vault, target: await targetFor(plain, { fetch: f, probe: true }), mode: { kind: "plain" } });
    const listed = ledgerEntries().filter((e) => e.reason.startsWith("Plain backup to your WebDAV server"));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ host: "dav.example", category: "third-party", decision: "allowed", method: "PUT" });
    expect(listed[0]!.bytesOut).toBeGreaterThan(0);
    expect(r.name).toBeTruthy();
    // Under local-only: refused, recorded as blocked, nothing sent.
    setAiPolicy("local-only");
    const before = puts;
    await expect(runBackup({ vault, target: await targetFor(plain, { fetch: f }), mode: { kind: "plain" } })).rejects.toThrow(/local-only|refused/i);
    expect(puts).toBe(before);
    expect(ledgerEntries().filter((e) => e.reason.startsWith("Plain backup") && e.decision === "blocked")).toHaveLength(1);
    // An encrypted target is ciphertext: not wrapped, not listed.
    const age: BackupConfig = { ...plain, mode: { kind: "age", recipient: "age1x" } };
    const t = await targetFor(age, { fetch: f });
    await t.write("lumen-2026-01-01T000000Z.zip.age", new Uint8Array([1, 2, 3]));
    expect(ledgerEntries().filter((e) => e.reason.startsWith("Plain backup"))).toHaveLength(2);
  });

  it("without the password on this device, the target says so (no request without credentials)", async () => {
    const config: BackupConfig = { kind: "webdav", url: URL_, username: "tal", label: "dav.example", mode: { kind: "plain" } };
    await expect(targetFor(config, { fetch: (() => Promise.reject(new Error("sent"))) as never })).rejects.toThrow(/password/i);
  });
});

describe("C15: the panel", () => {
  it("saves a WebDAV target with the password in the secret store, not in the backup settings", async () => {
    openBackupPanel();
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    fireEvent.change(screen.getByTestId("backup-webdav-url"), { target: { value: "http://dav.example/x/" } });
    fireEvent.change(screen.getByTestId("backup-webdav-user"), { target: { value: "tal" } });
    fireEvent.change(screen.getByTestId("backup-webdav-password"), { target: { value: "pw-123" } });
    await act(async () => fireEvent.click(screen.getByTestId("backup-webdav-plain")));
    expect(await loadBackupConfig()).toBeNull(); // http refused
    // The real WebDAV round (the fake server as the page's fetch): the probe creates the folder, then the setting is saved.
    const realFetch = globalThis.fetch;
    const server = fakeWebdav({ baseUrl: `${URL_}lumen-backups/`, username: "tal", password: "pw-123" });
    globalThis.fetch = fakeFetch(server.handle) as typeof fetch;
    try {
      fireEvent.change(screen.getByTestId("backup-webdav-url"), { target: { value: URL_ } });
      await act(async () => fireEvent.click(screen.getByTestId("backup-webdav-plain")));
      await act(async () => new Promise((r) => setTimeout(r, 50)));
    } finally {
      globalThis.fetch = realFetch;
    }
    const c = await loadBackupConfig();
    expect(c).toMatchObject({ kind: "webdav", url: URL_, username: "tal", label: "dav.example", mode: { kind: "plain" } });
    expect(JSON.stringify(c)).not.toContain("pw-123");
    expect(getSecret(WEBDAV_BACKUP_PASSWORD)).toBe("pw-123");
  });

  it("R8-M2: encrypted is the first choice, plain carries a warning and is refused under local-only", async () => {
    setAiPolicy("local-only");
    await saveBackupConfig(null);
    openBackupPanel();
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const age = screen.getByTestId("backup-webdav-age");
    const plain = screen.getByTestId("backup-webdav-plain");
    expect(age.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain.getAttribute("aria-describedby")).toBe("backup-webdav-plain-warning");
    expect(screen.getByTestId("backup-webdav-plain-warning").textContent).toMatch(/not encrypted/i);
    fireEvent.change(screen.getByTestId("backup-webdav-url"), { target: { value: URL_ } });
    fireEvent.change(screen.getByTestId("backup-webdav-user"), { target: { value: "tal" } });
    fireEvent.change(screen.getByTestId("backup-webdav-password"), { target: { value: "pw-123" } });
    await act(async () => fireEvent.click(plain));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(await loadBackupConfig()).toBeNull();
    expect(getSecret(WEBDAV_BACKUP_PASSWORD)).toBeNull();
    expect(document.body.textContent).toMatch(/refused under the local-only/);
  });
});
