/**
 * Tldraw-backed canvas — replaces the hand-rolled `CanvasWhiteboard.tsx`
 * (γ.2). Each canvas persists to OPFS at `canvases/<name>.tldr` (the
 * tldraw store snapshot serialised as JSON).
 *
 * Why tldraw vs custom HTML5 canvas:
 *   - Production-grade infinite canvas with pan / zoom / select / draw
 *   - Built-in shapes (sticky, text, geo, arrow, frame, image)
 *   - Multi-cursor, undo, redo, keyboard shortcuts — all free
 *   - Active maintenance + accessibility audited
 *
 * Persistence: the tldraw store fires a `listen()` callback on every
 * change. We debounce 500 ms and write `getSnapshot()` to OPFS. On
 * mount we read the file and `loadSnapshot()` if present.
 */

import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  type Editor as TldrawEditor,
} from "tldraw";
import "tldraw/tldraw.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { uiConfirm, uiPrompt } from "./PromptDialog";
import { showAiToast } from "./AiToast";
import { isOPFSAvailable } from "../storage/workspace";
import { t } from "../i18n";
import { log } from "../lib/logger";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CANVAS_DIR = "canvases";
const DEFAULT_CANVAS_NAME = "untitled";

/** Read the tldraw blob for a canvas. Returns null when the file isn't there. */
async function loadCanvasFile(name: string): Promise<unknown | null> {
  if (!isOPFSAvailable()) return null;
  // Read what was last asked to be written, not what was there before a write still in flight.
  await afterCanvasWrites(name);
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
    const file = await dir.getFileHandle(`${name}.tldr`);
    const blob = await file.getFile();
    const text = await blob.text();
    return JSON.parse(text);
  } catch (err) {
    // why: only a missing file means a blank canvas; an unreadable one must not be overwritten
    if ((err as { name?: string } | null)?.name === "NotFoundError") return null;
    throw err;
  }
}

/** The last write to each canvas file: writes to one file run in the order they were asked for. */
const canvasWrites = new Map<string, Promise<void>>();

/**
 * Queue `write` after every earlier write to the same canvas, so a late
 * flush of the old drawing can never land after the blank page that
 * replaces it. Exported for tests.
 */
export function queueCanvasWrite(name: string, write: () => Promise<void>): Promise<void> {
  const prev = canvasWrites.get(name) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(write);
  canvasWrites.set(name, next);
  void next.finally(() => {
    if (canvasWrites.get(name) === next) canvasWrites.delete(name);
  }).catch(() => undefined);
  return next;
}

/** Resolves once every write already queued for this canvas has settled (failed ones included). Exported for tests. */
export function afterCanvasWrites(name: string): Promise<void> {
  return (canvasWrites.get(name) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
}

function saveCanvasFile(name: string, snapshot: unknown): Promise<void> {
  return queueCanvasWrite(name, () => writeCanvasFile(name, snapshot));
}

async function writeCanvasFile(name: string, snapshot: unknown): Promise<void> {
  if (!isOPFSAvailable()) return;
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
  const file = await dir.getFileHandle(`${name}.tldr`, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(JSON.stringify(snapshot));
  } finally {
    await writable.close();
  }
}

/** Is there a saved canvas with this name on disk right now? (The picker's list may not have loaded yet.) Exported for tests. */
export async function canvasFileExists(name: string): Promise<boolean> {
  if (!isOPFSAvailable()) return false;
  await afterCanvasWrites(name);
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
    await dir.getFileHandle(`${name}.tldr`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore a saved snapshot unless the user edited the canvas while it was
 * loading: a stroke drawn during a slow read must not be replaced by the file
 * (nor saved over by it). Exported for tests.
 */
export async function restoreUnlessEdited(o: {
  listenUserEdits: (onEdit: () => void) => () => void;
  load: () => Promise<unknown | null>;
  apply: (snapshot: unknown) => void;
  cancelled: () => boolean;
}): Promise<"applied" | "edited" | "empty" | "cancelled"> {
  let edited = false;
  const off = o.listenUserEdits(() => {
    edited = true;
  });
  try {
    const snap = await o.load();
    if (o.cancelled()) return "cancelled";
    if (edited) return "edited";
    if (!snap) return "empty";
    o.apply(snap);
    return "applied";
  } finally {
    off();
  }
}

/**
 * Switch the shared editor to a canvas without ever mixing two drawings: the
 * editor is read-only and the canvas's saver is held (`lock`) until the saved
 * snapshot is in, so neither a stroke nor a camera-move save can write the
 * previous canvas's drawing under the new name. A canvas with no saved file
 * starts blank; one whose file cannot be read stays read-only, so nothing
 * overwrites it. Exported for tests.
 */
export async function switchCanvas(o: {
  name: string;
  lock: { current: string | null };
  setReadonly: (readonly: boolean) => void;
  restore: () => Promise<"applied" | "edited" | "empty" | "cancelled">;
  clear: () => void;
  cancelled: () => boolean;
  onUnreadable: (err: unknown) => void;
}): Promise<"applied" | "edited" | "empty" | "cancelled" | "unreadable"> {
  o.lock.current = o.name;
  o.setReadonly(true);
  let result: "applied" | "edited" | "empty" | "cancelled";
  try {
    result = await o.restore();
  } catch (err) {
    if (o.cancelled()) return "cancelled";
    // stays read-only with the saver held: saving now would overwrite the file we could not read
    o.onUnreadable(err);
    return "unreadable";
  }
  // a newer switch owns the lock and the read-only state now
  if (o.cancelled() || result === "cancelled") return "cancelled";
  if (o.lock.current === o.name) o.lock.current = null;
  o.setReadonly(false);
  if (result === "empty") o.clear();
  return result;
}

async function listCanvases(): Promise<string[]> {
  if (!isOPFSAvailable()) return [];
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
    const out: string[] = [];
    // FileSystemDirectoryHandle is async-iterable in Chrome / Safari 17+.
    for await (const [entryName] of (dir as unknown as AsyncIterable<[string]>)) {
      if (entryName.endsWith(".tldr")) out.push(entryName.replace(/\.tldr$/, ""));
    }
    return out.sort();
  } catch {
    return [];
  }
}

/**
 * Find legacy `.canvas.json` files (the pre-tldraw custom format) so
 * users can convert old work without losing layout + connections.
 */
async function listLegacyCanvases(): Promise<string[]> {
  if (!isOPFSAvailable()) return [];
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
    const out: string[] = [];
    for await (const [entryName] of (dir as unknown as AsyncIterable<[string]>)) {
      if (entryName.endsWith(".canvas.json")) {
        out.push(entryName.replace(/\.canvas\.json$/, ""));
      }
    }
    return out.sort();
  } catch {
    return [];
  }
}

/**
 * Convert a legacy custom-canvas file to a tldraw `.tldr` snapshot.
 *
 * Legacy format: `{ nodes: [{x,y,width,height,content,color}], edges: [...] }`.
 * Each node becomes a tldraw `note` shape preserving position + content
 * preview. Conversion is lossy (markdown bodies → plain text) but the
 * layout — the expensive thing — is preserved.
 */
async function convertLegacyCanvas(
  name: string,
): Promise<{ converted: boolean; nodeCount: number }> {
  if (!isOPFSAvailable()) return { converted: false, nodeCount: 0 };
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(CANVAS_DIR, { create: true });
  const legacyHandle = await dir.getFileHandle(`${name}.canvas.json`);
  const text = await (await legacyHandle.getFile()).text();
  const data = JSON.parse(text) as {
    nodes?: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      content: string;
    }>;
  };
  const docId = "document:document";
  const pageId = "page:legacy";
  const records: Record<string, unknown> = {
    [docId]: { id: docId, typeName: "document", gridSize: 10, name: "" },
    [pageId]: {
      id: pageId,
      typeName: "page",
      name: "Legacy",
      index: "a1",
      meta: {},
    },
  };
  let nodeCount = 0;
  for (const n of data.nodes ?? []) {
    const sid = `shape:legacy-${n.id}`;
    records[sid] = {
      id: sid,
      typeName: "shape",
      type: "note",
      x: n.x,
      y: n.y,
      props: {
        color: "blue",
        size: "m",
        text: (n.content ?? "").slice(0, 240),
        font: "draw",
      },
      parentId: pageId,
      isLocked: false,
      rotation: 0,
      index: "a1",
      opacity: 1,
      meta: {},
    };
    nodeCount++;
  }
  const snapshot = { store: records, schema: { schemaVersion: 2 } };
  const tldr = await dir.getFileHandle(`${name}.tldr`, { create: true });
  const writable = await tldr.createWritable();
  try {
    await writable.write(JSON.stringify(snapshot));
  } finally {
    await writable.close();
  }
  return { converted: true, nodeCount };
}

// Re-export for tests.
export { convertLegacyCanvas, listLegacyCanvases };

/**
 * A debounced save that can be flushed: closing the canvas (unmount) or
 * switching to another one writes the pending change instead of dropping it.
 * @internal exported for tests.
 */
export function debouncedSave(save: () => void, ms: number): { schedule(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save();
      }, ms);
    },
    flush() {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
      save();
    },
  };
}

/**
 * Save a canvas on every store change (debounced) until `detach()`, which
 * writes any pending change and stops listening — once. Changes made after
 * detach (clearing the editor for a new canvas) never reach this canvas's
 * file. Exported for tests.
 */
export function bindCanvasSaver(
  listen: (onChange: () => void) => () => void,
  save: () => void,
  ms: number,
  opts: { fresh?: boolean } = {},
): { detach(): void } {
  const saver = debouncedSave(save, ms);
  const off = listen(() => saver.schedule());
  // A canvas New just cleared: save it now, even if nothing is drawn before close.
  if (opts.fresh) save();
  let detached = false;
  return {
    detach() {
      if (detached) return;
      detached = true;
      off();
      saver.flush();
    },
  };
}

/**
 * New canvas, in the order that loses nothing: confirm before replacing a
 * canvas that already has that name, save and stop the current canvas's
 * saver, then clear the editor. Nothing is awaited between the clear and the
 * caller re-binding the saver, so a stroke drawn right after New is never
 * missed; the re-bound saver writes the (blank) page at once (`fresh`), and
 * writes to one file are queued (`queueCanvasWrite`), so the old canvas's
 * flush cannot land after it. Returns false when the user kept the existing
 * canvas. Exported for tests.
 */
export async function startNewCanvas(o: {
  name: string;
  exists: boolean;
  confirmReplace: (name: string) => Promise<boolean>;
  detach: () => void;
  clear: () => void;
}): Promise<boolean> {
  if (o.exists && !(await o.confirmReplace(o.name))) return false;
  o.detach();
  o.clear();
  return true;
}

export function CanvasTldraw({ open, onClose }: Props) {
  const [editor, setEditor] = useState<TldrawEditor | null>(null);
  const [canvasName, setCanvasName] = useState<string>(DEFAULT_CANVAS_NAME);
  const [savedList, setSavedList] = useState<string[]>([]);
  const [legacyList, setLegacyList] = useState<string[]>([]);
  const [converting, setConverting] = useState<string | null>(null);
  /** Bumped by New so the saver re-binds even when the name did not change. */
  const [saverEpoch, setSaverEpoch] = useState(0);
  /** Stops the current canvas's saver (flushing it); New calls it before clearing the editor. */
  const detachSaver = useRef<(() => void) | null>(null);
  /** The canvas New just cleared: not restored from its (replaced) file, saved as soon as the saver binds. */
  const freshCanvas = useRef<string | null>(null);
  /** The canvas being restored: its saver writes nothing until the restore is in (see switchCanvas). */
  const restoring = useRef<string | null>(null);

  // Load the canvas list (and any legacy `.canvas.json` files) on open
  // so the picker shows everything the user has + a convert affordance.
  useEffect(() => {
    if (!open) return;
    void listCanvases().then(setSavedList);
    void listLegacyCanvases().then(setLegacyList);
  }, [open]);

  // When the editor mounts (or canvas name changes), restore from OPFS.
  useEffect(() => {
    if (!editor) return;
    // why: New cleared this canvas on purpose; loading its old file would bring back the drawing it replaces
    if (freshCanvas.current === canvasName) return;
    let cancelled = false;
    void switchCanvas({
      name: canvasName,
      lock: restoring,
      setReadonly: (readonly) => editor.updateInstanceState({ isReadonly: readonly }),
      restore: () =>
        restoreUnlessEdited({
          // only the user's own document edits count (not camera moves or the load itself)
          listenUserEdits: (onEdit) => editor.store.listen(onEdit, { source: "user", scope: "document" }),
          load: () => loadCanvasFile(canvasName),
          apply: (snap) => {
            try {
              loadSnapshot(editor.store, snap as Parameters<typeof loadSnapshot>[1]);
            } catch (err) {
              log.warn("tldraw loadSnapshot failed", err);
            }
          },
          cancelled: () => cancelled,
        }),
      clear: () => {
        editor.selectAll();
        editor.deleteShapes(editor.getSelectedShapeIds());
      },
      cancelled: () => cancelled,
      onUnreadable: (err) => {
        log.warn("tldraw canvas read failed", err);
        showAiToast(t("canvas.unreadable", { name: canvasName }), "error");
      },
    });
    return () => {
      cancelled = true;
    };
  }, [editor, canvasName]);

  // Subscribe to store changes; debounced save.
  useEffect(() => {
    if (!editor) return;
    let lastWrite: Promise<void> = Promise.resolve();
    const fresh = freshCanvas.current === canvasName;
    const binding = bindCanvasSaver(
      (onChange) => editor.store.listen(onChange),
      () => {
        // why: until this canvas's snapshot is restored the editor still shows the previous one
        if (restoring.current === canvasName) return;
        try {
          const snap = getSnapshot(editor.store);
          lastWrite = saveCanvasFile(canvasName, snap).catch((err) => log.warn("tldraw save failed", err));
        } catch (err) {
          log.warn("tldraw getSnapshot failed", err);
        }
      },
      500,
      { fresh },
    );
    // The blank page is on disk: from now on the file is this canvas (kept until then, so a re-run of the restore effect still skips it).
    if (fresh) void lastWrite.finally(() => {
      if (freshCanvas.current === canvasName) freshCanvas.current = null;
    });
    detachSaver.current = () => binding.detach();
    return () => {
      binding.detach(); // the last strokes before close / canvas switch
      if (detachSaver.current) detachSaver.current = null;
    };
  }, [editor, canvasName, saverEpoch]);

  const handleNew = useCallback(async () => {
    const name = await uiPrompt({
      message: t("canvas.new.prompt") ?? "Canvas name:",
      defaultValue: `canvas-${Date.now().toString(36)}`,
    });
    if (!name) return;
    const trimmed = name.trim().replace(/[/\\]/g, "-");
    if (!trimmed) return;
    if (editor) {
      // Ask the disk, not only the picker's list: it may not have loaded yet when New was clicked.
      const exists = trimmed === canvasName || savedList.includes(trimmed) || (await canvasFileExists(trimmed));
      // Save the old canvas and stop its saver before clearing: clearing the
      // editor while it still listens would write the empty page over the old file.
      const ok = await startNewCanvas({
        name: trimmed,
        exists,
        confirmReplace: (n) =>
          uiConfirm({
            title: t("canvas.new.replaceTitle"),
            message: t("canvas.new.replaceBody", { name: n }),
            okLabel: t("canvas.new.replaceOk"),
          }),
        detach: () => detachSaver.current?.(),
        clear: () => {
          editor.selectAll();
          editor.deleteShapes(editor.getSelectedShapeIds());
        },
      });
      if (!ok) return;
      freshCanvas.current = trimmed;
    }
    setCanvasName(trimmed);
    // why: New with the current name changes no state, so without this the detached saver is never replaced
    setSaverEpoch((n) => n + 1);
    setSavedList((prev) => Array.from(new Set([...prev, trimmed])).sort());
  }, [editor, canvasName, savedList]);

  const handlePick = useCallback((name: string) => {
    // why: a pending "fresh" mark would make a later reselect skip the restore and save the other canvas's drawing under this name
    freshCanvas.current = null;
    setCanvasName(name);
  }, []);

  const handleConvertLegacy = useCallback(
    async (legacyName: string) => {
      setConverting(legacyName);
      try {
        const { nodeCount } = await convertLegacyCanvas(legacyName);
        // Refresh both lists; switch to the converted canvas.
        const [tldrs, legacies] = await Promise.all([
          listCanvases(),
          listLegacyCanvases(),
        ]);
        setSavedList(tldrs);
        setLegacyList(legacies);
        freshCanvas.current = null;
        setCanvasName(legacyName);
        showAiToast(
          t("canvas.legacy.converted", { name: legacyName, count: String(nodeCount) }),
          "success",
        );
      } catch (err) {
        log.error("legacy canvas convert failed", err);
        showAiToast(
          t("canvas.legacy.convertFailed", { error: (err as Error).message }),
          "error",
        );
      } finally {
        setConverting(null);
      }
    },
    [],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.dialogLabel") ?? "Whiteboard"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        background: "hsl(var(--bg))",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid hsl(var(--border))",
          background: "hsl(var(--bg-subtle))",
        }}
      >
        <strong style={{ fontSize: 13 }}>{t("canvas.title") ?? "Canvas"}</strong>
        <select
          value={canvasName}
          onChange={(e) => handlePick(e.target.value)}
          aria-label={t("canvas.picker") ?? "Pick canvas"}
          style={{
            padding: "3px 6px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--bg))",
            color: "hsl(var(--fg))",
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          {!savedList.includes(canvasName) && (
            <option value={canvasName}>{canvasName} (unsaved)</option>
          )}
          {savedList.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleNew}
          style={{
            padding: "3px 9px",
            fontSize: 12,
            border: "1px solid hsl(var(--accent))",
            background: "transparent",
            color: "hsl(var(--accent))",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          + {t("canvas.new") ?? "New"}
        </button>
        {legacyList.length > 0 && (
          <details
            style={{
              fontSize: 11,
              color: "hsl(var(--fg-muted))",
            }}
          >
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              {t("canvas.legacy.found", { count: String(legacyList.length) })}
            </summary>
            <div
              style={{
                position: "absolute",
                background: "hsl(var(--bg))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                padding: 8,
                marginTop: 4,
                minWidth: 220,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 200,
              }}
            >
              {legacyList.map((legacy) => (
                <button
                  key={legacy}
                  type="button"
                  onClick={() => handleConvertLegacy(legacy)}
                  disabled={converting === legacy}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "start",
                    padding: "4px 8px",
                    margin: "2px 0",
                    border: "none",
                    background: "transparent",
                    color: "hsl(var(--fg))",
                    fontSize: 12,
                    cursor: "pointer",
                    borderRadius: 4,
                  }}
                >
                  {converting === legacy
                    ? t("canvas.legacy.converting", { name: legacy })
                    : t("canvas.legacy.convert", { name: legacy })}
                </button>
              ))}
            </div>
          </details>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
          {t("canvas.autoSaved")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("canvas.close") ?? "Close"}
          style={{
            padding: "3px 9px",
            fontSize: 12,
            border: "1px solid hsl(var(--border))",
            background: "transparent",
            color: "hsl(var(--fg))",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {t("canvas.close") ?? "Close"}
        </button>
      </div>

      {/* tldraw fills the rest */}
      <div style={{ flex: 1, position: "relative" }}>
        <Tldraw
          onMount={(ed) => setEditor(ed)}
          inferDarkMode
        />
      </div>
    </div>
  );
}
