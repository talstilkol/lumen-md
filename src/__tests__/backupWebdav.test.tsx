/**
 * Plan W10.C15 (audit W1.6): backups to a WebDAV server from the panel.
 * `targetFor` builds `providerTarget` over the sync's WebDAV provider (the
 * password from the secret store), and the panel saves such a target. The
 * server is the in-memory WebDAV fake the sync tests use.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { createMemoryBackend } from "../storage/vault/memory";
import { listBackups, restore, runBackup } from "../backup/backup";
import { targetFor } from "../backup/start";
import { WEBDAV_BACKUP_PASSWORD, loadBackupConfig, type BackupConfig } from "../backup/config";
import { openBackupPanel } from "../backup/BackupPanel";
import { getSecret, setSecret, __resetSecretStore } from "../lib/secretStore";
import { fakeFetch } from "./helpers/fakeServers/http";
import { fakeWebdav } from "./helpers/fakeServers/webdav";

const URL_ = "https://dav.example/remote.php/dav/files/tal/Backups/";
const DAY = 86_400_000;

beforeEach(() => {
  localStorage.clear();
  __resetSecretStore();
  document.body.innerHTML = "";
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
});
