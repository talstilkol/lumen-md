/**
 * The system's text size, honoured (plan W13.Y4; EN 301 549 v4.1.1 user
 * preferences, WCAG 1.4.4):
 *
 *   iOS       Dynamic Type — the native plugin reads the content size
 *             category (LumenNative.getTextScale, ios/App/App/LumenNative.swift);
 *   Android   Settings → Font size — Configuration.fontScale (LumenNativePlugin.java);
 *   desktop   the browser's and the system's zoom already scale CSS pixels:
 *             nothing to do, and nothing here fights it;
 *   override  this device's own setting (`lumen.textScale.override`, 1–3), for
 *             the user and for the e2e gate (e2e/a11y-text-size.spec.ts).
 *
 * The scale is applied as CSS zoom on the root — the same reflow browser zoom
 * gives, so px-sized UI grows with the text and nothing is clipped.
 * Re-read when the app comes back to the foreground (the user may have
 * changed the setting meanwhile).
 */

export const OVERRIDE_KEY = "lumen.textScale.override";
export const MIN_SCALE = 1;
/** iOS's largest accessibility size is about 3.1 × the default. */
export const MAX_SCALE = 3.1;

export interface TextScaleDeps {
  /** The native bridge's answer, or null where there is no native side. */
  native?: () => Promise<number | null>;
  storage?: Pick<Storage, "getItem"> | null;
  root?: HTMLElement;
}

export function clampScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)) * 100) / 100;
}

function overrideScale(storage: Pick<Storage, "getItem"> | null | undefined): number | null {
  try {
    const v = storage?.getItem(OVERRIDE_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? clampScale(n) : null;
  } catch {
    return null;
  }
}

async function nativeScale(): Promise<number | null> {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const { registerPlugin } = await import("@capacitor/core");
  const p = registerPlugin<{ getTextScale(): Promise<{ scale: number }> }>("LumenNative");
  try {
    return (await p.getTextScale()).scale;
  } catch {
    return null;
  }
}

/** The scale to use: this device's override, else the system's, else 1. */
export async function readTextScale(deps: TextScaleDeps = {}): Promise<number> {
  const storage = deps.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : deps.storage;
  const o = overrideScale(storage);
  if (o !== null) return o;
  const n = await (deps.native ?? nativeScale)();
  return n === null ? 1 : clampScale(n);
}

/** Apply `scale` to the root (1 removes it). */
export function applyTextScale(scale: number, root: HTMLElement = document.documentElement): void {
  const s = clampScale(scale);
  if (s === 1) {
    root.style.removeProperty("zoom");
    delete root.dataset.textScale;
  } else {
    root.style.setProperty("zoom", String(s));
    root.dataset.textScale = String(s);
  }
}

/** Read and apply now, and again whenever the app comes back to the foreground. Returns a stop function. */
export function installSystemTextSize(deps: TextScaleDeps = {}): () => void {
  const root = deps.root ?? document.documentElement;
  const run = () => void readTextScale(deps).then((s) => applyTextScale(s, root)).catch(() => undefined);
  run();
  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", run);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", run);
  };
}
