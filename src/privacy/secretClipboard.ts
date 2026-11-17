/**
 * Clipboard hygiene for secrets (plan W13.P5), as password managers do it:
 * a recovery key, sync words or a pairing code copied from Lumen
 *
 *   - is marked sensitive where the platform can: Android 13+
 *     (ClipDescription.EXTRA_IS_SENSITIVE: hidden from the clipboard preview
 *     and the keyboard's suggestions) and iOS (UIPasteboard, local only,
 *     with an expiration date), through the LumenPrivacy native plugin;
 *   - is cleared after 60 seconds if it is still what the clipboard holds.
 *     Natively the plugin compares; in a browser Lumen compares when it may
 *     read the clipboard, and otherwise clears only if nothing else was
 *     copied in the app meanwhile and the user never left the window (a copy
 *     in another app fires nothing here: review 14 Low 3), so a newer copy is
 *     never thrown away. Then the secret may stay; the user is told to clear
 *     it where the copy happens.
 *
 * Lumen never reads the clipboard on its own: the only read is the paste a
 * user asks for (clipboardHygiene.test.ts holds the app to it).
 */

export const SECRET_CLEAR_MS = 60_000;

/** The native seam (android/…/LumenPrivacyPlugin.java). */
export interface NativeSecretClipboard {
  copySensitive(o: { text: string; expiresInMs: number }): Promise<unknown>;
  clearIfEquals(o: { text: string }): Promise<{ cleared: boolean }>;
}

export interface SecretClipboardDeps {
  clipboard?: Pick<Clipboard, "writeText"> & Partial<Pick<Clipboard, "readText">>;
  native?: NativeSecretClipboard | null;
  /** Whether reading the clipboard is already allowed (never prompts). */
  canRead?: () => Promise<boolean>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  doc?: Pick<Document, "addEventListener" | "removeEventListener">;
  /** The window: leaving it (blur) means another app may have copied since. */
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
}

function nativePlugin(): NativeSecretClipboard | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.LumenPrivacy as NativeSecretClipboard | undefined) ?? null;
}

async function readAllowed(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName });
    return p?.state === "granted";
  } catch {
    return false;
  }
}

let pending: { cancel: () => void } | null = null;

/**
 * Copies `text` as a secret. Resolves false when the clipboard refused it.
 * A second secret copy replaces the first one's timer.
 */
export async function copySecret(text: string, deps: SecretClipboardDeps = {}): Promise<boolean> {
  const native = deps.native === undefined ? nativePlugin() : deps.native;
  const clipboard = deps.clipboard ?? globalThis.navigator?.clipboard;
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancelTimer = deps.clearTimeout ?? ((id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
  const doc = deps.doc ?? (typeof document !== "undefined" ? document : undefined);
  const win = deps.win ?? (typeof window !== "undefined" ? window : undefined);
  pending?.cancel();
  pending = null;
  try {
    if (native) await native.copySensitive({ text, expiresInMs: SECRET_CLEAR_MS });
    else if (clipboard) await clipboard.writeText(text);
    else return false;
  } catch {
    return false;
  }
  // Something else copied in the app after the secret, or the user went to another app (which may have
  // copied, unseen from here): the clipboard is no longer known to be ours to clear.
  let replaced = false;
  const onCopy = () => {
    replaced = true;
  };
  doc?.addEventListener("copy", onCopy);
  doc?.addEventListener("cut", onCopy);
  doc?.addEventListener("visibilitychange", onCopy);
  win?.addEventListener("blur", onCopy);
  const stop = () => {
    doc?.removeEventListener("copy", onCopy);
    doc?.removeEventListener("cut", onCopy);
    doc?.removeEventListener("visibilitychange", onCopy);
    win?.removeEventListener("blur", onCopy);
  };
  const id = later(() => {
    stop();
    pending = null;
    void clearIfStillSecret(text, { native, clipboard, canRead: deps.canRead ?? readAllowed, replaced: () => replaced });
  }, SECRET_CLEAR_MS);
  pending = {
    cancel: () => {
      cancelTimer(id);
      stop();
    },
  };
  return true;
}

async function clearIfStillSecret(
  text: string,
  o: { native: NativeSecretClipboard | null; clipboard?: SecretClipboardDeps["clipboard"]; canRead: () => Promise<boolean>; replaced: () => boolean },
): Promise<boolean> {
  try {
    if (o.native) return (await o.native.clearIfEquals({ text })).cleared;
    if (!o.clipboard) return false;
    // Reading is allowed: compare, that is the answer. Not allowed: clear only if nothing may have replaced it.
    if (o.clipboard.readText && (await o.canRead())) {
      if ((await o.clipboard.readText()) !== text) return false;
    } else if (o.replaced()) return false;
    await o.clipboard.writeText("");
    return true;
  } catch {
    return false;
  }
}

/** For tests: forget a pending clear. */
export function __resetSecretClipboard(): void {
  pending?.cancel();
  pending = null;
}
