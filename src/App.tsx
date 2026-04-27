import { useCommands } from "./commands/useCommands";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type { EditorHandle } from "./editor/Editor";

import { Toolbar } from "./ui/Toolbar";
import { Outline } from "./ui/Outline";
import { StatusBar } from "./ui/StatusBar";
import { ScrollProgress } from "./ui/ScrollProgress";
import { SearchReplace } from "./ui/SearchReplace";
const GraphView = lazy(() => import("./ui/GraphView").then(m => ({ default: m.GraphView })));
const CanvasWhiteboard = lazy(() => import("./ui/CanvasWhiteboard").then(m => ({ default: m.CanvasWhiteboard })));
const PluginGallery = lazy(() => import("./ui/PluginGallery").then(m => ({ default: m.PluginGallery })));
const VersionHistory = lazy(() => import("./ui/VersionHistory").then(m => ({ default: m.VersionHistory })));
const MarkdownTableEditor = lazy(() => import("./ui/MarkdownTableEditor").then(m => ({ default: m.MarkdownTableEditor })));
import { htmlToMarkdown } from "./storage/fileFormats";
import { wirePluginAPI, registerPlugin, unregisterPlugin, wordCountPlugin } from "./plugins/pluginSystem";
import { CommandPalette } from "./ui/CommandPalette";
import { AiFab } from "./ui/AiFab";
import { FileTree } from "./ui/FileTree";
import { SidebarResizer } from "./ui/SidebarResizer";
import { uiAlert, uiConfirm, uiPrompt } from "./ui/PromptDialog";
import { openInsertTextDialog } from "./ui/InsertTextDialog";
import { BacklinksPanel } from "./ui/BacklinksPanel";
import { SearchDialog } from "./ui/SearchDialog";
import { AiToastContainer, showAiToast } from "./ui/AiToast";
import { MobileKeyboardBar } from "./ui/MobileKeyboardBar";
import { TagsPanel } from "./ui/TagsPanel";
import { CommentsPanel, addCommentFromSelection } from "./ui/CommentsPanel";
import { AiInlinePromptOverlay } from "./ui/AiInlinePrompt";
import { useFileDragDrop } from "./hooks/useFileDragDrop";
import { useCollab } from "./hooks/useCollab";
import { useTauriMenu } from "./hooks/useTauriMenu";
import { EditorLayout } from "./layouts/EditorLayout";
import { useAppStore, applyTheme } from "./store/useStore";
import { applyLocale, t } from "./i18n";
import { openFileDialog, saveFile } from "./storage/fs";
import { exportToHtml } from "./storage/exportHtml";
import { getRecents, pushRecent, reopenRecent } from "./storage/recent";
import type { RecentFile } from "./storage/recent";
import {
  isOPFSAvailable,
  makeAssetName,
  readWorkspaceFile,
  uniqueWorkspaceName,
  writeWorkspaceBlob,
  writeWorkspaceFile,
} from "./storage/workspace";
import { WELCOME_DOC } from "./welcome";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { KeyboardShortcuts } from "./ui/KeyboardShortcuts";
import { FocusMode } from "./ui/FocusMode";
import { OnboardingTour } from "./ui/OnboardingTour";

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function App() {
  const doc = useAppStore((s) => s.doc);
  const setContent = useAppStore((s) => s.setContent);
  const setDoc = useAppStore((s) => s.setDoc);
  const markSaved = useAppStore((s) => s.markSaved);
  const mode = useAppStore((s) => s.mode);
  const theme = useAppStore((s) => s.theme);
  const showOutline = useAppStore((s) => s.showOutline);
  const showWorkspace = useAppStore((s) => s.showWorkspace);
  const locale = useAppStore((s) => s.locale);
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace);
  const showBacklinks = useAppStore((s) => s.showBacklinks);
  const vimEnabled = useAppStore((s) => s.vimEnabled);
  const spellCheck = useAppStore((s) => s.spellCheck);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const editorRef = useRef<EditorHandle | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tableEditorOpen, setTableEditorOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tagsPanelOpen, setTagsPanelOpen] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [recents, setRecents] = useState<RecentFile[]>([]);

  // ── Collaboration (extracted hook) ─────────────────────────────
  const { collab, collabPeers, handleStartCollab, handleStopCollab } = useCollab(doc.content);

  // Load recents on mount.
  useEffect(() => {
    getRecents().then(setRecents).catch(() => setRecents([]));
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Plugin system init
  useEffect(() => {
    wirePluginAPI({
      getContent: () => useAppStore.getState().doc.content,
      setContent: (s: string) => useAppStore.getState().setContent(s),
      getFileName: () => useAppStore.getState().doc.name,
      showToast: (msg: string) => showAiToast(msg, "info"),
    });
    registerPlugin(wordCountPlugin);
    return () => {
      unregisterPlugin(wordCountPlugin.id);
    };
  }, []);

  // Apply locale (sets <html lang dir>) on mount and on change.
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  // Seed the Welcome document on first launch
  useEffect(() => {
    if (!doc.content) {
      setDoc({ name: "Welcome.md", content: WELCOME_DOC, dirty: false });
    }
    // Show onboarding tour on first launch
    try {
      if (!localStorage.getItem("lumen-tour-done")) {
        setTimeout(() => setTourOpen(true), 1200);
      }
    } catch {
      /* storage may be denied in private browsing — onboarding silently skips */
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Beforeunload warning if dirty
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (doc.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [doc.dirty]);

  const handleOpen = useCallback(async () => {
    const file = await openFileDialog();
    if (!file) return;
    setDoc({
      name: file.name,
      content: file.content,
      handle: file.handle,
      dirty: false,
    });
    if (file.handle) {
      await pushRecent({ name: file.name, handle: file.handle });
      setRecents(await getRecents());
    }
  }, [setDoc]);

  const handleReopenRecent = useCallback(
    async (entry: RecentFile) => {
      const opened = await reopenRecent(entry);
      if (!opened) {
        await uiAlert({ message: t("doc.alert.reopenFailed") });
        return;
      }
      setDoc({
        name: opened.name,
        content: opened.content,
        handle: opened.handle,
        dirty: false,
      });
      await pushRecent({ name: opened.name, handle: opened.handle });
      setRecents(await getRecents());
    },
    [setDoc],
  );

  const handleSave = useCallback(
    async (saveAs = false) => {
      try {
        const next = await saveFile(
          { name: doc.name, content: doc.content, handle: doc.handle },
          { saveAs },
        );
        setDoc({
          name: next.name,
          content: next.content,
          handle: next.handle,
          dirty: false,
        });
        markSaved();
      } catch (err) {
        // User cancelled Save-As dialog or filesystem error
        if ((err as DOMException)?.name !== "AbortError") {
          await uiAlert({ message: t("doc.alert.saveFailed", { error: (err as Error).message }) });
        }
      }
    },
    [doc.name, doc.content, doc.handle, setDoc, markSaved],
  );

  const handleNew = useCallback(async () => {
    if (doc.dirty && !(await uiConfirm({ message: t("doc.confirm.discardUnsaved") }))) return;
    
    let baseName = `${t("doc.untitled")}.md`;
    if (await isOPFSAvailable()) {
      baseName = await uniqueWorkspaceName(baseName);
    }
    
    setDoc({
      name: baseName,
      content: `# ${baseName.replace(/\.md$/, "")}\n\n`,
      handle: undefined,
      dirty: false,
    });
  }, [doc.dirty, setDoc]);

  const handleExportHtml = useCallback(async () => {
    try {
      await exportToHtml(doc.content, doc.name);
    } catch (e) {
      await uiAlert({ message: t("doc.alert.exportFailed", { error: (e as Error).message }) });
    }
  }, [doc.content, doc.name]);

  const insertSnippet = useCallback((snippet: string) => {
    editorRef.current?.insertText(snippet);
  }, []);

  // ── Real-time collaboration (managed by useCollab hook) ──────────────

  /**
   * When the user pastes/drops an image into the editor, persist it under
   * OPFS as a `lumen-asset-*` file (so the workspace owns the asset) and
   * return the markdown link. Falls back to a data: URL when OPFS isn't
   * available.
   */
  const handleAddAsset = useCallback(async (file: File): Promise<string | null> => {
    if (!isOPFSAvailable()) return null;
    try {
      const name = makeAssetName(file.name);
      await writeWorkspaceBlob(name, file);
      window.dispatchEvent(new Event("lumen-workspace-changed"));
      return name;
    } catch {
      return null;
    }
  }, []);

  // Workspace: open a file from the file tree.
  const handleOpenFromWorkspace = useCallback(
    (name: string, content: string) => {
      setDoc({
        name,
        content,
        handle: undefined,
        workspaceName: name,
        dirty: false,
      });
    },
    [setDoc],
  );

  // Listen for `lumen-open-file` events fired by Database views, backlinks,
  // graph view, and any other component that knows a workspace path. Single
  // hub keeps the open path consistent (recents, dirty handling, etc).
  useEffect(() => {
    async function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      if (!detail?.path) return;
      try {
        const { readWorkspaceFile } = await import("./storage/workspace");
        const content = await readWorkspaceFile(detail.path);
        handleOpenFromWorkspace(detail.path, content);
      } catch {
        /* file moved/deleted — silently ignore */
      }
    }
    window.addEventListener("lumen-open-file", onOpen);
    return () => window.removeEventListener("lumen-open-file", onOpen);
  }, [handleOpenFromWorkspace]);

  // Workspace: when active file is renamed (in the tree), keep doc.name in sync.
  const handleActiveRenamed = useCallback(
    (newName: string) => {
      setDoc({ name: newName, workspaceName: newName, dirty: false });
    },
    [setDoc],
  );

  const handleActiveDeleted = useCallback(() => {
    setDoc({
      name: "Untitled.md",
      content: "",
      workspaceName: null,
      handle: undefined,
      dirty: false,
    });
  }, [setDoc]);

  // Save the current doc into the workspace as a fresh file.
  const handleSaveToWorkspace = useCallback(async () => {
    if (!isOPFSAvailable()) {
      await uiAlert({ message: t("doc.alert.workspaceUnavailable") });
      return;
    }
    const base = doc.name.replace(/\.[^./]+$/, "") + ".md";
    const name = await uniqueWorkspaceName(base);
    await writeWorkspaceFile(name, doc.content);
    setDoc({ name, workspaceName: name, handle: undefined, dirty: false });
    if (!showWorkspace) toggleWorkspace();
    window.dispatchEvent(new Event("lumen-workspace-changed"));
  }, [doc.name, doc.content, setDoc, showWorkspace, toggleWorkspace]);

  // Autosave the active workspace file as the user types (debounced).
  useEffect(() => {
    if (!doc.workspaceName) return;
    if (!doc.dirty) return;
    const name = doc.workspaceName;
    const content = doc.content;
    const timer = setTimeout(() => {
      writeWorkspaceFile(name, content)
        .then(() => {
          markSaved();
          window.dispatchEvent(new Event("lumen-workspace-changed"));
        })
        .catch(() => {
          /* swallow; will retry on next change */
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [doc.workspaceName, doc.content, doc.dirty, markSaved]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // ⇧⌘F → focus mode toggle (or workspace search if already in focus mode)
      if (e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (focusMode) {
          setFocusMode(false);
        } else {
          setFocusMode(true);
        }
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSave(e.shiftKey);
      } else if (e.key === "h" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFindReplaceOpen((v) => !v);
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        handleOpen();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleNew();
      } else if (e.key === "1") {
        e.preventDefault();
        useAppStore.getState().setMode("source");
      } else if (e.key === "2") {
        e.preventDefault();
        useAppStore.getState().setMode("split");
      } else if (e.key === "3") {
        e.preventDefault();
        useAppStore.getState().setMode("preview");
      } else if (e.key === "4") {
        e.preventDefault();
        useAppStore.getState().setMode("wysiwyg");
      } else if (e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.shiftKey && (e.key === "v" || e.key === "V")) {
        // ⌘⇧V — Smart Insert (paste anything → auto-detect → wrap).
        e.preventDefault();
        (async () => {
          const result = await openInsertTextDialog();
          if (!result) return;
          const cur = useAppStore.getState().doc.content;
          const setter = useAppStore.getState().setContent;
          if (result.mode === "replace") setter(result.markdown);
          else if (result.mode === "atCursor" && editorRef.current) {
            editorRef.current.insertText(result.markdown);
          } else {
            const trimmed = cur.endsWith("\n") ? cur : cur + "\n";
            setter(trimmed + (result.mode === "append" ? "\n" : "") + result.markdown);
          }
        })();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, handleSave, handleNew, focusMode]);

  // Auto-save: save dirty documents on interval
  const autoSave = useAppStore((s) => s.autoSave);
  const autoSaveInterval = useAppStore((s) => s.autoSaveInterval);
  useEffect(() => {
    if (!autoSave || !doc.dirty) return;
    const timer = setInterval(() => {
      if (useAppStore.getState().doc.dirty) {
        // Only auto-save if the file has a handle or workspace name
        const d = useAppStore.getState().doc;
        if (d.handle || d.workspaceName) {
          handleSave(false);
        }
      }
    }, autoSaveInterval);
    return () => clearInterval(timer);
  }, [autoSave, autoSaveInterval, doc.dirty, handleSave]);

  const { dragHover } = useFileDragDrop(setDoc);

  const pageView = useAppStore((s) => s.pageView);

  // Debounce preview rendering — keeps typing smooth for large docs
  const deferredContent = useDeferredValue(doc.content);

  const activeFile = doc.name;

  const commands = useCommands({
    handleNew, handleOpen, handleSave, handleExportHtml, handleSaveToWorkspace,
    insertSnippet, recents, setRecents, handleReopenRecent, collab,
    handleStartCollab, handleStopCollab,
    setSearchOpen, setFindReplaceOpen, setGraphOpen,
    setHistoryOpen, setTableEditorOpen, setCanvasOpen, setGalleryOpen,
    setTagsPanelOpen,
    setCommentsPanelOpen,
    onAddComment: collab
      ? async () => {
          const view = editorRef.current?.getView();
          if (!view) return;
          const { from, to } = view.state.selection.main;
          if (from === to) {
            await uiAlert({ message: "Select some text first to anchor the comment." });
            return;
          }
          const body = await uiPrompt({ message: "Comment:" });
          if (!body?.trim()) return;
          addCommentFromSelection(collab, body, from, to);
          setCommentsPanelOpen(true);
        }
      : undefined,
  });

  // Native Tauri menu wiring — no-op when running in a regular browser.
  useTauriMenu({
    onNew: handleNew,
    onOpen: handleOpen,
    onSave: handleSave,
    onInsertText: async () => {
      const result = await openInsertTextDialog();
      if (!result) return;
      const current = doc.content;
      if (result.mode === "replace") setContent(result.markdown);
      else if (result.mode === "atCursor" && editorRef.current) {
        editorRef.current.insertText(result.markdown);
      } else if (result.mode === "atCursor") {
        const trimmed = current.endsWith("\n") ? current : current + "\n";
        setContent(trimmed + result.markdown);
      } else setContent(current + (current.endsWith("\n") ? "" : "\n") + "\n" + result.markdown);
    },
    onCommandPalette: () => setPaletteOpen(true),
    onFocusMode: () => setFocusMode(true),
    onShortcuts: () => setShortcutsOpen(true),
    onTour: () => setTourOpen(true),
    onWorkspaceSearch: () => setSearchOpen(true),
    onFindReplace: () => setFindReplaceOpen(true),
    onToggleWorkspace: () => useAppStore.getState().toggleWorkspace(),
    onToggleOutline: () => useAppStore.getState().toggleOutline(),
    onToggleTheme: () => {
      const cur = useAppStore.getState().theme;
      useAppStore.getState().setTheme(cur === "dark" ? "light" : "dark");
    },
    onSetMode: (mode) => useAppStore.getState().setMode(mode),
    onExportHtml: () => commands.find((c) => c.id === "file.exportHtml")?.action(),
    onExportPdf: () => commands.find((c) => c.id === "file.exportPdf")?.action(),
    onPrint: () => commands.find((c) => c.id === "file.print")?.action(),
  });

  return (
    <div className="h-screen flex flex-col">
      <a href="#main" className="skip-link">
        {t("a11y.skipToContent")}
      </a>
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="aria-live-region"
        id="lumen-sr-announcer"
      />
      <Toolbar
        onOpen={handleOpen}
        onSave={handleSave}
        onNew={handleNew}
        onCommandPalette={() => setPaletteOpen(true)}
        onFocusMode={() => setFocusMode(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onTour={() => setTourOpen(true)}
        onShowWelcome={() => {
          // Restore the bundled welcome document — handy when the user wants
          // to revisit the feature tour without scrubbing recents for it.
          setDoc({
            name: "Welcome.md",
            content: WELCOME_DOC,
            handle: undefined,
            workspaceName: undefined,
            dirty: false,
          });
        }}
        commands={commands}
        onInsertText={async () => {
          const result = await openInsertTextDialog();
          if (!result) return;
          const current = doc.content;
          if (result.mode === "replace") {
            setContent(result.markdown);
          } else if (result.mode === "atCursor" && editorRef.current) {
            // Real cursor-aware insert via the Editor's exposed handle.
            editorRef.current.insertText(result.markdown);
          } else if (result.mode === "atCursor") {
            // Fallback when the editor isn't mounted (e.g. preview-only mode).
            const trimmed = current.endsWith("\n") ? current : current + "\n";
            setContent(trimmed + result.markdown);
          } else {
            setContent(current + (current.endsWith("\n") ? "" : "\n") + "\n" + result.markdown);
          }
          showAiToast(`✅ ${t("toast.insertText.success")}`, "info");
        }}
        onPasteText={async () => {
          const text = await uiPrompt({
            message: t("toast.pasteText.prompt"),
            placeholder: "<h1>Hello</h1>\n<p>Paste your HTML here...</p>",
          });
          if (!text) return;
          const md = text.trim().startsWith("<") ? htmlToMarkdown(text) : text;
          setContent(doc.content + "\n\n" + md);
          showAiToast(`✅ ${t("toast.pasteText.success")}`, "info");
        }}
      />
      <main id="main" className="flex-1 flex min-h-0 relative">
        <SearchReplace
          open={findReplaceOpen}
          onClose={() => setFindReplaceOpen(false)}
          content={doc.content}
          onChange={setContent}
        />
        {showWorkspace && (
          <>
            <FileTree
              activePath={doc.workspaceName ?? null}
              onOpenFile={handleOpenFromWorkspace}
              onActiveRenamed={handleActiveRenamed}
              onActiveDeleted={handleActiveDeleted}
            />
            <SidebarResizer />
          </>
        )}
        <EditorLayout
          mode={mode}
          docContent={doc.content}
          docName={doc.name}
          deferredContent={deferredContent}
          editorRef={editorRef}
          vimEnabled={vimEnabled}
          spellCheck={spellCheck}
          typewriterMode={typewriterMode}
          activeFile={activeFile}
          pageView={pageView}
          collab={collab}
          setContent={setContent}
          handleAddAsset={handleAddAsset}
        />
        {showOutline && <Outline markdownText={doc.content} />}
        {showBacklinks && (
          <BacklinksPanel
            filePath={doc.workspaceName ?? null}
            onOpen={async (fromPath) => {
              try {
                const content = await readWorkspaceFile(fromPath);
                setDoc({
                  name: fromPath.split("/").pop() ?? fromPath,
                  content,
                  handle: undefined,
                  workspaceName: fromPath,
                  dirty: false,
                });
                if (!showWorkspace) toggleWorkspace();
              } catch {
                /* missing file */
              }
            }}
          />
        )}
        {dragHover && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none animate-in"
            style={{
              background: "hsl(var(--accent) / 0.06)",
              border: "2px dashed hsl(var(--accent))",
              borderRadius: 12,
              margin: 12,
            }}
          >
            <div
              style={{
                background: "hsl(var(--bg))",
                padding: "1rem 1.5rem",
                borderRadius: 10,
                fontSize: 14,
                color: "hsl(var(--accent))",
                border: "1px solid hsl(var(--accent) / 0.3)",
                fontWeight: 600,
              }}
            >
              {t("dnd.dropHint")}
            </div>
          </div>
        )}
      </main>
      <StatusBar
        text={doc.content}
        dirty={doc.dirty}
        filename={doc.name}
        collab={
          collab
            ? {
                roomName: collab.roomName,
                peers: collabPeers,
                onLeave: handleStopCollab,
              }
            : null
        }
      />
      <ScrollProgress />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenFile={(path, content) => {
          setDoc({
            name: path.split("/").pop() ?? path,
            content,
            handle: undefined,
            workspaceName: path,
            dirty: false,
          });
          if (!showWorkspace) toggleWorkspace();
        }}
      />
      <AiToastContainer />
      <AiInlinePromptOverlay />
      <MobileKeyboardBar />
      <TagsPanel open={tagsPanelOpen} onClose={() => setTagsPanelOpen(false)} />
      {collab && (
        <CommentsPanel
          open={commentsPanelOpen}
          onClose={() => setCommentsPanelOpen(false)}
          collab={collab}
          onJump={(from, to) => {
            const view = editorRef.current?.getView();
            if (!view) return;
            view.focus();
            view.dispatch({
              selection: { anchor: from, head: to },
              effects: [],
              scrollIntoView: true,
            });
          }}
        />
      )}

      {/* Graph View overlay */}
      {graphOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "hsl(var(--bg))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>Knowledge Graph</h3>
            <button className="icon-btn" onClick={() => setGraphOpen(false)} style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}>Close</button>
          </div>
          <div style={{ height: "calc(100vh - 42px)" }}>
            <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>Loading graph…</div>}>
              <ErrorBoundary fallback={
                <div style={{ padding: "3rem", textAlign: "center", color: "hsl(0 80% 60%)" }}>
                  <strong>Graph Render Failed</strong>
                  <p>The workspace data resulted in an invalid node structure that crashed the renderer.</p>
                </div>
              }>
                <GraphView onOpenFile={(path, content) => {
                  setDoc({ name: path.split("/").pop() ?? path, content, handle: undefined, workspaceName: path, dirty: false });
                  setGraphOpen(false);
                }} />
              </ErrorBoundary>
            </Suspense>
          </div>
        </div>
      )}

      {/* Canvas Whiteboard overlay */}
      <Suspense fallback={null}>
        <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Component failed to load.</div>}>
          <CanvasWhiteboard open={canvasOpen} onClose={() => setCanvasOpen(false)} />
          <PluginGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />
        </ErrorBoundary>
      </Suspense>

      {/* Version History overlay */}
      {historyOpen && (
        <Suspense fallback={<div style={{padding:'2rem',color:'hsl(var(--fg-muted))'}}>Loading history…</div>}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Version history failed to load.</div>}>
            <VersionHistory
              fileName={doc.name}
              currentContent={doc.content}
              onRestore={(content) => setContent(content)}
              onClose={() => setHistoryOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Table Editor overlay */}
      {tableEditorOpen && (
        <Suspense fallback={null}>
          <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'hsl(0 80% 60%)' }}>Table editor failed to load.</div>}>
            <MarkdownTableEditor
              onUpdate={(md) => {
                const current = doc.content;
                setContent(current + "\n\n" + md + "\n");
              }}
              onClose={() => setTableEditorOpen(false)}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* Floating AI Prompts button — anchored next to the document body. */}
      <AiFab commands={commands} />

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Onboarding Tour */}
      <OnboardingTour open={tourOpen} onClose={() => {
        setTourOpen(false);
        try { localStorage.setItem("lumen-tour-done", "1"); } catch {
          /* storage denied — tour will simply replay next session */
        }
      }} />

      {/* Focus Mode overlay */}
      {focusMode && (
        <FocusMode active={focusMode} onExit={() => setFocusMode(false)}>
          <EditorLayout
            mode={mode}
            docContent={doc.content}
            docName={doc.name}
            deferredContent={deferredContent}
            editorRef={editorRef}
            vimEnabled={vimEnabled}
          spellCheck={spellCheck}
          typewriterMode={typewriterMode}
            activeFile={activeFile}
            pageView={pageView}
            collab={collab}
            setContent={setContent}
            handleAddAsset={handleAddAsset}
          />
        </FocusMode>
      )}
    </div>
  );
}
