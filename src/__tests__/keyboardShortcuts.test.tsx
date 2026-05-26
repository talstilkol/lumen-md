/**
 * KeyboardShortcuts — verify Mac detection uses the right fallback
 * chain so the dialog renders Cmd (⌘) on macOS, Ctrl elsewhere.
 *
 * Real bug found in round-12 screenshot 07-shortcuts.png: dialog
 * rendered "Ctrl+S" on macOS chromium because the old detection used
 * `navigator.platform` (deprecated; not always populated in headless
 * webview contexts). Fix uses userAgentData → userAgent → platform.
 */
import { describe, it, expect, afterEach } from "vitest";
import { detectIsMac } from "../ui/KeyboardShortcuts";

const originalNavigator = globalThis.navigator;

function withNavigator(nav: Partial<Navigator> & { userAgentData?: { platform?: string } }) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: nav as Navigator,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

describe("detectIsMac", () => {
  it("returns true when userAgentData.platform is 'macOS'", () => {
    withNavigator({
      userAgentData: { platform: "macOS" },
      userAgent: "any",
      platform: "Linux x86_64",
    });
    expect(detectIsMac()).toBe(true);
  });

  it("falls back to userAgent 'Macintosh' substring when userAgentData is absent", () => {
    withNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      platform: "Linux x86_64",
    });
    expect(detectIsMac()).toBe(true);
  });

  it("falls back to platform 'MacIntel' when neither userAgentData nor userAgent matches", () => {
    withNavigator({
      userAgent: "Lumen/1.0",
      platform: "MacIntel",
    });
    expect(detectIsMac()).toBe(true);
  });

  it("returns false on Windows / Linux", () => {
    withNavigator({
      userAgentData: { platform: "Windows" },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      platform: "Win32",
    });
    expect(detectIsMac()).toBe(false);

    withNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      platform: "Linux x86_64",
    });
    expect(detectIsMac()).toBe(false);
  });

  it("returns false when navigator is undefined (SSR)", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
    expect(detectIsMac()).toBe(false);
  });
});
