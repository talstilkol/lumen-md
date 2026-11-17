/**
 * Plan W11.P13: keep Chromium's `beforeinstallprompt` event for the install
 * dialog, which loads later. Imported by src/main.tsx at startup (the event
 * fires once, early), so it stays this small; everything else is in
 * src/pwa/install.ts, loaded with the dialog.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

let kept: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** The kept event, if the browser offered one and it hasn't been used. */
export const keptPrompt = (): BeforeInstallPromptEvent | null => kept;

/** Used once: the browser allows one prompt() per event. */
export function takePrompt(): BeforeInstallPromptEvent | null {
  const e = kept;
  kept = null;
  return e;
}

export function onPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function keepInstallPrompt(target: Pick<Window, "addEventListener"> = window): void {
  target.addEventListener("beforeinstallprompt", (e) => {
    // Our own button asks; the browser's mini-infobar doesn't.
    e.preventDefault();
    kept = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  target.addEventListener("appinstalled", () => {
    kept = null;
    listeners.forEach((fn) => fn());
  });
}
