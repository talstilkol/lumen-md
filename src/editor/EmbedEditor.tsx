/**
 * The "edit in place" control of an embedded block or section (plan W12.U1).
 * It sits in the embed's title. Opening it shows a small editor with the
 * block's Markdown source, framed and labelled "Editing the source: <note>".
 * Saving writes the source note through the workspace's own write path
 * (`writeWorkspaceFile`, the one every save uses), so the preview, the index
 * and sync see an ordinary edit of that note.
 *
 * Undo: Ctrl+Z / ⌘Z inside the editor is the text area's own undo. After a
 * save, "Undo" (or Ctrl+Z / ⌘Z while the control has focus) puts the source
 * back, but only if nobody changed it since. The host note is never touched:
 * the embed re-renders from the source.
 */
import "./embedEditStrings";
import { useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { applyEmbedEdit, currentSlice, splitMarker, type EmbedRange } from "./embedEdit";

export interface EmbedEditIo {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

const workspaceIo: EmbedEditIo = {
  read: async (p) => (await import("../storage/workspace")).readWorkspaceFile(p),
  write: async (p, text) => (await import("../storage/workspace")).writeWorkspaceFile(p, text),
};

export function parseRange(range: string): EmbedRange | null {
  const m = /^(\d+):(\d+):([0-9a-f]{8})$/.exec(range);
  return m ? { start: Number(m[1]), end: Number(m[2]), sum: m[3] } : null;
}

export default function EmbedEditor({ path, range, note, io = workspaceIo }: { path: string; range: string; note: string; io?: EmbedEditIo }) {
  const r = parseRange(range);
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  if (!r || !path) return null;

  const open = async () => {
    const src = await io.read(path);
    const cur = currentSlice(src, r);
    if (!cur.ok) return setMessage(t("embedEdit.changed"));
    setMessage("");
    setDraft(splitMarker(cur.slice).body);
    queueMicrotask(() => area.current?.focus());
  };
  const save = async () => {
    if (draft === null) return;
    const before = await io.read(path);
    const res = applyEmbedEdit(before, r, draft);
    if (!res.ok) return setMessage(t("embedEdit.changed"));
    if (res.text !== before) {
      await io.write(path, res.text);
      setUndo({ before, after: res.text });
      setMessage(t("embedEdit.saved", { note }));
    }
    setDraft(null);
  };
  const undoSave = async () => {
    if (!undo) return;
    if ((await io.read(path)) !== undo.after) {
      setUndo(null);
      return setMessage(t("embedEdit.undoChanged", { note }));
    }
    await io.write(path, undo.before);
    setUndo(null);
    setMessage(t("embedEdit.undone", { note }));
  };
  const onKeys = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (draft !== null && mod && e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (draft !== null && e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    } else if (draft === null && undo && mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void undoSave();
    }
  };

  return (
    <span className="lumen-embed-edit" onKeyDown={onKeys}>
      {draft === null ? (
        <>
          <button type="button" className="lumen-embed-edit-open" aria-label={t("embedEdit.open", { note })} onClick={() => void open()}>
            ✎
          </button>
          {undo && (
            <button type="button" className="lumen-embed-edit-undo" onClick={() => void undoSave()}>
              {t("embedEdit.undo")}
            </button>
          )}
        </>
      ) : (
        <span className="lumen-embed-edit-box" role="group" aria-label={t("embedEdit.label", { note })}>
          <span className="lumen-embed-edit-label">{t("embedEdit.label", { note })}</span>
          <textarea ref={area} dir="auto" value={draft} aria-label={t("embedEdit.label", { note })} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, Math.max(2, draft.split("\n").length + 1))} />
          <button type="button" onClick={() => void save()}>
            {t("embedEdit.save")}
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            {t("embedEdit.cancel")}
          </button>
        </span>
      )}
      <span role="status" className="lumen-embed-edit-status">
        {message}
      </span>
    </span>
  );
}
