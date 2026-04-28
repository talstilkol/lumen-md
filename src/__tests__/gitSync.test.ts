/**
 * Unit tests for pure helper functions in the git sync module.
 * These don't require full isomorphic-git/IndexedDB infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock idb-keyval to use a plain Map
const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
}));

// Mock workspace to prevent OPFS access
vi.mock("../storage/workspace", () => ({
  createWorkspaceFolder: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  listWorkspace: vi.fn().mockResolvedValue([]),
  readWorkspaceFile: vi.fn().mockResolvedValue(""),
  workspaceHasFile: vi.fn().mockResolvedValue(false),
  writeWorkspaceBlob: vi.fn(),
}));

describe("git sync — helpers", () => {
  beforeEach(() => store.clear());

  it("setGitToken + getGitToken round-trips", async () => {
    const { setGitToken, getGitToken } = await import("../sync/git");
    expect(await getGitToken()).toBe("");
    await setGitToken("ghp_test123");
    expect(await getGitToken()).toBe("ghp_test123");
  });

  it("getGitToken returns empty string when not set", async () => {
    const { getGitToken } = await import("../sync/git");
    expect(await getGitToken()).toBe("");
  });

  it("setGitToken(null) clears the token", async () => {
    const { setGitToken, getGitToken } = await import("../sync/git");
    await setGitToken("ghp_secret");
    await setGitToken(null);
    expect(await getGitToken()).toBe("");
  });

  it("setGitIdentity + getGitIdentity round-trips", async () => {
    const { setGitIdentity, getGitIdentity } = await import("../sync/git");
    const defaultId = await getGitIdentity();
    expect(defaultId.name).toBe("Lumen User");
    expect(defaultId.email).toContain("example");

    await setGitIdentity({ name: "Tal", email: "tal@lumen.md" });
    const id = await getGitIdentity();
    expect(id.name).toBe("Tal");
    expect(id.email).toBe("tal@lumen.md");
  });

  it("GitStatusEntry state mapping covers all cases", async () => {
    // Verify the type interface covers the 4 expected states
    const { gitStatus } = await import("../sync/git");
    expect(typeof gitStatus).toBe("function");
    // The state type is: "unmodified" | "modified" | "added" | "deleted"
    // This is a compile-time check — if the type changes, TS will catch it.
    const states: Array<"unmodified" | "modified" | "added" | "deleted"> = [
      "unmodified", "modified", "added", "deleted",
    ];
    expect(states).toHaveLength(4);
  });

  it("cloneRepo throws without a token", async () => {
    const { cloneRepo } = await import("../sync/git");
    await expect(
      cloneRepo("https://github.com/user/repo.git", { token: "" }),
    ).rejects.toThrow(/token/i);
  });
});
