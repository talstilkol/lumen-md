/**
 * Plan W13.Y4 — the system text size (iOS Dynamic Type, Android font scale)
 * reaches the app: the native side reports it, the web side applies it as a
 * root zoom (reflow, as browser zoom), this device can override it, and it is
 * read again when the app comes back to the foreground.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTextScale, clampScale, installSystemTextSize, MAX_SCALE, OVERRIDE_KEY, readTextScale } from "../a11y/systemTextSize";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const store = (v: string | null) => ({ getItem: (k: string) => (k === OVERRIDE_KEY ? v : null) });

afterEach(() => {
  document.documentElement.style.removeProperty("zoom");
  delete document.documentElement.dataset.textScale;
});

describe("reading the scale", () => {
  it("this device's override wins, then the system's, then 1", async () => {
    expect(await readTextScale({ storage: store("2"), native: async () => 1.3 })).toBe(2);
    expect(await readTextScale({ storage: store(null), native: async () => 1.3 })).toBe(1.3);
    expect(await readTextScale({ storage: store(null), native: async () => null })).toBe(1);
    expect(await readTextScale({ storage: store("not a number"), native: async () => 1.5 })).toBe(1.5);
  });

  it("clamps to 1 … 3.1 (iOS AX5) and rounds", () => {
    expect(clampScale(0.8)).toBe(1);
    expect(clampScale(5)).toBe(MAX_SCALE);
    expect(clampScale(1.23456)).toBe(1.23);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe("applying it", () => {
  it("200 % is a root zoom of 2 (the whole UI reflows, px-sized text included); 1 removes it", () => {
    applyTextScale(2);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("2");
    expect(document.documentElement.dataset.textScale).toBe("2");
    applyTextScale(1);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
    expect(document.documentElement.dataset.textScale).toBeUndefined();
  });

  it("is read again when the app comes back to the foreground", async () => {
    let system = 1;
    const stop = installSystemTextSize({ storage: store(null), native: async () => system });
    await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue("zoom")).toBe(""));
    system = 1.6; // the user changed Settings → Font size while the app was in the background
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.6"));
    stop();
    system = 2;
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.6");
  });
});

describe("the native sides and the wiring", () => {
  it("Android reports Configuration.fontScale; iOS reports Dynamic Type through UIFontMetrics; both are registered", () => {
    const java = read("android/app/src/main/java/com/lumen/editor/LumenNativePlugin.java");
    expect(java).toMatch(/@PluginMethod\s+public void getTextScale\(PluginCall call\)/);
    expect(java).toContain("getConfiguration().fontScale");
    const swift = read("ios/App/App/LumenNative.swift");
    expect(swift).toContain('CAPPluginMethod(name: "getTextScale", returnType: CAPPluginReturnPromise)');
    expect(swift).toMatch(/@objc func getTextScale\(_ call: CAPPluginCall\)/);
    expect(swift).toContain("UIFontMetrics(forTextStyle: .body)");
  });

  it("the app installs it at start, lazily (its own chunk), and the override is a known setting", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('import("./a11y/systemTextSize")');
    expect(app).toContain("installSystemTextSize()");
    expect(app).not.toMatch(/^import .*systemTextSize/m);
    expect(read("src/settings/schema.ts")).toContain('local("lumen.textScale.override"');
  });
});
