/**
 * Plan 0.2: a command run by id (`lumen-run-command`: the native menu, the
 * empty state, voice, the suggestions panel) before the palette's domains
 * have loaded is kept and runs once the rebuilt list has it.
 *
 * This file must not import helpers/commandSections.
 */
import { describe, it, expect } from "vitest";
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

describe("a command asked for before the domains load (plan 0.2)", () => {
  it("runs once they arrive", async () => {
    useAppStore.getState().setMode("preview");
    renderHook(() => useCommandEvents(useCommands(options())));
    expect(commandSections()).toBeNull();
    runCommandById("view.source");
    await waitFor(() => expect(useAppStore.getState().mode).toBe("source"));
  });
});
