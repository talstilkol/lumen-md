/**
 * W13.E1 — Vim keys in the settings screen (Obsidian 1.13), behind the same
 * `vimEnabled` setting as the editor's Vim mode: j / k move through the
 * controls of the open tab and through the tabs, / goes to the search.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

import { SettingsScreen } from "../ui/SettingsScreen";
import { useAppStore } from "../store/useStore";

describe("Vim keys in the settings (Obsidian 1.13), with the same setting", () => {
  afterEach(cleanup);

  it("j / k move through the controls and the tabs, / goes to the search", () => {
    useAppStore.setState({ vimEnabled: true });
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    const controls = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] [data-setting]')];
    controls[0].focus();
    fireEvent.keyDown(controls[0], { key: "j" });
    expect(document.activeElement).toBe(controls[1]);
    fireEvent.keyDown(controls[1], { key: "k" });
    expect(document.activeElement).toBe(controls[0]);
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "j" });
    expect(document.activeElement?.getAttribute("data-tab")).toBe(tabs[1].getAttribute("data-tab"));
    fireEvent.keyDown(document.activeElement!, { key: "/" });
    expect(document.activeElement?.getAttribute("data-testid")).toBe("settings-search");
  });

  it("does nothing without Vim mode, and never while typing in the search", () => {
    useAppStore.setState({ vimEnabled: false });
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    const controls = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"] [data-setting]')];
    controls[0].focus();
    fireEvent.keyDown(controls[0], { key: "j" });
    expect(document.activeElement).toBe(controls[0]);
    cleanup();
    useAppStore.setState({ vimEnabled: true });
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    const search = document.querySelector<HTMLElement>('[data-testid="settings-search"]')!;
    search.focus();
    fireEvent.keyDown(search, { key: "j" });
    expect(document.activeElement).toBe(search);
  });
});
