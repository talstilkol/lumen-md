import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import type { CollabPeer } from "../collab/yjs";
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";

interface CollabInfo {
  roomName: string;
  peers: CollabPeer[];
  onLeave: () => void;
}

interface Props {
  text: string;
  /** doc dirty flag */
  dirty: boolean;
  /** Filename for display */
  filename: string;
  /** When in a collab session, shows peer dots and a leave action. */
  collab?: CollabInfo | null;
}

export function StatusBar({ text, dirty, filename, collab }: Props) {
  const stats = useMemo(() => computeStats(text), [text]);
  const aiKey = useAppStore((s) => s.aiKey);
  return (
    <footer className="status-bar">
      <span className="sb-item" title="Document">
        {dirty ? "●" : "○"} {filename}
      </span>
      {collab && (
        <span
          className="sb-item"
          title={`Collab room: ${collab.roomName}\n${collab.peers.length} peer(s)`}
          style={{ gap: 6 }}
        >
          <span className="sb-accent" style={{ fontWeight: 600 }}>{t("status.live")}</span>
          <span style={{ display: "inline-flex", gap: 3 }}>
            {collab.peers.slice(0, 5).map((p) => (
              <span
                key={p.clientId}
                title={`${p.user.name}${p.isSelf ? " (you)" : ""}`}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: p.user.color,
                  border: p.isSelf
                    ? "1px solid hsl(var(--fg))"
                    : "1px solid hsl(var(--border))",
                  display: "inline-block",
                }}
              />
            ))}
            {collab.peers.length > 5 && (
              <span style={{ marginLeft: 4 }}>+{collab.peers.length - 5}</span>
            )}
          </span>
          <button
            type="button"
            onClick={collab.onLeave}
            title="Leave collaboration"
            style={{
              marginLeft: 4,
              padding: "0 6px",
              fontSize: 10,
              border: "1px solid hsl(var(--border))",
              borderRadius: 3,
              background: "transparent",
              color: "hsl(var(--fg-muted))",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("status.leave")}
          </button>
        </span>
      )}
      <span className="sb-spacer" />
      <span className="sb-item" title="Word count">
        {t("status.words", { n: stats.words.toLocaleString() })}
      </span>
      <span className="sb-item" title="Characters (without spaces)">
        {t("status.chars", { n: stats.chars.toLocaleString() })}
      </span>
      <span className="sb-item" title="Reading time at ~220 wpm">
        {t("status.reading", { n: stats.readingMin })}
      </span>
      {aiKey && (
        <span className="sb-item" title="AI Copilot Active" style={{ gap: 4 }}>
          <Sparkles size={10} style={{ color: "hsl(var(--accent))", animation: "pulse 2s ease-in-out infinite" }} />
          <span style={{ color: "hsl(var(--accent))", fontSize: 10 }}>AI</span>
        </span>
      )}
      <span className="sb-item sb-accent">Lumen</span>
    </footer>
  );
}

interface Stats {
  words: number;
  chars: number;
  readingMin: number;
}

function computeStats(text: string): Stats {
  // Strip frontmatter and fenced code blocks for word count.
  const stripped = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/```[\s\S]*?```/g, "");

  // Words: groups of word chars, including unicode letters.
  const wordMatches = stripped.match(/[\p{L}\p{N}'’-]+/gu);
  const words = wordMatches?.length ?? 0;

  // Characters (excluding whitespace).
  const chars = stripped.replace(/\s+/g, "").length;

  // Reading time at ~220 wpm.
  const readingMin = Math.max(1, Math.round(words / 220));

  return { words, chars, readingMin };
}
