/**
 * W10.C dead seams: `setSyncStatus` had no caller, and the status bar read a
 * constant "idle", so its sync indicator never showed. Now the sync session
 * reports every round (syncing → idle, or error / offline with the reason),
 * and the status bar shows it. Against the mock WebDAV server, as the sync
 * panel's tests do.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createSession } from "../sync/e2ee/ui/session";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { keepBothResolver } from "../sync/e2ee/conflict";
import { __setProviderStore, type ProviderSettings } from "../sync/e2ee/providers";
import { __resetSecretStore } from "../lib/secretStore";
import { getSyncStatus, setSyncStatus, subscribeSyncStatus, type SyncStatus } from "../sync/syncStatus";
import { StatusBar } from "../ui/StatusBar";
import { fakeFetch } from "./helpers/fakeServers/http";
import { fakeWebdav } from "./helpers/fakeServers/webdav";
import { PASSPHRASE, TEST_ITERATIONS } from "./helpers/e2ee";

const URL_ = "https://dav.example/remote.php/dav/files/tal/Lumen/";
const webdav: ProviderSettings = { kind: "webdav", url: URL_, username: "tal" };
const kv = new Map<string, unknown>();

beforeEach(() => {
  kv.clear();
  __setProviderStore({ get: async <T,>(k: string) => kv.get(k) as T | undefined, set: async (k, v) => void kv.set(k, v), del: async (k) => void kv.delete(k) });
  setSyncStatus("idle", null);
});
afterEach(() => {
  __setProviderStore(null);
  __resetSecretStore();
});

describe("the sync session reports to the status indicator", () => {
  it("syncing then idle for a round; error with the reason when a round fails; idle again after disconnect", async () => {
    const server = fakeWebdav({ baseUrl: URL_, username: "tal", password: "pw" });
    let down = false;
    const ok = fakeFetch(server.handle);
    const session = createSession({
      fetch: ((u: string, i?: RequestInit) => (down ? Promise.reject(new TypeError("Failed to fetch")) : ok(u, i))) as never,
      local: () => memoryFiles(),
      store: async () => memoryStateStore(),
      resolver: keepBothResolver,
      pbkdf2Iterations: TEST_ITERATIONS,
      kdfPolicy: { minPbkdf2Iterations: TEST_ITERATIONS },
      intervalMinutes: 0,
      background: false,
      treeBadges: false,
      watch: () => () => undefined,
    });
    const seen: SyncStatus[] = [];
    const off = subscribeSyncStatus((s) => seen.push(s));
    await session.connect(webdav, "pw");
    await session.open(PASSPHRASE);
    expect(seen.slice(1)).toEqual(["syncing", "idle"]);
    down = true;
    await expect(session.syncNow()).rejects.toThrow();
    expect(getSyncStatus().status).toBe("error");
    expect(getSyncStatus().detail).toBeTruthy();
    down = false;
    await session.disconnect();
    expect(getSyncStatus().status).toBe("idle");
    off();
  });
});

describe("the status bar shows the indicator", () => {
  it("nothing while idle; the state while syncing or after an error", async () => {
    render(<StatusBar text="" dirty={false} filename="a.md" />);
    expect(screen.queryByTitle(/^Sync:/)).toBeNull();
    await act(async () => setSyncStatus("syncing", null));
    expect(screen.getByTitle("Sync: syncing")).toBeTruthy();
    await act(async () => setSyncStatus("error", null, "HTTP 500"));
    expect(screen.getByTitle("Sync: error")).toBeTruthy();
    await act(async () => setSyncStatus("idle", null));
    expect(screen.queryByTitle(/^Sync:/)).toBeNull();
  });
});
