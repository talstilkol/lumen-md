/**
 * CollabSettings – small dialog to set/clear the custom signaling server URL
 * (`lumen.collab.signaling`) and the optional persistent y-websocket server
 * (`lumen.collab.ws`, read by src/collab/yjs.ts).
 *
 * The persistent server is a Pro capability (`Capabilities.persistentCollab`).
 * When not entitled the field is disabled with an upgrade notice, and saving
 * clears any stored persistent URL so sessions fall back to WebRTC P2P. With
 * no billing backend configured (self-hosted) the gate is open.
 * Accessible from the command palette or toolbar.
 */
import { useState } from "react";
import { t } from "../i18n";
import { useCapability } from "../billing/gates";
import { UpgradeNotice } from "./UpgradeNotice";

interface Props {
  onClose: () => void;
}

const SIGNALING_KEY = "lumen.collab.signaling";
const PERSISTENT_KEY = "lumen.collab.ws";

function readKey(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage denied */
  }
}

export function CollabSettings({ onClose }: Props) {
  const persistentAllowed = useCapability("persistentCollab");
  const [url, setUrl] = useState(() => readKey(SIGNALING_KEY));
  const [wsUrl, setWsUrl] = useState(() => readKey(PERSISTENT_KEY));

  const handleSave = () => {
    writeKey(SIGNALING_KEY, url.trim());
    writeKey(PERSISTENT_KEY, persistentAllowed ? wsUrl.trim() : "");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // CSS var → React rejects it as a number, so cast through unknown.
        zIndex: "var(--z-modal, 500)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "hsl(0 0% 0% / 0.5)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "hsl(var(--bg))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 24,
          width: 400,
          maxWidth: "90vw",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 15,
            fontWeight: 600,
            color: "hsl(var(--fg))",
          }}
        >
          Collaboration Settings
        </h3>
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 12,
            color: "hsl(var(--fg-muted))",
            lineHeight: 1.5,
          }}
        >
          Set a custom WebRTC signaling server URL. Leave empty to use the
          default (localhost:4444).
        </p>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="wss://your-signaling-server.example.com"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            background: "hsl(var(--bg-subtle))",
            color: "hsl(var(--fg))",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        <label
          htmlFor="collab-persistent-url"
          style={{
            display: "block",
            margin: "16px 0 6px",
            fontSize: 12,
            fontWeight: 600,
            color: "hsl(var(--fg))",
          }}
        >
          {t("collab.persistent.label")}
        </label>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "hsl(var(--fg-muted))", lineHeight: 1.5 }}>
          {t("collab.persistent.hint")}
        </p>
        <input
          id="collab-persistent-url"
          type="url"
          value={persistentAllowed ? wsUrl : ""}
          onChange={(e) => setWsUrl(e.target.value)}
          disabled={!persistentAllowed}
          aria-disabled={!persistentAllowed}
          placeholder="wss://your-yjs-server.example.com"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            background: "hsl(var(--bg-subtle))",
            color: "hsl(var(--fg))",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            opacity: persistentAllowed ? 1 : 0.5,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
        />
        {!persistentAllowed && (
          <div style={{ marginTop: 8 }}>
            <UpgradeNotice compact message={t("billing.upgrade.persistentCollab")} />
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={onClose}
            className="icon-btn"
            style={{
              width: "auto",
              padding: "6px 16px",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              border: "none",
              borderRadius: 8,
              background: "hsl(var(--accent))",
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
