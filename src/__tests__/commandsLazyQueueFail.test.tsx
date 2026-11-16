/**
 * Review 10 M1: a command asked for by id whose chunk then fails to load is
 * dropped. It must not run later, by surprise, when another caller's load of
 * the chunk succeeds (here: the idle load useCommands starts).
 *
 * This file must not import helpers/commandSections.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";
import { commandSections } from "../commands/sectionsLoader";
import { runCommandById, useCommandEvents } from "../hooks/useCommandEvents";
import { useAppStore } from "../store/useStore";

// The first loadCommandSections() call (the one useCommandEvents makes) fails,
// as a chunk does offline after an update; every other path is the real loader.
vi.mock("../commands/sectionsLoader", async () => {
  const actual = await vi.importActual<typeof import("../commands/sectionsLoader")>("../commands/sectionsLoader");
  let failed = false;
  return {
    ...actual,
    loadCommandSections: () => {
      if (failed) return actual.loadCommandSections();
      failed = true;
      return Promise.reject(new Error("chunk failed to load"));
    },
  };
});

function options(): UseCommandsOptions {
  const fn = () => {};
  return {
    handleNew: fn, handleOpen: fn, handleSave: fn, handleExportHtml: fn, handleSaveToWorkspace: fn, insertSnippet: fn,
    recents: [], setRecents: fn, handleReopenRecent: fn, collab: null, handleStartCollab: fn, handleStopCollab: fn,
    setSearchOpen: fn, setFindReplaceOpen: fn, setGraphOpen: fn, setHistoryOpen: fn, setTableEditorOpen: fn,
    setCanvasOpen: fn, setGalleryOpen: fn,
  };
}

// Evaluated up front without calling the loader (its first import is slow under the offline shim).
beforeAll(async () => {
  await import("../commands/domains");
});

describe("a command whose chunk failed to load", () => {
  it("does not run when a later load succeeds", async () => {
    useAppStore.getState().setMode("preview");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => {
      const list = useCommands(options());
      useCommandEvents(list);
      return list;
    });
    expect(commandSections()).toBeNull();
    runCommandById("view.source");
    // The idle load succeeds and the list is rebuilt with the domains.
    await waitFor(() => expect(result.current.some((c) => c.id === "view.source")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(useAppStore.getState().mode).toBe("preview");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
