import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdateBanner } from "./ui/UpdateBanner";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { showAiToast } from "./ui/AiToast";
import { initCRDT } from "./storage/crdt";
import { ToastContainer } from "./components/Toast";
import { initTelemetry } from "./lib/telemetry";
import { initAuth } from "./auth/useAuth";
import "./index.css";

initTelemetry();
void initAuth();

// ─── Native Sync Dialog Capture (Milkdown overrides) ────────────────────
const nativePrompt = window.prompt;
window.prompt = function(message?: string, _defaultText?: string): string | null {
  if (message?.toLowerCase().includes("link") || message?.toLowerCase().includes("image") || message?.toLowerCase().includes("url")) {
    setTimeout(() => {
      showAiToast("Use the floating (/) menu or text selection tooltip for media insertions.", "info");
    }, 50);
    return null; // Aborts synchronous execution block
  }
  return nativePrompt.call(window, message, _defaultText);
};

initCRDT().finally(() => {
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
});
