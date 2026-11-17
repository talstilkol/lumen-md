/**
 * Plan W13.P1 — app lock and the task-switcher cover: the seam (device check),
 * the states (cover on hide, lock after X minutes, cold start locked), FLAG_SECURE
 * while an encrypted vault is open or the lock is on, and the lock screen's
 * keyboard / screen-reader behaviour. The device half (a black screenshot of a
 * locked note, W11.M10) is checked on the phone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { AppLock, DEFAULT_SETTINGS, readSettings, writeSettings, webAuthnSeam, APP_LOCK_KEY, type AppLockSettings, type BiometricSeam } from "../privacy/appLock";
import { appLockOn, bootAppLock, BOOT_CLASS } from "../privacy/appLockBoot";
import { LockOverlay } from "../privacy/appLockUi";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function setup(settings: Partial<AppLockSettings> = {}, verify = true) {
  let now = 1_000_000;
  const s: AppLockSettings = { ...DEFAULT_SETTINGS, enabled: true, credentialId: "abc", ...settings };
  const seam: BiometricSeam = { available: async () => true, enroll: async () => "abc", verify: vi.fn(async () => verify) };
  const native = { setSecure: vi.fn(async () => ({})) };
  const lock = new AppLock({ settings: () => s, seam, now: () => now, native });
  return { lock, seam, native, s, tick: (ms: number) => (now += ms) };
}

beforeEach(() => localStorage.clear());

describe("the states", () => {
  it("a cold start is locked when the lock is on, open when it is off", () => {
    expect(setup().lock.start()).toBe("locked");
    expect(setup({ enabled: false }).lock.start()).toBe("unlocked");
  });

  it("going to the background covers at once (the switcher's snapshot sees the cover)", async () => {
    const { lock } = setup({ after: 5 });
    lock.start();
    await lock.unlock();
    lock.hidden();
    expect(lock.state).toBe("covered");
  });

  it("locks after the chosen minutes in the background, not before", async () => {
    const { lock, tick } = setup({ after: 5 });
    lock.start();
    await lock.unlock();
    lock.hidden();
    tick(4 * 60_000);
    expect(lock.visible()).toBe("unlocked");
    lock.hidden();
    tick(5 * 60_000);
    expect(lock.visible()).toBe("locked");
  });

  it("0 minutes locks on every return; with the lock off the cover only covers", async () => {
    const a = setup({ after: 0 });
    a.lock.start();
    await a.lock.unlock();
    a.lock.hidden();
    expect(a.lock.visible()).toBe("locked");
    const b = setup({ enabled: false });
    b.lock.start();
    b.lock.hidden();
    b.tick(3_600_000);
    expect(b.lock.visible()).toBe("unlocked");
  });

  it("only the device check unlocks; failures are counted", async () => {
    const { lock, seam } = setup({}, false);
    lock.start();
    expect(await lock.unlock()).toBe(false);
    expect(await lock.unlock()).toBe(false);
    expect(lock.state).toBe("locked");
    expect(lock.failedAttempts).toBe(2);
    expect(seam.verify).toHaveBeenCalledWith("abc");
    const noCred = setup({ credentialId: undefined });
    noCred.lock.start();
    expect(await noCred.lock.unlock()).toBe(false);
  });
});

describe("FLAG_SECURE (Android) through the native seam", () => {
  it("on while the lock is on or an encrypted vault is open, off otherwise", async () => {
    const off = setup({ enabled: false });
    off.lock.start();
    off.lock.setVaultOpen(true);
    await off.lock.syncSecure();
    expect(off.native.setSecure).toHaveBeenLastCalledWith({ secure: true });
    off.lock.setVaultOpen(false);
    await off.lock.syncSecure();
    expect(off.native.setSecure).toHaveBeenLastCalledWith({ secure: false });
    const on = setup();
    on.lock.start();
    await on.lock.syncSecure();
    expect(on.native.setSecure).toHaveBeenLastCalledWith({ secure: true });
  });

  it("the Android plugin sets and clears FLAG_SECURE and is registered", () => {
    const java = readFileSync(join(__dirname, "../../android/app/src/main/java/com/lumen/editor/LumenPrivacyPlugin.java"), "utf8");
    expect(java).toContain("addFlags(WindowManager.LayoutParams.FLAG_SECURE)");
    expect(java).toContain("clearFlags(WindowManager.LayoutParams.FLAG_SECURE)");
    expect(readFileSync(join(__dirname, "../../android/app/src/main/java/com/lumen/editor/MainActivity.java"), "utf8")).toContain("registerPlugin(LumenPrivacyPlugin.class)");
  });
});

describe("settings and boot", () => {
  it("reads and writes the settings, refusing an unknown delay", () => {
    writeSettings({ enabled: true, after: 15, credentialId: "x" });
    expect(readSettings()).toEqual({ enabled: true, after: 15, credentialId: "x" });
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({ enabled: true, after: 7 }));
    expect(readSettings().after).toBe(1);
    localStorage.setItem(APP_LOCK_KEY, "{bad");
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("with the lock on, the content is hidden before the first paint and the lock screen loads", () => {
    writeSettings({ enabled: true, after: 1, credentialId: "x" });
    expect(appLockOn()).toBe(true);
    const load = vi.fn(async () => ({ mountAppLock: () => undefined }));
    bootAppLock(document, load);
    expect(document.documentElement.classList.contains(BOOT_CLASS)).toBe(true);
    expect(document.getElementById("lumen-app-lock-boot")?.textContent).toContain("#root{visibility:hidden}");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("with the lock off, nothing loads until an encrypted vault unlocks", () => {
    document.documentElement.classList.remove(BOOT_CLASS);
    const load = vi.fn(async () => ({ mountAppLock: () => undefined }));
    bootAppLock(document, load);
    expect(load).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains(BOOT_CLASS)).toBe(false);
    window.dispatchEvent(new Event("lumen-vault-unlocked"));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("the lock screen", () => {
  it("is a modal dialog with the Unlock button focused; the app underneath is inert; focus comes back after", async () => {
    document.body.innerHTML = '<div id="root"><button id="was">note</button></div>';
    (document.getElementById("was") as HTMLButtonElement).focus();
    const { lock } = setup();
    render(createElement(LockOverlay, { lock }));
    act(() => void lock.start());
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("app-lock-unlock"));
    expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-lock-unlock"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.getElementById("root")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement?.id).toBe("was");
  });

  it("a failed check says so in an alert and keeps focus on Unlock", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { lock } = setup({}, false);
    render(createElement(LockOverlay, { lock }));
    act(() => void lock.start());
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-lock-unlock"));
    });
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(document.activeElement).toBe(screen.getByTestId("app-lock-unlock"));
  });

  it("the cover hides everything and is not announced", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { lock } = setup({ enabled: false });
    render(createElement(LockOverlay, { lock }));
    act(() => lock.hidden());
    expect(screen.getByTestId("app-cover").getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
  });
});

describe("the WebAuthn seam (local, user verification required)", () => {
  it("passes only when the authenticator says it verified the person (UV flag)", async () => {
    const authData = (flags: number) => {
      const b = new Uint8Array(37);
      b[32] = flags;
      return b.buffer;
    };
    let flags = 0x05;
    const nav = { credentials: { get: vi.fn(async () => ({ response: { authenticatorData: authData(flags) } })), create: vi.fn(async () => ({ rawId: new Uint8Array([1, 2, 3]).buffer })) } } as unknown as Navigator;
    const seam = webAuthnSeam(nav);
    expect(await seam.enroll()).toBe("AQID");
    expect(await seam.verify("AQID")).toBe(true);
    flags = 0x01;
    expect(await seam.verify("AQID")).toBe(false);
    const opts = (nav.credentials.get as ReturnType<typeof vi.fn>).mock.calls[0][0].publicKey;
    expect(opts.userVerification).toBe("required");
  });
});
