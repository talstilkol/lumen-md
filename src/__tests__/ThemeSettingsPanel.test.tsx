/**
 * Render tests for the Theme settings panel + its palette command.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../storage/exportFormats", () => ({ downloadText: vi.fn() }));

import { ThemeSettings } from "../ui/ThemeSettings";
import { useAppStore } from "../store/useStore";
import { DEFAULT_THEME_SETTINGS } from "../lib/themeSettings";
import { downloadText } from "../storage/exportFormats";
import { useCommands, type UseCommandsOptions } from "../commands/useCommands";

function file(text: string): File {
  const f = new File([text], "theme.json", { type: "application/json" });
  // jsdom's File lacks .text() in some versions.
  if (typeof (f as { text?: unknown }).text !== "function") {
    Object.defineProperty(f, "text", { value: async () => text });
  }
  return f;
}

describe("ThemeSettings panel", () => {
  beforeEach(() => {
    useAppStore.getState().resetThemeSettings();
    vi.mocked(downloadText).mockClear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ThemeSettings open={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders presets, controls and a passing contrast report", () => {
    render(<ThemeSettings open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Theme" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Default", "Sepia", "Nord", "High contrast"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Font size")).toBeTruthy();
    expect(screen.getByLabelText("Line height")).toBeTruthy();
    expect(screen.getByLabelText("Content width")).toBeTruthy();
    expect(screen.getByTestId("theme-contrast").textContent).toContain("Text on background");
  });

  it("selecting a preset updates the store and <html> live", () => {
    render(<ThemeSettings open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /High contrast/ }));
    expect(useAppStore.getState().themeSettings.preset).toBe("highContrast");
    expect(document.documentElement.style.getPropertyValue("--bg")).not.toBe("");
    expect(screen.getByRole("radio", { name: /High contrast/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("sliders write typography variables", () => {
    render(<ThemeSettings open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Content width"), { target: { value: "100" } });
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--content-width")).toBe("100ch");
  });

  it("hex input only commits valid colours and flags invalid ones", () => {
    render(<ThemeSettings open onClose={() => {}} />);
    const hex = screen.getByLabelText("Accent color (hex)");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(useAppStore.getState().themeSettings.accent).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/hex color/);
    fireEvent.change(hex, { target: { value: "#ff8800" } });
    expect(useAppStore.getState().themeSettings.accent).toBe("#ff8800");
  });

  it("custom font requires a valid name", () => {
    render(<ThemeSettings open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Editor font"), { target: { value: "custom" } });
    const name = screen.getByLabelText("Font name");
    fireEvent.change(name, { target: { value: "Bad;Font" } });
    expect(useAppStore.getState().themeSettings.customFont).not.toBe("Bad;Font");
    fireEvent.change(name, { target: { value: "Fira Code" } });
    expect(useAppStore.getState().themeSettings.customFont).toBe("Fira Code");
    expect(document.documentElement.style.getPropertyValue("--editor-font")).toMatch(/^"Fira Code"/);
  });

  it("exports the current theme as JSON", () => {
    useAppStore.getState().setThemeSettings({ preset: "nord" });
    render(<ThemeSettings open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Export JSON"));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [name, body] = vi.mocked(downloadText).mock.calls[0];
    expect(name).toBe("lumen-theme.json");
    expect(JSON.parse(body)).toMatchObject({ lumenTheme: 1, preset: "nord" });
  });

  it("imports a valid file and rejects an invalid one with a message", async () => {
    render(<ThemeSettings open onClose={() => {}} />);
    const input = screen.getByTestId("theme-import-input");
    fireEvent.change(input, { target: { files: [file('{"lumenTheme":1,"evil":true}')] } });
    await waitFor(() => expect(screen.getByTestId("theme-import-error").textContent).toMatch(/evil/));
    expect(useAppStore.getState().themeSettings).toEqual(DEFAULT_THEME_SETTINGS);

    fireEvent.change(input, { target: { files: [file('{"lumenTheme":1,"preset":"sepia","fontSize":16}')] } });
    await waitFor(() => expect(useAppStore.getState().themeSettings.preset).toBe("sepia"));
    expect(useAppStore.getState().themeSettings.fontSize).toBe(16);
  });

  it("reset restores defaults", () => {
    useAppStore.getState().setThemeSettings({ preset: "sepia", fontSize: 20 });
    render(<ThemeSettings open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Reset to default"));
    expect(useAppStore.getState().themeSettings).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("closes on Escape and via the close button", () => {
    const onClose = vi.fn();
    render(<ThemeSettings open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses logical (RTL-safe) spacing — no physical left/right margins", () => {
    const { container } = render(<ThemeSettings open onClose={() => {}} />);
    const styled = [...container.querySelectorAll<HTMLElement>("[style]")].map((el) => el.getAttribute("style") ?? "");
    for (const s of styled) {
      expect(s).not.toMatch(/margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
    }
  });
});

describe("settings.theme command", () => {
  const noop = () => {};
  const opts = (extra: Partial<UseCommandsOptions> = {}): UseCommandsOptions => ({
    handleNew: noop, handleOpen: noop, handleSave: noop, handleExportHtml: noop,
    handleSaveToWorkspace: noop, insertSnippet: noop, recents: [], setRecents: noop,
    handleReopenRecent: noop, collab: null, handleStartCollab: noop, handleStopCollab: noop,
    setSearchOpen: noop, setFindReplaceOpen: noop, setGraphOpen: noop, setHistoryOpen: noop,
    setTableEditorOpen: noop, setCanvasOpen: noop, setGalleryOpen: noop,
    ...extra,
  });

  it("is absent unless wired, and opens the panel when wired", () => {
    const { result: none } = renderHook(() => useCommands(opts()));
    expect(none.current.some((c) => c.id === "settings.theme")).toBe(false);
    const setThemeSettingsOpen = vi.fn();
    const { result } = renderHook(() => useCommands(opts({ setThemeSettingsOpen })));
    const cmd = result.current.find((c) => c.id === "settings.theme");
    expect(cmd?.label).toBe("Theme settings…");
    cmd?.action();
    expect(setThemeSettingsOpen).toHaveBeenCalledWith(true);
  });
});
