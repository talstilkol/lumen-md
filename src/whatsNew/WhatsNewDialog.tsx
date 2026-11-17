/** The "What's new" dialog (plan 14.6): the version's notes, rendered like a note, in the interface's language. */
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./strings";
import "./WhatsNewDialog.css";
import { t } from "../i18n";
import { HelpButton } from "../ui/HelpButton";
import { Modal } from "../ui/Modal";

export interface ShownNotes {
  version: string;
  date: string | null;
  markdown: string;
  translated: boolean;
}

export function WhatsNewDialog({ notes, version, render, onClose }: { notes: ShownNotes | null; version: string; render: (md: string) => Promise<ReactNode>; onClose: () => void }) {
  const [body, setBody] = useState<ReactNode>(null);
  useEffect(() => {
    let live = true;
    if (notes) void render(notes.markdown).then((n) => live && setBody(n));
    return () => {
      live = false;
    };
  }, [notes, render]);
  return (
    <Modal onClose={onClose} aria-labelledby="wn-title" className="wn-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wn-dialog" data-testid="whats-new" data-version={notes?.version ?? version}>
        <div className="wn-head">
          <h2 id="wn-title">{t("whatsNew.title", { version: notes?.version ?? version })}</h2>
          <HelpButton topic="getting-started/whats-new" />
        </div>
        {notes?.date && <p className="wn-date">{notes.date}</p>}
        {notes && !notes.translated && <p className="wn-note">{t("whatsNew.untranslated")}</p>}
        {/* the notes render like a note (prose-lumen: headings, lists); the region scrolls, so it takes keyboard focus */}
        <div className="wn-body prose-lumen" dir="auto" tabIndex={0} role="region" aria-labelledby="wn-title" data-testid="whats-new-body">
          {/* empty-allow: no release notes for this version is a fact about the build, and Close follows */}
          {notes ? body ?? t("whatsNew.loading") : t("whatsNew.none")}
        </div>
        <div className="wn-actions">
          <button type="button" onClick={onClose} autoFocus data-testid="whats-new-close">
            {t("whatsNew.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function showWhatsNew(notes: ShownNotes | null, version: string): void {
  if (document.querySelector('[data-testid="whats-new"]')) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  const render = async (md: string) => (await import("../renderer/pipeline")).renderMarkdown(md, () => document.documentElement.classList.contains("dark"));
  root.render(<WhatsNewDialog notes={notes} version={version} render={render} onClose={close} />);
}
