/** "AI: Check Batch Jobs": terminal states and failed state saves are reported. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const toasts: Array<[string, string]> = [];
vi.mock("../ui/AiToast", () => ({ showAiToast: (m: string, kind: string) => toasts.push([m, kind]) }));
vi.mock("../ui/PromptDialog", () => ({ uiAlert: vi.fn(), uiConfirm: vi.fn(async () => true), uiPrompt: vi.fn(), uiSelect: vi.fn() }));
const writes: string[] = [];
vi.mock("../storage/workspace", async (orig) => ({
  ...(await orig<object>()),
  writeWorkspaceFile: vi.fn(async (p: string) => void writes.push(p)),
}));
vi.mock("../storage/workspaceNotes", () => ({ readAllNotes: vi.fn(async () => [{ path: "a.md", text: "Hello" }]) }));
const results = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../ai/batch", async (orig) => ({
  ...(await orig<object>()),
  fetchBatchResults: vi.fn(async () => results.value),
}));

import { useCommands, type UseCommandsOptions } from "../commands/useCommands";
import { loadJobs, saveJobs, textHash, type BatchJob } from "../ai/batch";

const noop = () => {};
const options = { handleNew: noop, handleOpen: noop, handleSave: noop, handleExportHtml: noop, handleSaveToWorkspace: noop, insertSnippet: noop, recents: [], setRecents: noop, handleReopenRecent: noop, collab: null, handleStartCollab: noop, handleStopCollab: noop, setSearchOpen: noop, setFindReplaceOpen: noop, setGraphOpen: noop, setHistoryOpen: noop, setTableEditorOpen: noop, setCanvasOpen: noop, setGalleryOpen: noop } as UseCommandsOptions;

const job = (): BatchJob => ({ id: "batch_7", provider: "openai", model: "m", op: "tags", createdAt: "", status: "submitted", items: [{ customId: "n0", path: "a.md", hash: textHash("Hello") }] });
const check = async () => {
  const { result } = renderHook(() => useCommands(options));
  await result.current.find((c) => c.id === "ai.batchCheck")!.action();
};

describe("AI: Check Batch Jobs", () => {
  beforeEach(() => {
    localStorage.clear();
    toasts.length = 0;
    writes.length = 0;
  });

  it("tells the user which job failed before dropping it from the pending list", async () => {
    saveJobs([job()]);
    results.value = { state: "expired", answers: new Map(), failed: 1 };
    await check();
    expect(toasts).toEqual([[expect.stringMatching(/"tags" \(batch_7\) expired/), "error"]]);
    expect(loadJobs()[0].status).toBe("expired");
  });

  it("reports a job state it couldn't save and writes nothing", async () => {
    saveJobs([job()]);
    results.value = { state: "ended", answers: new Map([["n0", '["roses"]']]), failed: 0 };
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      await check();
    } finally {
      spy.mockRestore();
    }
    expect(writes).toEqual([]);
    expect(toasts).toEqual([[expect.stringMatching(/batch_7.*storage full/), "error"]]);
  });

  it("applies the results and saves the job as applied", async () => {
    saveJobs([job()]);
    results.value = { state: "ended", answers: new Map([["n0", '["roses"]']]), failed: 0 };
    await check();
    expect(writes).toEqual(["a.md"]);
    expect(loadJobs()[0]).toMatchObject({ status: "applied", done: ["a.md"] });
    expect(toasts.at(-1)).toEqual(["Applied 1 batch results", "success"]);
  });
});
