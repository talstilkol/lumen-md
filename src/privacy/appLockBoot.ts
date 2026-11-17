/**
 * App lock at start-up (plan W13.P1) — the small part in the startup bundle.
 * When the lock is on, the content is hidden before the first paint (a cold
 * start is always locked), and the lock screen (./appLockUi.tsx) loads right
 * after. When it is off, nothing loads until an encrypted vault is unlocked,
 * whose content then gets the task-switcher cover and FLAG_SECURE too.
 */
/** The stored settings (./appLock.ts reads and writes them); here only "is it on?". */
export const APP_LOCK_KEY = "lumen-app-lock";

const STYLE_ID = "lumen-app-lock-boot";
export const BOOT_CLASS = "lumen-locked-boot";

export function appLockOn(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return (JSON.parse(storage?.getItem(APP_LOCK_KEY) ?? "null") as { enabled?: unknown } | null)?.enabled === true;
  } catch {
    return false;
  }
}

export function bootAppLock(doc: Document = document, load: () => Promise<{ mountAppLock: () => void }> = () => import("./appLockUi")): void {
  const mount = () => void load().then((m) => m.mountAppLock(), () => undefined);
  if (appLockOn()) {
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      // Hidden, not removed: the app keeps starting underneath; only the lock screen shows.
      style.textContent = `html.${BOOT_CLASS} #root{visibility:hidden}`;
      doc.head.appendChild(style);
    }
    doc.documentElement.classList.add(BOOT_CLASS);
    mount();
    return;
  }
  // An encrypted vault unlocked: its notes get the cover and FLAG_SECURE (session.ts's event).
  doc.defaultView?.addEventListener("lumen-vault-unlocked", mount, { once: true });
}
