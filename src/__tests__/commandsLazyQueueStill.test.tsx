/**
 * Review 11, L5 (#1070): a command that waits for the palette's domains keeps
 * waiting across a list that is rebuilt but still without them (the
 * `else if (!complete) still.push(id)` branch), and runs once a complete
 * list has it.
 *
 * This file must not import helpers/commandSections.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";
import { runCommandById, useCommandEvents } from "../hooks/useCommandEvents";
import { useAppStore } from "../store/useStore";
import type { Command } from "../ui/CommandPalette";

function options(): UseCommandsOptions {
  const fn = () => {};
  return {
    handleNew: fn, handleOpen: fn, handleSave: fn, handleExportHtml: fn, handleSaveToWorkspace: fn, insertSnippet: fn,
    recents: [], setRecents: fn, handleReopenRecent: fn, collab: null, handleStartCollab: fn, handleStopCollab: fn,
    setSearchOpen: fn, setFindReplaceOpen: fn, setGraphOpen: fn, setHistoryOpen: fn, setTableEditorOpen: fn,
    setCanvasOpen: fn, setGalleryOpen: fn,
  };
}

// As in commandsLazyQueue.test.tsx: the domains' module is evaluated up front (slow under the offline shim).
beforeAll(async () => {
  await import("../commands/domains");
});

const other: Command[] = [{ id: "x.other", label: "Other", action: () => {} } as unknown as Command];

describe("a waiting command across lists still without the domains (review 11, L5)", () => {
  it("keeps waiting through an incomplete rebuild, then runs from the complete list", async () => {
    useAppStore.getState().setMode("preview");
    const { rerender } = renderHook(({ list }: { list: "none" | "other" | "all" }) => {
      const all = useCommands(options());
      useCommandEvents(list === "all" ? all : list === "other" ? [...other] : []);
    }, { initialProps: { list: "none" as "none" | "other" | "all" } });
    runCommandById("view.source");
    // A new list, still built without the domains: the command is not there and must stay queued.
    rerender({ list: "other" });
    rerender({ list: "other" });
    expect(useAppStore.getState().mode).toBe("preview");
    rerender({ list: "all" });
    await waitFor(() => expect(useAppStore.getState().mode).toBe("source"));
  });
});
