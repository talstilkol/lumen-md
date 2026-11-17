/**
 * The lock screen and the task-switcher cover (plan W13.P1), in their own
 * React root above the app, so App.tsx needn't know. While the app is
 * covered or locked, #root is `inert` (no focus, no screen reader) and
 * hidden; the lock screen is a modal dialog whose Unlock button has focus.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import "./appLockStrings";
import { AppLock, readSettings, webAuthnSeam, type LockState, type NativePrivacy } from "./appLock";
import { BOOT_CLASS } from "./appLockBoot";

let lock: AppLock | null = null;

function native(): NativePrivacy | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.isNativePlatform?.() ? ((cap.Plugins?.LumenPrivacy as NativePrivacy | undefined) ?? null) : null;
}

/** The one lock of this window (made on first use). */
export function appLock(): AppLock {
  lock ??= new AppLock({ settings: () => readSettings(), seam: webAuthnSeam(), now: () => Date.now(), native: native() });
  return lock;
}

function applyToApp(state: LockState, doc: Document): void {
  const app = doc.getElementById("root");
  const hide = state !== "unlocked";
  if (app) {
    if (hide) app.setAttribute("inert", "");
    else app.removeAttribute("inert");
    (app as HTMLElement).style.visibility = hide ? "hidden" : "";
  }
  if (!hide) doc.documentElement.classList.remove(BOOT_CLASS);
}

export function LockOverlay({ lock: l, doc = document }: { lock: AppLock; doc?: Document }) {
  const [state, setState] = useState<LockState>(l.state);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => l.onChange(setState), [l]);
  useEffect(() => {
    applyToApp(state, doc);
    if (state === "locked") {
      before.current ??= doc.activeElement;
      button.current?.focus();
    } else if (state === "unlocked") {
      const back = before.current as HTMLElement | null;
      before.current = null;
      // Focus goes back where it was, never to <body>.
      if (back && back !== doc.body && doc.contains(back)) back.focus?.();
    }
  }, [state, doc]);

  // After a failed check the button is enabled again on this render: focus goes back to it, never to <body>.
  useEffect(() => {
    if (error && !busy) button.current?.focus();
  }, [error, busy]);

  if (state === "unlocked") return null;
  const cover: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 2147483647, display: "grid", placeItems: "center", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };
  if (state === "covered") return <div style={cover} data-testid="app-cover" aria-hidden="true" />;

  const unlock = async () => {
    setBusy(true);
    setError("");
    const ok = await l.unlock();
    setBusy(false);
    if (!ok) setError(t(l.failedAttempts >= 3 ? "appLock.failedMany" : "appLock.failed"));
  };
  return (
    <div style={cover}>
      <div role="dialog" aria-modal="true" aria-labelledby="app-lock-title" aria-describedby="app-lock-body" data-testid="app-lock" style={{ display: "grid", gap: 12, justifyItems: "center", padding: 24, maxWidth: 360, textAlign: "center" }}>
        <div aria-hidden="true" style={{ fontSize: 40 }}>🔒</div>
        <h2 id="app-lock-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {t("appLock.title")}
        </h2>
        <p id="app-lock-body" style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg-muted))" }}>
          {t("appLock.body")}
        </p>
        <button ref={button} type="button" className="btn btn-primary" onClick={() => void unlock()} disabled={busy} data-testid="app-lock-unlock" style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "hsl(var(--accent))", color: "hsl(var(--accent-fg))", fontSize: 15, cursor: "pointer" }}>
          {busy ? t("appLock.checking") : t("appLock.unlock")}
        </button>
        <div role="alert" style={{ minHeight: 20, fontSize: 13, color: "hsl(var(--danger))" }}>
          {error}
        </div>
      </div>
    </div>
  );
}

let mounted = false;

/** Mounts the overlay once and wires the background / foreground and vault events. */
export function mountAppLock(doc: Document = document): AppLock {
  const l = appLock();
  if (mounted) return l;
  mounted = true;
  const host = doc.createElement("div");
  host.id = "lumen-app-lock";
  doc.body.appendChild(host);
  createRoot(host).render(<LockOverlay lock={l} doc={doc} />);
  const win = doc.defaultView;
  doc.addEventListener("visibilitychange", () => (doc.visibilityState === "hidden" ? l.hidden() : l.visible()));
  win?.addEventListener("pagehide", () => l.hidden());
  win?.addEventListener("lumen-vault-unlocked", () => l.setVaultOpen(true));
  win?.addEventListener("lumen-vault-locked", () => l.setVaultOpen(false));
  l.setVaultOpen(true === (win as unknown as { __lumenVaultOpen?: boolean })?.__lumenVaultOpen);
  l.start();
  applyToApp(l.state, doc);
  return l;
}
