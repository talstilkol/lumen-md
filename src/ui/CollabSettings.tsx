/**
 * CollabSettings – small dialog to set/clear the custom signaling server URL.
 * Persists to localStorage under `lumen.collab.signaling`.
 * Accessible from the command palette or toolbar.
 */
import { useState } from "react";

interface Props {
  onClose: () => void;
}

export function CollabSettings({ onClose }: Props) {
  const [url, setUrl] = useState(
    () => localStorage.getItem("lumen.collab.signaling") ?? "",
  );

  const handleSave = () => {
    const trimmed = url.trim();
    if (trimmed) {
      localStorage.setItem("lumen.collab.signaling", trimmed);
    } else {
      localStorage.removeItem("lumen.collab.signaling");
    }
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
