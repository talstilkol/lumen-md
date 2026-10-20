// Must stay the first import: Trusted Types policies before any DOM sink.
import "./lib/trustedTypesInit";
import "./fonts";
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdateBanner } from "./ui/UpdateBanner";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { showAiToast } from "./ui/AiToast";
import { ToastContainer } from "./components/Toast";
import { initTelemetry } from "./lib/telemetry";
import { initAuth } from "./auth/useAuth";
import { startAutoBackup, startVaultSnapshots } from "./sync/autoBackup";
import { requestPersistentStorage } from "./storage/persistentStorage";
import { initLocale, t } from "./i18n";
import { initSecretStore } from "./lib/secretStore";
import { installPrivacyLedger } from "./ai/privacyLedger";
import { installAiEscape } from "./ai/aiAbort";
import { adoptBootLocale } from "./store/useStore";
import "./index.css";

// Every AI network request is recorded; local-only blocks cloud ones (T37).
const lastBlockToast = new Map<string, number>();
installPrivacyLedger((entry) => {
  // One toast per destination per 30 s — a retrying caller mustn't flood.
  if (Date.now() - (lastBlockToast.get(entry.host) ?? 0) < 30_000) return;
  lastBlockToast.set(entry.host, Date.now());
  showAiToast(t("toast.privacyBlocked", { reason: entry.reason }), "error");
});
// Esc cancels any running AI request (T55).
installAiEscape((n) => showAiToast(t("toast.aiCancelled", { count: n }), "info"));
// Error reports: only when the user turned them on AND the build has a DSN (12.4).
void initTelemetry();
void initAuth();
startAutoBackup();
startVaultSnapshots();
// The vault lives in OPFS/IndexedDB; without this the browser may evict it.
void requestPersistentStorage();

// Web Vitals, measured on this device and never sent (12.4): shown in the
// Runtime metrics panel. Loaded off the startup path; the observers are
// buffered, so the page-load entries are still seen.
void import("./lib/webVitals").then((m) => m.startLocalVitals()).catch(() => {
  /* chunk failed to load — no local vitals this session */
});

// ─── Native Sync Dialog Capture (Milkdown overrides) ────────────────────
const nativePrompt = window.prompt;
window.prompt = function(message?: string, _defaultText?: string): string | null {
  if (message?.toLowerCase().includes("link") || message?.toLowerCase().includes("image") || message?.toLowerCase().includes("url")) {
    setTimeout(() => {
      showAiToast(t("toast.useTheFloatingMenuOr"), "info");
    }, 50);
    return null; // Aborts synchronous execution block
  }
  return nativePrompt.call(window, message, _defaultText);
};

// ─── iOS Share Extension — listen for shared note content
function initShareExtension() {
  if (typeof window === "undefined") return;
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<{ content?: string }>;
    const content = customEvent.detail?.content;
    if (!content) return;
    // Store the shared note content; App.tsx will pick it up on mount
    (window as unknown as Record<string, unknown>).__pendingSharedNote = content;
  };
  // Capacitor bridge fires a custom document event with shared content
  window.addEventListener("lumen:sharedNote", listener);
}
initShareExtension();

// Only the English string table ships in the main chunk (A7 lever 4).
// Load the persisted locale's lazy bundle BEFORE the first render so the
// synchronous t() calls never flash English for a Hebrew/French/… user.
// initLocale() resolves to English on any failure, so boot never blocks.
// Secrets (API keys, tokens) are decrypted into memory before the first
// render so synchronous reads see them (T36); never blocks boot for long.
const secretsReady = Promise.race([initSecretStore(), new Promise((r) => setTimeout(r, 1500))]);
void Promise.all([initLocale(), secretsReady])
  .then(([applied]) => {
    // initLocale falls back to English when the saved locale's chunk can't
    // load; the store was already rehydrated with the saved locale, and
    // App applies the store's locale on mount — sync it so that doesn't
    // undo the fallback (English strings under an RTL `lang`).
    adoptBootLocale(applied);
  })
  .finally(renderApp);

function renderApp() {
ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", background: "#0c0f17", color: "#e8e8e8",
          fontFamily: "Inter, system-ui, sans-serif", flexDirection: "column", gap: 16,
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>Lumen encountered an unexpected error.</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 20px", border: "1px solid #7c5cff", borderRadius: 8,
              background: "transparent", color: "#7c5cff", cursor: "pointer",
            fontSize: 13, fontWeight: 500,
          }}
        >
          Reload Lumen
        </button>
      </div>
    }>
      <Suspense fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", background: "#0c0f17", color: "#e8e8e8",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          Loading Lumen…
        </div>
      }>
        <App />
      </Suspense>
    </ErrorBoundary>
    <UpdateBanner />
    <ToastContainer />
  </React.StrictMode>,
);
}
