/**
 * Plan 0.2: a command run by id (`lumen-run-command`: the native menu, the
 * empty state, voice, the suggestions panel) before the palette's domains
 * have loaded is kept and runs once the rebuilt list has it.
 *
 * This file must not import helpers/commandSections.
 *
 * Review 10 M1: the second case asks while the hook still has a list built
 * without the domains, after the loader already has them (the chunk arrived,
 * the list is not rebuilt yet). The command must wait for the list, not be
 * dropped because the loader is done.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";
import { commandSections } from "../commands/sectionsLoader";
import { runCommandById, useCommandEvents } from "../hooks/useCommandEvents";
import { useAppStore } from "../store/useStore";

function options(): UseCommandsOptions {
  const fn = () => {};
  return {
    handleNew: fn, handleOpen: fn, handleSave: fn, handleExportHtml: fn, handleSaveToWorkspace: fn, insertSnippet: fn,
    recents: [], setRecents: fn, handleReopenRecent: fn, collab: null, handleStartCollab: fn, handleStopCollab: fn,
    setSearchOpen: fn, setFindReplaceOpen: fn, setGraphOpen: fn, setHistoryOpen: fn, setTableEditorOpen: fn,
    setCanvasOpen: fn, setGalleryOpen: fn,
  };
}

// The domains' module is evaluated up front (the loader is not called, so
// commandSections() stays null): its first import takes seconds under the
// offline shim, longer than waitFor's 1 s, which is not what this file tests.
beforeAll(async () => {
  await import("../commands/domains");
});

describe("a command asked for before the domains load (plan 0.2)", () => {
  it("runs once they arrive", async () => {
    useAppStore.getState().setMode("preview");
    renderHook(() => useCommandEvents(useCommands(options())));
    expect(commandSections()).toBeNull();
    runCommandById("view.source");
    await waitFor(() => expect(useAppStore.getState().mode).toBe("source"));
  });

  it("waits for the list, not the loader (review 10 M1)", async () => {
    useAppStore.getState().setMode("preview");
    expect(commandSections()).not.toBeNull();
    // A list the hook was given before it was rebuilt with the domains.
    const { rerender } = renderHook(({ stale }: { stale: boolean }) => {
      const all = useCommands(options());
      useCommandEvents(stale ? [] : all);
    }, { initialProps: { stale: true } });
    runCommandById("view.source");
    expect(useAppStore.getState().mode).toBe("preview");
    rerender({ stale: false });
    await waitFor(() => expect(useAppStore.getState().mode).toBe("source"));
  });
});
