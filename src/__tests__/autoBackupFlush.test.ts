/**
 * Auto-backup must not lose the last edit when the tab goes away: the
 * 30 s timer is still waiting on it, and a closed tab never fires timers.
 * `pagehide` (and a hidden page) write it immediately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const writes = vi.hoisted(() => [] as Array<{ path: string; content: string }>);
vi.mock("../storage/workspace", () => ({
  writeWorkspaceFile: vi.fn(async (path: string, content: string) => {
    writes.push({ path, content });
  }),
}));
vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { startAutoBackup, flushNow } from "../sync/autoBackup";
import { useAppStore } from "../store/useStore";

const teardown = () => (startAutoBackup as unknown as { _teardown?: () => void })._teardown?.();

describe("auto-backup flush on pagehide", () => {
  beforeEach(() => {
    writes.length = 0;
    vi.useFakeTimers();
    useAppStore.getState().setDoc({ name: "Notes.md", content: "", workspaceName: null, dirty: false });
    startAutoBackup();
  });
  afterEach(() => {
    teardown();
    vi.useRealTimers();
  });

  it("writes the edit the timer is still waiting on", async () => {
    useAppStore.getState().setContent("# first draft");
    expect(writes).toHaveLength(0);
    window.dispatchEvent(new Event("pagehide"));
    await vi.runAllTimersAsync();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toMatch(/^backups\/Notes\.md\/\d+\.md$/);
    expect(writes[0].content).toBe("# first draft");
  });

  it("writes when the page is hidden (backgrounded phone)", async () => {
    useAppStore.getState().setContent("# on the phone");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(writes.map((w) => w.content)).toEqual(["# on the phone"]);
  });

  it("does not write twice: the flushed edit is not snapshotted again by the timer", async () => {
    useAppStore.getState().setContent("# once");
    await flushNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toHaveLength(1);
  });

  it("has nothing to write when there was no edit", async () => {
    await flushNow();
    expect(writes).toHaveLength(0);
  });
});
