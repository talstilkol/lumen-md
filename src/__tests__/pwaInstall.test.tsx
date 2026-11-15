/**
 * Plan W11.P13: installing the web app, feature-detected in R5.13's order:
 * <install> (Chrome / Edge 148+), then navigator.install(), then
 * beforeinstallprompt; anywhere else, the steps for that browser (iOS 26
 * included). The install count is local only.
 *
 * The browsers below are described by their real user-agent strings, and the
 * install APIs are stand-ins with the shapes the Chrome blog and the Web
 * Install explainer give. Real Chrome 148 / Edge / Safari runs are owed (PR).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { COUNT_KEY, guideFor, installCount, installMode, recordInstall, runInstall, type InstallEnv } from "../pwa/install";
import { keepInstallPrompt, keptPrompt, takePrompt, type BeforeInstallPromptEvent } from "../pwa/installPrompt";
import { InstallDialog } from "../pwa/InstallDialog";

const UA = {
  chrome148: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  edge148: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  chrome120: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  iphone26: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  firefoxDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0",
};

const env = (o: Partial<InstallEnv> = {}): InstallEnv => ({ hasInstallElement: false, prompt: null, standalone: false, userAgent: UA.chrome120, maxTouchPoints: 0, ...o });

function fakePrompt(outcome: "accepted" | "dismissed") {
  let asked = 0;
  const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: async () => void asked++,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  }) as unknown as BeforeInstallPromptEvent;
  return { e, asked: () => asked };
}

beforeEach(() => {
  localStorage.clear();
  takePrompt();
});
afterEach(cleanup);

describe("which way to install (R5.13's order)", () => {
  it("<install> first, then navigator.install(), then the kept prompt, then a guide", () => {
    const install = async () => undefined;
    const { e } = fakePrompt("accepted");
    expect(installMode(env({ hasInstallElement: true, install, prompt: e, userAgent: UA.chrome148 }))).toEqual({ kind: "element" });
    expect(installMode(env({ install, prompt: e, userAgent: UA.edge148 }))).toEqual({ kind: "api" });
    expect(installMode(env({ prompt: e, userAgent: UA.chrome120 }))).toEqual({ kind: "prompt" });
    expect(installMode(env({ userAgent: UA.firefoxDesktop }))).toEqual({ kind: "guide", guide: "firefoxDesktop" });
    expect(installMode(env({ standalone: true, hasInstallElement: true }))).toEqual({ kind: "installed" });
  });

  it("the guide matches the browser: iPhone and an iPad that says Mac, Safari on the Mac, Firefox", () => {
    expect(guideFor(UA.iphone26)).toBe("ios");
    expect(guideFor(UA.ipadAsMac, 5)).toBe("ios");
    expect(guideFor(UA.macSafari, 0)).toBe("macSafari");
    expect(guideFor(UA.macChrome, 0)).toBe("other");
    expect(guideFor(UA.firefoxAndroid)).toBe("firefoxAndroid");
    expect(guideFor(UA.firefoxDesktop)).toBe("firefoxDesktop");
    expect(guideFor(UA.edge148)).toBe("other");
  });
});

describe("the click", () => {
  it("navigator.install(): installed, said no (AbortError), or not possible here (offer the guide)", async () => {
    const m = { kind: "api" } as const;
    expect(await runInstall(m, env({ install: async () => ({ manifestId: "https://lumen-md.vercel.app/" }) }))).toBe("installed");
    expect(await runInstall(m, env({ install: () => Promise.reject(new DOMException("cancelled", "AbortError")) }))).toBe("dismissed");
    expect(await runInstall(m, env({ install: () => Promise.reject(new DOMException("no id", "DataError")) }))).toBe("unavailable");
  });

  it("beforeinstallprompt: kept at startup with the browser's bar held back, used once", async () => {
    const target = new EventTarget() as unknown as Window;
    keepInstallPrompt(target);
    const yes = fakePrompt("accepted");
    target.dispatchEvent(yes.e);
    expect(yes.e.defaultPrevented).toBe(true);
    expect(keptPrompt()).toBe(yes.e);
    expect(await runInstall({ kind: "prompt" }, env({ prompt: keptPrompt() }))).toBe("installed");
    expect(yes.asked()).toBe(1);
    expect(keptPrompt()).toBeNull();
    const no = fakePrompt("dismissed");
    target.dispatchEvent(no.e);
    expect(await runInstall({ kind: "prompt" }, env())).toBe("dismissed");
    target.dispatchEvent(fakePrompt("accepted").e);
    target.dispatchEvent(new Event("appinstalled"));
    expect(keptPrompt()).toBeNull();
  });

  it("the count stays in this browser", () => {
    expect(installCount()).toBe(0);
    expect(recordInstall()).toBe(1);
    expect(recordInstall()).toBe(2);
    expect(localStorage.getItem(COUNT_KEY)).toBe("2");
    expect(installCount({ getItem: () => "garbage" })).toBe(0);
    expect(installCount(null)).toBe(0);
  });
});

describe("the dialog", () => {
  it("Chrome / Edge 148+: the browser's own <install> element; promptaction counts an install", () => {
    render(<InstallDialog open onClose={() => undefined} env={() => env({ hasInstallElement: true, userAgent: UA.chrome148 })} />);
    const el = screen.getByTestId("install-element");
    expect(el.tagName.toLowerCase()).toBe("install");
    // Its fallback content (shown where the element is unknown) is the generic steps.
    expect(el.querySelector('[data-testid="install-guide-other"]')).toBeTruthy();
    act(() => void el.dispatchEvent(new Event("promptaction")));
    expect(screen.getByTestId("install-done")).toBeTruthy();
    expect(screen.getByTestId("install-count").textContent).toContain("1");
    expect(localStorage.getItem(COUNT_KEY)).toBe("1");
  });

  it("an <install> the browser finds invalid (validationstatuschanged with invalidReason) shows the steps", () => {
    render(<InstallDialog open onClose={() => undefined} env={() => env({ hasInstallElement: true })} />);
    const el = screen.getByTestId("install-element");
    act(() => void el.dispatchEvent(new Event("validationstatuschanged")));
    expect(screen.getByTestId("install-element")).toBeTruthy();
    Object.defineProperty(el, "invalidReason", { value: "install_data_invalid", configurable: true });
    act(() => void el.dispatchEvent(new Event("validationstatuschanged")));
    expect(screen.queryByTestId("install-element")).toBeNull();
    expect(screen.getByTestId("install-guide-other")).toBeTruthy();
  });

  it("promptdismiss says it wasn't installed, and counts nothing", () => {
    render(<InstallDialog open onClose={() => undefined} env={() => env({ hasInstallElement: true })} />);
    act(() => void screen.getByTestId("install-element").dispatchEvent(new Event("promptdismiss")));
    expect(screen.getByTestId("install-dismissed")).toBeTruthy();
    expect(screen.queryByTestId("install-count")).toBeNull();
  });

  it("Edge with navigator.install(): a button; a refusal of the API falls back to the steps", async () => {
    let calls = 0;
    const e = env({ install: async () => void calls++, userAgent: UA.edge148 });
    render(<InstallDialog open onClose={() => undefined} env={() => e} />);
    await act(async () => void fireEvent.click(screen.getByTestId("install-button")));
    expect(calls).toBe(1);
    expect(screen.getByTestId("install-done")).toBeTruthy();
    cleanup();
    render(<InstallDialog open onClose={() => undefined} env={() => env({ install: () => Promise.reject(new DOMException("x", "NotAllowedError")) })} />);
    await act(async () => void fireEvent.click(screen.getByTestId("install-button")));
    expect(screen.getByTestId("install-guide-other")).toBeTruthy();
  });

  it("iPhone on iOS 26: the Home Screen steps, with Open as Web App", () => {
    render(<InstallDialog open onClose={() => undefined} env={() => env({ userAgent: UA.iphone26 })} />);
    const g = screen.getByTestId("install-guide-ios");
    expect(g.querySelectorAll("li")).toHaveLength(4);
    expect(g.textContent).toContain("Add to Home Screen");
    expect(g.textContent).toContain("iOS 26");
    expect(screen.queryByTestId("install-button")).toBeNull();
  });

  it("already installed: says so, offers nothing", () => {
    render(<InstallDialog open onClose={() => undefined} env={() => env({ standalone: true, hasInstallElement: true })} />);
    expect(screen.getByTestId("install-already")).toBeTruthy();
    expect(screen.queryByTestId("install-element")).toBeNull();
  });
});

describe("the wiring", () => {
  it("main keeps the prompt at startup; App opens the dialog from the palette's command; the manifest has an id", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toContain('import { keepInstallPrompt } from "./pwa/installPrompt";');
    expect(main).toContain("keepInstallPrompt();");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('useWindowEvent("lumen-open-install", () => setInstallOpen(true));');
    expect(readFileSync("src/commands/domains/vault.ts", "utf8")).toMatch(/id: "app\.install",[\s\S]*?new Event\("lumen-open-install"\)/);
    // navigator.install() of the current document needs the manifest's id.
    expect(readFileSync("vite.config.ts", "utf8")).toMatch(/manifest: \{[\s\S]*?\bid: "\/",/);
  });
});
