/**
 * Command-palette entries for the organization + trusted-keys panels.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";

function baseOptions(extra: Partial<UseCommandsOptions> = {}): UseCommandsOptions {
  const noop = () => {};
  return {
    handleNew: noop,
    handleOpen: noop,
    handleSave: noop,
    handleExportHtml: noop,
    handleSaveToWorkspace: noop,
    insertSnippet: noop,
    recents: [],
    setRecents: noop,
    handleReopenRecent: noop,
    collab: null,
    handleStartCollab: noop,
    handleStopCollab: noop,
    setSearchOpen: noop,
    setFindReplaceOpen: noop,
    setGraphOpen: noop,
    setHistoryOpen: noop,
    setTableEditorOpen: noop,
    setCanvasOpen: noop,
    setGalleryOpen: noop,
    ...extra,
  };
}

describe("settings commands", () => {
  it("are absent when the setters aren't wired", () => {
    const { result } = renderHook(() => useCommands(baseOptions()));
    const ids = result.current.map((c) => c.id);
    expect(ids).not.toContain("settings.organization");
    expect(ids).not.toContain("settings.trustedKeys");
  });

  it("open the organization and trusted-keys panels", () => {
    const setOrgSettingsOpen = vi.fn();
    const setTrustedKeysOpen = vi.fn();
    const { result } = renderHook(() => useCommands(baseOptions({ setOrgSettingsOpen, setTrustedKeysOpen })));
    const org = result.current.find((c) => c.id === "settings.organization");
    const keys = result.current.find((c) => c.id === "settings.trustedKeys");
    expect(org?.label).toBe("Organization settings…");
    expect(keys?.label).toBe("Trusted plugin signing keys…");
    org?.action();
    keys?.action();
    expect(setOrgSettingsOpen).toHaveBeenCalledWith(true);
    expect(setTrustedKeysOpen).toHaveBeenCalledWith(true);
  });
});
