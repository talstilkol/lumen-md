/**
 * Plan W13.P1 — app lock and the task-switcher cover: the seam (device check),
 * the states (cover on hide, lock after X minutes, cold start locked), FLAG_SECURE
 * while an encrypted vault is open or the lock is on, and the lock screen's
 * keyboard / screen-reader behaviour. The device half (a black screenshot of a
 * locked note, W11.M10) is checked on the phone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppLock, DEFAULT_SETTINGS, newRecoveryCode, normalizeRecoveryCode, readSettings, recoveryMatches, recoveryRecord, writeSettings, webAuthnSeam, APP_LOCK_KEY, type AppLockSettings, type BiometricSeam } from "../privacy/appLock";
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

/*
 * Review 14 M6: the credential can disappear (Windows Hello reset, a new fingerprint, a cleared
 * profile). A one-time recovery code, shown once and kept only as a salted SHA-256, unlocks once and
 * turns the lock off; five wrong codes make it wait, doubling.
 */
describe("the recovery code (review 14 M6)", () => {
  async function withCode(verify = false) {
    const code = newRecoveryCode();
    const recovery = await recoveryRecord(code);
    let now = 5_000_000;
    let s: AppLockSettings = { ...DEFAULT_SETTINGS, enabled: true, credentialId: "gone", recovery };
    const save = vi.fn((n: AppLockSettings) => void (s = n));
    const seam: BiometricSeam = { available: async () => true, enroll: async () => "x", verify: async () => verify };
    const lock = new AppLock({ settings: () => s, save, seam, now: () => now, native: null });
    return { code, recovery, lock, save, settings: () => s, tick: (ms: number) => (now += ms) };
  }

  it("a code is 26 Crockford characters (130 bits) in groups of four, different every time, and only its hash is kept", async () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRecoveryCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
    const code = [...codes][0];
    const rec = await recoveryRecord(code);
    expect(JSON.stringify(rec)).not.toContain(code.replace(/-/g, ""));
    expect((await recoveryRecord(code)).hash).not.toBe(rec.hash); // salted
    expect(await recoveryMatches(code.toLowerCase().replace(/-/g, " "), rec)).toBe(true);
    expect(normalizeRecoveryCode("ol-il")).toBe("0111");
    expect(await recoveryMatches(newRecoveryCode(), rec)).toBe(false);
  });

  it("the right code unlocks once and turns the lock off (the credential is gone); the device check alone still fails", async () => {
    const w = await withCode(false);
    w.lock.start();
    expect(await w.lock.unlock()).toBe(false);
    expect(w.lock.state).toBe("locked");
    expect(await w.lock.recover(w.code)).toBe("unlocked");
    expect(w.lock.state).toBe("unlocked");
    expect(w.save).toHaveBeenCalledWith({ enabled: false, after: DEFAULT_SETTINGS.after });
    expect(w.settings().recovery).toBeUndefined();
    expect(w.settings().credentialId).toBeUndefined();
  });

  it("a wrong code keeps it locked; five in a row make it wait 30 s, then 60 s", async () => {
    const w = await withCode();
    w.lock.start();
    for (let i = 0; i < 5; i++) expect(await w.lock.recover("0000-0000")).toBe("wrong");
    expect(w.lock.recoveryWaitMs).toBe(30_000);
    expect(await w.lock.recover(w.code)).toBe("wait"); // even the right one waits
    expect(w.lock.state).toBe("locked");
    w.tick(30_000);
    expect(await w.lock.recover("0000")).toBe("wrong");
    expect(w.lock.recoveryWaitMs).toBe(60_000);
    w.tick(60_000);
    expect(await w.lock.recover(w.code)).toBe("unlocked");
  });

  it("a lock turned on before codes existed has none: the device check is the only way", async () => {
    const { lock } = setup({}, false);
    lock.start();
    expect(await lock.recover("anything")).toBe("none");
    expect(lock.state).toBe("locked");
  });

  it("a malformed stored recovery is dropped when the settings are read", () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({ enabled: true, after: 1, credentialId: "c", recovery: { salt: 1, hash: "x" } }));
    expect(readSettings().recovery).toBeUndefined();
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({ enabled: true, after: 1, credentialId: "c", recovery: { salt: "s", hash: "h" } }));
    expect(readSettings().recovery).toEqual({ salt: "s", hash: "h" });
  });

  it("the lock screen: 'Use the recovery code' opens a labelled field with focus; a wrong code is announced; the right one unlocks", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const w = await withCode();
    render(createElement(LockOverlay, { lock: w.lock }));
    act(() => void w.lock.start());
    fireEvent.click(screen.getByTestId("app-lock-recover"));
    const input = screen.getByLabelText(/Recovery code/) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "WRONG-CODE" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("app-lock-recover-form"));
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not right/));
    expect(w.lock.state).toBe("locked");
    fireEvent.change(input, { target: { value: w.code.toLowerCase() } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("app-lock-recover-form"));
    });
    await waitFor(() => expect(w.lock.state).toBe("unlocked"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
