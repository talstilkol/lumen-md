/**
 * "My notes on this verse" as a side panel (plan W5.1 step 2, W10.C24),
 * instead of a one-off list. It follows the verse under the cursor (the
 * editor's reference trigger publishes it, editor/refTrigger.ts) and lists
 * every note in the vault that cites the same verse. Read locally: nothing
 * is sent.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../i18n";
import { onCursorVerse } from "../../editor/refTrigger";
import { EmptyState, learnHow } from "../../ui/EmptyState";
import type { SourceRef } from "./refs";
import { HelpButton } from "../../ui/HelpButton";

export interface VersePanelProps {
  /** The verse to start with (the selection's, or the open source note's). */
  initial: SourceRef | null;
  /** Notes citing the verse (default: the vault, read locally). */
  notesFor: (ref: SourceRef) => Promise<string[]>;
  onOpen: (path: string) => void;
  onClose: () => void;
  /** Follow the cursor (default: the source editor's). */
  follow?: (fn: (ref: SourceRef | null) => void) => () => void;
}

const panel: React.CSSProperties = {
  position: "fixed",
  insetBlock: "48px 32px",
  insetInlineEnd: 0,
  width: "min(320px, 90vw)",
  background: "hsl(var(--bg))",
  borderInlineStart: "1px solid hsl(var(--border))",
  boxShadow: "0 0 12px rgb(0 0 0 / 0.12)",
  padding: 12,
  overflow: "auto",
  zIndex: 40,
};

export function VersePanel({ initial, notesFor, onOpen, onClose, follow = onCursorVerse }: VersePanelProps) {
  const [verse, setVerse] = useState<SourceRef | null>(initial);
  const [notes, setNotes] = useState<string[] | null>(null);
  const seq = useRef(0);

  // A new verse under the cursor replaces the shown one; moving off every verse keeps the last.
  useEffect(() => follow((r) => r && setVerse((v) => (v?.key === r.key ? v : r))), [follow]);

  useEffect(() => {
    if (!verse) return;
    const n = ++seq.current;
    setNotes(null);
    void notesFor(verse).then((list) => n === seq.current && setNotes(list));
  }, [verse, notesFor]);

  return (
    <aside role="complementary" aria-labelledby="verse-panel-title" data-testid="verse-panel" style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 id="verse-panel-title" style={{ fontSize: 14, margin: 0, flex: 1 }}>
          {verse ? t("sources.panel.title", { ref: verse.he }) : t("sources.panel.titleNone")}
        </h2>
        <HelpButton topic="workspace/jewish-sources#my-notes-on-this-verse" size={20} />
        <button type="button" onClick={onClose} aria-label={t("sources.panel.close")} data-testid="verse-panel-close">
          ×
        </button>
      </div>
      {!verse && <p style={{ fontSize: 13, opacity: 0.8 }}>{t("sources.panel.hint")}</p>}
      {verse && notes === null && <p style={{ fontSize: 13, opacity: 0.8 }}>…</p>}
      {verse && notes?.length === 0 && (
        <EmptyState testId="verse-panel-empty" style={{ padding: 0, fontSize: 13 }} message={t("sources.noNotes", { ref: verse.he })} action={learnHow("workspace/jewish-sources#my-notes-on-this-verse")} />
      )}
      {verse && !!notes?.length && (
        <p style={{ fontSize: 13 }}>{t("sources.notesTitle", { ref: verse.he, count: notes.length })}</p>
      )}
      {verse && !!notes?.length && (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }} data-testid="verse-panel-list">
          {notes.map((p) => (
            <li key={p}>
              <button type="button" onClick={() => onOpen(p)} style={{ all: "unset", cursor: "pointer", display: "block", padding: "4px 0", textDecoration: "underline" }}>
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeVersePanel(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

/** Open (or replace) the side panel. */
export function openVersePanel(p: Omit<VersePanelProps, "onClose">): void {
  closeVersePanel();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(<VersePanel {...p} onClose={closeVersePanel} />);
}
