/**
 * Tests for the reactive sync-status indicator module.
 */

import { describe, it, expect, vi } from "vitest";
import {
  setSyncStatus,
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from "../sync/syncStatus";

describe("syncStatus", () => {
  it("defaults to idle with no provider", () => {
    const state = getSyncStatus();
    expect(state.status).toBe("idle");
    expect(state.provider).toBeNull();
  });

  it("setSyncStatus updates getSyncStatus", () => {
    setSyncStatus("syncing", "dropbox");
    const state = getSyncStatus();
    expect(state.status).toBe("syncing");
    expect(state.provider).toBe("dropbox");
    expect(state.detail).toBeUndefined();

    // reset for other tests
    setSyncStatus("idle", null);
  });

  it("subscriber receives current state immediately on subscribe", () => {
    setSyncStatus("error", "gdrive", "connection refused");
    const cb = vi.fn();
    subscribeSyncStatus(cb);
    expect(cb).toHaveBeenCalledWith("error", "gdrive", "connection refused");

    // reset
    setSyncStatus("idle", null);
  });

  it("subscriber is notified on every status change", () => {
    const cb = vi.fn();
    const unsub = subscribeSyncStatus(cb);

    setSyncStatus("syncing", "gist", "uploading…");
    expect(cb).toHaveBeenLastCalledWith("syncing", "gist", "uploading…");

    setSyncStatus("idle", null);
    expect(cb).toHaveBeenLastCalledWith("idle", null, undefined);

    unsub();
  });

  it("unsubscribe stops notifications", () => {
    const cb = vi.fn();
    const unsub = subscribeSyncStatus(cb);
    unsub();

    setSyncStatus("offline", "icloud", "no network");
    // callback should NOT have been called again
    expect(cb).toHaveBeenCalledTimes(1); // only the initial emission
  });

  it("supports all status variants", () => {
    const variants: SyncStatus[] = ["idle", "syncing", "error", "offline"];
    for (const status of variants) {
      setSyncStatus(status, null);
      expect(getSyncStatus().status).toBe(status);
    }
  });
});
