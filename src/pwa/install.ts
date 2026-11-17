/**
 * Installing Lumen as an app (plan W11.P13), with feature detection, in the
 * order R5.13 sets:
 *
 * 1. `<install>` (`'HTMLInstallElement' in window`): Chrome and Edge 148+,
 *    the element origin trial. The browser draws the button and asks.
 * 2. `navigator.install()`: the Web Install API (its own origin trial), on a
 *    click.
 * 3. `beforeinstallprompt`: Chromium before both (kept at startup by
 *    src/pwa/installPrompt.ts).
 * 4. Otherwise a guide for the browser in use: iOS / iPadOS (Safari's Share →
 *    Add to Home Screen; on iOS 26 every site added there opens as an app),
 *    Safari on the Mac (File → Add to Dock), Firefox on Android (menu →
 *    Install), Firefox on the desktop (it can't install web apps: the
 *    desktop app or another browser).
 *
 * Already installed (display-mode standalone, or `navigator.standalone` on
 * iOS): nothing to offer. The install count is kept in this browser only and
 * is never sent.
 */
import { takePrompt, keptPrompt, type BeforeInstallPromptEvent } from "./installPrompt";

export type GuideId = "ios" | "macSafari" | "firefoxAndroid" | "firefoxDesktop" | "other";
export type InstallMode = { kind: "installed" } | { kind: "element" } | { kind: "api" } | { kind: "prompt" } | { kind: "guide"; guide: GuideId };

export interface InstallEnv {
  /** `'HTMLInstallElement' in window`. */
  hasInstallElement: boolean;
  /** `navigator.install`, when present. */
  install?: () => Promise<unknown>;
  prompt: BeforeInstallPromptEvent | null;
  standalone: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

export function currentEnv(): InstallEnv {
  const nav = navigator as Navigator & { install?: () => Promise<unknown>; standalone?: boolean };
  return {
    hasInstallElement: "HTMLInstallElement" in window,
    install: typeof nav.install === "function" ? () => nav.install!() : undefined,
    prompt: keptPrompt(),
    standalone: nav.standalone === true || (typeof matchMedia === "function" && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches)),
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}

/** Which browser's steps to show when it offers no install API. */
export function guideFor(ua: string, maxTouchPoints = 0): GuideId {
  // iPadOS reports itself as a Mac: a Mac with a touch screen is an iPad.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Firefox\//.test(ua)) return /Android/.test(ua) ? "firefoxAndroid" : "firefoxDesktop";
  if (/Macintosh/.test(ua) && /Version\/\d+.*Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "macSafari";
  return "other";
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return { kind: "installed" };
  if (env.hasInstallElement) return { kind: "element" };
  if (env.install) return { kind: "api" };
  if (env.prompt) return { kind: "prompt" };
  return { kind: "guide", guide: guideFor(env.userAgent, env.maxTouchPoints) };
}

export type InstallOutcome = "installed" | "dismissed" | "unavailable";

/** The button's click, for the API and prompt modes. Must run in the click (both need a user activation). */
export async function runInstall(mode: InstallMode, env: InstallEnv): Promise<InstallOutcome> {
  if (mode.kind === "api" && env.install) {
    try {
      await env.install();
      return "installed";
    } catch (e) {
      // AbortError: the user said no. Anything else (no manifest id, not allowed here): offer the guide.
      return (e as { name?: string })?.name === "AbortError" ? "dismissed" : "unavailable";
    }
  }
  if (mode.kind === "prompt") {
    const p = env.prompt ?? takePrompt();
    if (!p) return "unavailable";
    if (p === keptPrompt()) takePrompt();
    await p.prompt();
    const { outcome } = await p.userChoice;
    return outcome === "accepted" ? "installed" : "dismissed";
  }
  return "unavailable";
}

export const COUNT_KEY = "lumen.install.count";

/** How many times Lumen was installed from this browser. Local only: never sent. */
export function installCount(storage: Pick<Storage, "getItem"> | null = safeStorage()): number {
  try {
    return Math.max(0, Math.floor(Number(storage?.getItem(COUNT_KEY)) || 0));
  } catch {
    return 0;
  }
}

export function recordInstall(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): number {
  const n = installCount(storage) + 1;
  try {
    storage?.setItem(COUNT_KEY, String(n));
  } catch {
    /* why: storage blocked; the count is a local nicety */
  }
  return n;
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
