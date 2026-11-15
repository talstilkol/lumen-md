/**
 * Ink on PDF pages (plan 4.14, W10.E64): the reader's ink state, its strict
 * read from the companion note, the save in the reader's write queue, and the
 * toolbar buttons and page overlay. Split out of PdfReader.tsx (800-line rule).
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import { explainError, UserFacingError } from "../lib/userError";
import { InkLayer } from "./InkLayer";
import { inkPage, readInkNote, setPageStrokes, upsertInkNote, moveInk, type PdfInkAnnotation, type PdfInkStroke } from "./ink";
import { baseName, isMissing } from "./pdfReaderParts";

interface InkQueue {
  writeQueue: MutableRefObject<Promise<void>>;
  pendingWrites: MutableRefObject<number>;
  writeFailed: MutableRefObject<boolean>;
}

export function usePdfInk(path: string, notePath: string, { writeQueue, pendingWrites, writeFailed }: InkQueue) {
  const [ink, setInk] = useState<PdfInkAnnotation[]>([]);
  const inkRef = useRef<PdfInkAnnotation[]>([]);
  const [inkMode, setInkMode] = useState(false);

  /** The ink block, read as strictly as the highlights: a damaged one is shown as unreadable, never saved over. */
  const loadInk = useCallback(
    (note: string | null) => {
      const savedInk = readInkNote(note);
      if (!savedInk) throw new UserFacingError(t("pdf.inkUnreadable", { name: baseName(notePath) }));
      // After the PDF moved, the strokes are still its own: they take the new path (ids kept).
      inkRef.current = moveInk(savedInk, path);
      setInk(inkRef.current);
    },
    [path, notePath],
  );

  // One stroke more on `page`, or (undo) one less: saved in the note's ink region, in the same queue as the highlights.
  const persistInk = useCallback(
    (page: number, change: (strokes: PdfInkStroke[]) => PdfInkStroke[]) => {
      const pageStrokes = inkRef.current.find((a) => inkPage(a) === page)?.["lumen:strokes"] ?? [];
      const next = setPageStrokes(inkRef.current, path, page, change(pageStrokes));
      inkRef.current = next;
      setInk(next);
      pendingWrites.current++;
      const job = writeQueue.current.then(async () => {
        const [ws, { flushActiveWorkspaceDoc }, { notifyWorkspaceChanged }] = await Promise.all([import("../storage/workspace"), import("../store/openDocs"), import("../storage/workspaceEvents")]);
        await flushActiveWorkspaceDoc();
        let existing: string | null = null;
        try {
          existing = await ws.readWorkspaceFile(notePath);
        } catch (e) {
          if (!isMissing(e)) throw e;
        }
        if (existing !== null && !readInkNote(existing)) throw new UserFacingError(t("pdf.inkUnreadable", { name: baseName(notePath) }));
        await ws.writeWorkspaceFile(notePath, upsertInkNote(existing, next));
        const { useAppStore, tabIdOf } = await import("../store/useStore");
        const st = useAppStore.getState();
        if (st.doc.workspaceName === notePath) st.setDoc({ name: st.doc.name, content: upsertInkNote(st.doc.content, next), dirty: st.doc.dirty });
        const activeId = tabIdOf(useAppStore.getState().doc);
        useAppStore.setState((s) => ({ openTabs: s.openTabs.map((tab) => (tab.workspaceName === notePath && tab.id !== activeId ? { ...tab, content: upsertInkNote(tab.content, next) } : tab)) }));
        notifyWorkspaceChanged(existing === null ? { kind: "structure" } : { kind: "content", paths: [notePath] });
        writeFailed.current = false;
      });
      writeQueue.current = job
        .finally(() => {
          pendingWrites.current--;
        })
        .catch((e: unknown) => {
          writeFailed.current = true;
          showAiToast(t("pdf.saveFailed", { error: explainError(e) }), "error");
        });
    },
    [path, notePath, writeQueue, pendingWrites, writeFailed],
  );

  /** The Ink toggle and, while inking, Undo stroke for the current page. */
  const inkButtons = (current: number) => (
    <div className="pdf-group">
      <button type="button" className="icon-btn pdf-text-btn" aria-pressed={inkMode} onClick={() => setInkMode((v) => !v)} title={t("pdf.ink.hint")} data-testid="pdf-ink-toggle">
        {t("pdf.ink")}
      </button>
      {inkMode && (
        <button type="button" className="icon-btn pdf-text-btn" disabled={!ink.some((a) => inkPage(a) === current)} onClick={() => persistInk(current, (s) => s.slice(0, -1))} data-testid="pdf-ink-undo">
          {t("pdf.ink.undo")}
        </button>
      )}
    </div>
  );

  /** The ink layer over page `page` (1-based) while inking or when it has strokes. */
  const inkOverlay = (page: number, width: number, height: number) =>
    inkMode || ink.some((a) => inkPage(a) === page) ? (
      <InkLayer
        strokes={ink.find((a) => inkPage(a) === page)?.["lumen:strokes"] ?? []}
        width={width}
        height={height}
        drawing={inkMode}
        color="#d03b3b"
        size={0.004}
        label={t("pdf.ink.layer", { n: page })}
        onStroke={(stroke) => persistInk(page, (s) => [...s, stroke])}
      />
    ) : undefined;

  return { loadInk, inkButtons, inkOverlay };
}
