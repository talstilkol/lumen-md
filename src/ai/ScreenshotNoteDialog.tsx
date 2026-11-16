/**
 * Screenshot to note from the app (plan W7.16, W10.C22): the image becomes
 * Markdown on this device (a local vision model, else on-device OCR:
 * screenshotToNote), and a preview shows it before anything is inserted —
 * the text, how it was read, and what the injection guard flagged. The user
 * can edit it, insert it, or cancel. Reached from the palette ("Screenshot
 * to note…", the image on the clipboard or a file) and from the toast after
 * an image is pasted into a note.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import "../ui/PromptDialog.css";
import "./screenshotNoteStrings";
import type { ScreenshotDeps, ScreenshotNote } from "./screenshotNote";
import { Modal } from "../ui/Modal";

export function ScreenshotNoteDialog({ run, onResolve }: { run: (signal: AbortSignal) => Promise<ScreenshotNote>; onResolve: (markdown: string | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState<ScreenshotNote | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = () => onResolve(null);
  useEffect(() => {
    const ac = new AbortController();
    run(ac.signal).then(
      (n) => {
        setNote(n);
        setText(n.markdown);
      },
      (e: unknown) => !ac.signal.aborted && setError(String((e as Error)?.message ?? e)),
    );
    return () => ac.abort();
  }, [run]);
  return (
    <Modal onClose={cancel} className="prompt-backdrop" aria-labelledby="shot-title" data-testid="screenshot-note">
      <div className="prompt-dialog" ref={ref} style={{ maxWidth: 640, width: "min(640px, 94vw)" }}>
        <div id="shot-title" className="prompt-title">
          {t("screenshotNote.title")}
        </div>
        {!note && !error && <p className="prompt-message">{t("screenshotNote.reading")}</p>}
        {error && (
          <p role="alert" className="prompt-message">
            {t("screenshotNote.failed", { error })}
          </p>
        )}
        {note && (
          <>
            <p className="prompt-message" data-testid="screenshot-note-source">
              {note.source === "vision" ? t("screenshotNote.byModel", { model: note.model ?? "" }) : t("screenshotNote.byOcr")}
            </p>
            {note.findings.length > 0 && (
              <p role="alert" data-testid="screenshot-note-findings" style={{ color: "hsl(var(--danger))", fontSize: 13 }}>
                {t("screenshotNote.flagged", { n: note.findings.length })}
              </p>
            )}
            <textarea aria-label={t("screenshotNote.text")} dir="auto" rows={12} value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} data-testid="screenshot-note-text" />
          </>
        )}
        <div className="prompt-actions">
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={cancel} data-testid="screenshot-note-cancel">
            {t("screenshotNote.cancel")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-ok" disabled={!note || !text.trim()} onClick={() => onResolve(text.trim())} data-testid="screenshot-note-insert">
            {t("screenshotNote.insert")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Read `image` into a note and ask; the Markdown to insert, or null. */
export function previewScreenshotNote(image: Blob, lang: string, deps?: ScreenshotDeps): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const run = async (signal: AbortSignal) => {
      const m = await import("./screenshotNote");
      return m.screenshotToNote(image, lang, deps ?? (await m.appScreenshotDeps()), signal);
    };
    root.render(
      <ScreenshotNoteDialog
        run={run}
        onResolve={(md) => {
          try {
            root.unmount();
          } catch {
            /* why: already unmounted */
          }
          host.remove();
          resolve(md);
        }}
      />,
    );
  });
}

/** The first image on the clipboard (navigator.clipboard.read), else null. */
export async function clipboardImage(clip: Pick<Clipboard, "read"> | undefined = typeof navigator !== "undefined" ? navigator.clipboard : undefined): Promise<Blob | null> {
  try {
    for (const item of (await clip?.read()) ?? []) {
      const type = item.types.find((x) => x.startsWith("image/"));
      if (type) return await item.getType(type);
    }
  } catch {
    // why: no clipboard permission, or no clipboard API (Firefox): the file picker is offered instead
    /* fall through */
  }
  return null;
}

/** Ask for an image file (the fallback when the clipboard has none). */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
