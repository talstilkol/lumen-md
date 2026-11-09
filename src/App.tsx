import { useCommands } from "./commands/useCommands";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { EditorHandle } from "./editor/Editor";

import { Toolbar } from "./ui/Toolbar";
import { Outline } from "./ui/Outline";
import { StatusBar } from "./ui/StatusBar";
import { ScrollProgress } from "./ui/ScrollProgress";
import { SearchReplace } from "./ui/SearchReplace";
import { htmlToMarkdown } from "./storage/fileFormats";
import { CommandPalette } from "./ui/CommandPalette";
import { FileTree } from "./ui/FileTree";
import { SidebarResizer } from "./ui/SidebarResizer";
import { uiAlert, uiConfirm, uiPrompt } from "./ui/PromptDialog";
import { openInsertTextDialog } from "./ui/InsertTextDialog";
import { BacklinksPanel } from "./ui/BacklinksPanel";
// SearchDialog imports the CodeMirror search-highlight extension; lazy so
// the boot path stays CodeMirror-free (the dialog opens on ⌘⇧F).
const SearchDialog = lazy(() =>
  import("./ui/SearchDialog").then((m) => ({ default: m.SearchDialog })),
);
import { AiToastContainer, showAiToast } from "./ui/AiToast";
import { AiSuggestionsPanel } from "./ui/AiSuggestionsPanel";
import { MobileKeyboardBar } from "./ui/MobileKeyboardBar";
import { TagsPanel } from "./ui/TagsPanel";
// CommentsPanel pulls collab/comments.ts → yjs; comments only exist inside a
// collab session, so the panel is lazy and addCommentFromSelection is
// imported at the call site to keep yjs off the boot path.
const CommentsPanel = lazy(() =>
  import("./ui/CommentsPanel").then((m) => ({ default: m.CommentsPanel })),
);
import { DocTabs, tabId } from "./ui/DocTabs";
import { AiInlinePromptOverlay } from "./ui/AiInlinePrompt";
import { useFileDragDrop } from "./hooks/useFileDragDrop";
import { useCollab } from "./hooks/useCollab";
import { useTauriMenu } from "./hooks/useTauriMenu";
import { useAppStartup } from "./hooks/useAppStartup";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useBackgroundSaves } from "./hooks/useBackgroundSaves";
import { useAppWindowEvents } from "./hooks/useAppWindowEvents";
import { AppOverlays } from "./ui/AppOverlays";
import { EditorLayout } from "./layouts/EditorLayout";
import { useAuth } from "./auth/useAuth";
import { docIdentity } from "./renderer/previewDoc";
import { useEntitlement, watchAuthForEntitlements } from "./billing/useEntitlement";
import { useAppStore } from "./store/useStore";
import { t } from "./i18n";
import { localLlmAvailable } from "./ai/localLlm";
import { assessConfigHealth } from "./lib/configHealth";
import { historyKey, isQuotaError, onHistoryQuota, recordSnapshot } from "./storage/history";
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
import { welcomeDoc } from "./welcomeDoc";
import { FocusMode } from "./ui/FocusMode";
import { scrollToHeadingWhenRendered } from "./renderer/wikiLinks";
import { notifyWorkspaceChanged } from "./storage/workspaceEvents";

export default function App() {
  const doc = useAppStore((s) => s.doc);
  const setContent = useAppStore((s) => s.setContent);
  const setDoc = useAppStore((s) => s.setDoc);
  const markSaved = useAppStore((s) => s.markSaved);
  const adoptWorkspaceName = useAppStore((s) => s.adoptWorkspaceName);
  const openTabs = useAppStore((s) => s.openTabs);
  const openTabAction = useAppStore((s) => s.openTab);
  const closeTabAction = useAppStore((s) => s.closeTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const mode = useAppStore((s) => s.mode);
  const theme = useAppStore((s) => s.theme);
  const showOutline = useAppStore((s) => s.showOutline);
  const showWorkspace = useAppStore((s) => s.showWorkspace);
  const locale = useAppStore((s) => s.locale);
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace);
  const showBacklinks = useAppStore((s) => s.showBacklinks);
  const vimEnabled = useAppStore((s) => s.vimEnabled);
  const spellCheck = useAppStore((s) => s.spellCheck);
  const grammarCheck = useAppStore((s) => s.grammarCheck);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const suggestingMode = useAppStore((s) => s.suggestingMode);
  const aiKey = useAppStore((s) => s.aiKey);
  const useLocalAi = useAppStore((s) => s.useLocalAi);
  const editorRef = useRef<EditorHandle | null>(null);
  const authStatus = useAuth((s) => s.status);
  const authProviderName = useAuth((s) => s.provider.name);
  const authError = useAuth((s) => s.error);
  const authUserId = useAuth((s) => s.user?.id);
  const authOrgId = useAuth((s) => s.user?.orgId);
  const entitlementLoading = useEntitlement((s) => s.loading);
  const entitlement = useEntitlement((s) => s.entitlement);
  const capabilitiesCloudSync = useEntitlement((s) => s.capabilities.cloudSync);
  const hasWebGPU = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return localLlmAvailable().available;
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (searchOpen) setSearchMounted(true);
  }, [searchOpen]);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tableEditorOpen, setTableEditorOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [trustedKeysOpen, setTrustedKeysOpen] = useState(false);
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiDoctorOpen, setAiDoctorOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // The search dialog loads on first open and then stays mounted, so an
  // Ask Workspace conversation survives closing it (perf: not at startup).
  const [searchMounted, setSearchMounted] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [tagsPanelOpen, setTagsPanelOpen] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [runtimeMetricsOpen, setRuntimeMetricsOpen] = useState(false);
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

  useEffect(() => {
    void useEntitlement.getState().refresh();
    // Re-fetch when the user signs in/out or the session restore finishes.
    return watchAuthForEntitlements();
  }, []);

  // Theme, locale, plugins, launches from the installed app, first-run Welcome + tour.
  useAppStartup({ theme, locale, doc, openTabs, openTabAction, setPaletteOpen, setTourOpen });

  const configHealth = useMemo(
    () =>
      assessConfigHealth({
        authStatus,
        authProviderName,
        authError,
        userId: authUserId,
        entitlementLoading,
        entitlement,
        capabilitiesCloudSync,
        aiKey,
        useLocalAi,
        hasWebGPU,
      }),
    [
      authStatus,
      authProviderName,
      authError,
      authUserId,
      entitlementLoading,
      entitlement,
      capabilitiesCloudSync,
      aiKey,
      useLocalAi,
      hasWebGPU,
    ],
  );

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
        void recordSnapshot(historyKey({ name: next.name, workspaceName: useAppStore.getState().doc.workspaceName }), next.content, "save").catch(() => false);
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

  // Workspace: open a file from the file tree. Routed through `openTab` so
  // re-opening an already-active doc just focuses its tab without losing
  // unsaved edits in the previous one.
  const handleOpenFromWorkspace = useCallback(
    (name: string, content: string) => {
      openTabAction({ name, content, workspaceName: name });
    },
    [openTabAction],
  );

  // Listen for `lumen-open-file` events fired by Database views, backlinks,
  // graph view, and any other component that knows a workspace path. Single
  // hub keeps the open path consistent (recents, dirty handling, etc).
  useEffect(() => {
    async function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ path: string; heading?: string }>).detail;
      if (!detail?.path) return;
      try {
        const { readWorkspaceFile } = await import("./storage/workspace");
        const content = await readWorkspaceFile(detail.path);
        handleOpenFromWorkspace(detail.path, content);
        // `[[Note#Heading]]`: scroll to the heading (by its slug id) once the
        // opened note has rendered.
        if (detail.heading) {
          scrollToHeadingWhenRendered(detail.heading, { docKey: docIdentity(useAppStore.getState().doc) ?? undefined });
        }
      } catch {
        /* why: the file was moved or deleted since the link was made; the click does nothing */
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
      name: `${t("doc.untitled")}.md`,
      content: "",
      workspaceName: null,
      handle: undefined,
      dirty: false,
    });
  }, [setDoc]);

  // Write the active ad-hoc document (no disk handle, not in the
  // workspace) into the workspace under a free name derived from its own,
  // and switch the document and its tab to that identity. Shared by the
  // explicit "save to workspace" command and by autosave.
  const adoptIntoWorkspace = useCallback(async (): Promise<string | null> => {
    const d = useAppStore.getState().doc;
    if (!isOPFSAvailable()) return null;
    const base = d.name.replace(/\.[^./]+$/, "") + ".md";
    const name = await uniqueWorkspaceName(base);
    await writeWorkspaceFile(name, d.content);
    adoptWorkspaceName(name);
    window.dispatchEvent(new Event("lumen-workspace-changed"));
    return name;
  }, [adoptWorkspaceName]);

  // Save the current doc into the workspace as a fresh file.
  const handleSaveToWorkspace = useCallback(async () => {
    if (!isOPFSAvailable()) {
      await uiAlert({ message: t("doc.alert.workspaceUnavailable") });
      return;
    }
    await adoptIntoWorkspace();
    if (!showWorkspace) toggleWorkspace();
  }, [adoptIntoWorkspace, showWorkspace, toggleWorkspace]);

  // Autosave the active workspace file as the user types (debounced).
  useEffect(() => {
    if (!doc.workspaceName) return;
    if (!doc.dirty) return;
    const name = doc.workspaceName;
    const content = doc.content;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const write = (attempt: number) => {
      writeWorkspaceFile(name, content)
        .then(() => {
          markSaved();
          // Only this file's text changed: listeners skip the full rescan (C3).
          notifyWorkspaceChanged({ kind: "content", paths: [name] });
          // Every save path feeds the one history store (T35).
          void recordSnapshot(name, content, "autosave").catch(() => false);
        })
        .catch((err: unknown) => {
          // A failed write used to vanish silently. Say so once, retry
          // with back-off; the localStorage mirror still holds the text.
          if (attempt === 0) showAiToast(t(isQuotaError(err) ? "doc.save.quota" : "doc.save.failedRetrying", { name }), "error");
          if (attempt < 4) retry = setTimeout(() => write(attempt + 1), 2000 * 2 ** attempt);
        });
    };
    const timer = setTimeout(() => write(0), 600);
    return () => {
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
    };
  }, [doc.workspaceName, doc.content, doc.dirty, markSaved]);

  // History quota: the store pruned its oldest quarter and still could not write.
  useEffect(() => onHistoryQuota(() => showAiToast(t("doc.history.quota"), "error")), []);

  // Keyboard shortcuts
  useAppShortcuts({
    focusMode, setFocusMode, setPaletteOpen, setFindReplaceOpen, setShortcutsOpen,
    handleOpen, handleSave, handleNew, editorRef,
  });

  // Interval auto-save, and the flush of the pending write when the page goes away.
  useBackgroundSaves({ doc, handleSave, adoptIntoWorkspace, markSaved });

  const { dragHover } = useFileDragDrop(setDoc);

  const pageView = useAppStore((s) => s.pageView);

  // Debounce preview rendering — keeps typing smooth for large docs. The
  // document identity is deferred together with its text so the preview
  // never pairs one document's markdown with another's identity.
  const currentDocKey = docIdentity(doc);
  const previewSource = useMemo(
    () => ({ content: doc.content, docKey: currentDocKey }),
    [doc.content, currentDocKey],
  );
  const deferredPreview = useDeferredValue(previewSource);
  const deferredContent = deferredPreview.content;

  const activeFile = doc.name;

  const commands = useCommands({
    handleNew, handleOpen, handleSave, handleExportHtml, handleSaveToWorkspace,
    insertSnippet, recents, setRecents, handleReopenRecent, collab,
    handleStartCollab, handleStopCollab,
    setSearchOpen, setFindReplaceOpen, setGraphOpen,
    setHistoryOpen, setTableEditorOpen, setCanvasOpen, setGalleryOpen,
    setTemplateGalleryOpen,
    setAuditLogOpen,
    setOrgSettingsOpen,
    setTrustedKeysOpen,
    setThemeSettingsOpen,
    setFineTuneOpen,
    setTagsPanelOpen,
    setCommentsPanelOpen,
    setRuntimeMetricsOpen,
    getEditorView: () => editorRef.current?.getView() ?? null,
    onAddComment: collab
      ? async () => {
          const view = editorRef.current?.getView();
          if (!view) return;
          const { from, to } = view.state.selection.main;
          if (from === to) {
            await uiAlert({ message: t("comment.selectTextFirst") });
            return;
          }
          const body = await uiPrompt({ message: t("comment.promptLabel") });
          if (!body?.trim()) return;
          const { addCommentFromSelection } = await import("./ui/CommentsPanel");
          addCommentFromSelection(collab, body, from, to);
          setCommentsPanelOpen(true);
        }
      : undefined,
  });

  // Window events from other parts of the app (run a command, open a panel).
  useAppWindowEvents({ commands, setAiSettingsOpen, setPrivacyOpen, setTrashOpen, setAiDoctorOpen, setCommentsPanelOpen });

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
            content: welcomeDoc(),
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
        {/* minHeight:0 is load-bearing: without it this flex item refuses to
            shrink below its content (flex min-height:auto), the editor and
            preview sections inflate to the full document height, their inner
            scrollers never overflow, and pane scrolling + scroll-sync go
            dead — the whole page scrolls as one block instead. */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <DocTabs
            tabs={openTabs.map((t) => ({
              id: t.id,
              name: t.name,
              dirty: t.dirty,
            }))}
            activeId={tabId(doc)}
            onSelect={(id) => {
              const target = openTabs.find((t) => t.id === id);
              if (!target) return;
              openTabAction({
                name: target.name,
                content: target.content,
                workspaceName: target.workspaceName ?? null,
              });
            }}
            onClose={(id) => closeTabAction(id)}
            onReorder={(from, to) => reorderTabs(from, to)}
          />
          <EditorLayout
            mode={mode}
            docContent={doc.content}
            deferredContent={deferredContent}
            deferredDocKey={deferredPreview.docKey}
            editorRef={editorRef}
            vimEnabled={vimEnabled}
            spellCheck={spellCheck}
            grammarCheck={grammarCheck}
            typewriterMode={typewriterMode}
            suggestingMode={suggestingMode}
            activeFile={activeFile}
            pageView={pageView}
            collab={collab}
            setContent={setContent}
            handleAddAsset={handleAddAsset}
          />
        </div>
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
                /* why: the history entry points at a file that no longer exists; the click does nothing */
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
        configHealth={configHealth}
        onOpenRuntimeMetrics={() => setRuntimeMetricsOpen(true)}
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
      {searchMounted && <Suspense fallback={null}>
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
      </Suspense>}
      <AiToastContainer />
      <AiSuggestionsPanel />
      <AiInlinePromptOverlay />
      <MobileKeyboardBar />
      <TagsPanel open={tagsPanelOpen} onClose={() => setTagsPanelOpen(false)} />
      {collab && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      <AppOverlays
        graphOpen={graphOpen} setGraphOpen={setGraphOpen}
        canvasOpen={canvasOpen} setCanvasOpen={setCanvasOpen}
        galleryOpen={galleryOpen} setGalleryOpen={setGalleryOpen}
        templateGalleryOpen={templateGalleryOpen} setTemplateGalleryOpen={setTemplateGalleryOpen}
        auditLogOpen={auditLogOpen} setAuditLogOpen={setAuditLogOpen}
        fineTuneOpen={fineTuneOpen} setFineTuneOpen={setFineTuneOpen}
        orgSettingsOpen={orgSettingsOpen} setOrgSettingsOpen={setOrgSettingsOpen}
        trustedKeysOpen={trustedKeysOpen} setTrustedKeysOpen={setTrustedKeysOpen}
        aiSettingsOpen={aiSettingsOpen} setAiSettingsOpen={setAiSettingsOpen}
        aiDoctorOpen={aiDoctorOpen} setAiDoctorOpen={setAiDoctorOpen}
        privacyOpen={privacyOpen} setPrivacyOpen={setPrivacyOpen}
        trashOpen={trashOpen} setTrashOpen={setTrashOpen}
        themeSettingsOpen={themeSettingsOpen} setThemeSettingsOpen={setThemeSettingsOpen}
        historyOpen={historyOpen} setHistoryOpen={setHistoryOpen}
        tableEditorOpen={tableEditorOpen} setTableEditorOpen={setTableEditorOpen}
        shortcutsOpen={shortcutsOpen} setShortcutsOpen={setShortcutsOpen}
        tourOpen={tourOpen} setTourOpen={setTourOpen}
        runtimeMetricsOpen={runtimeMetricsOpen} setRuntimeMetricsOpen={setRuntimeMetricsOpen}
        doc={doc} setDoc={setDoc} setContent={setContent}
        authUserId={authUserId} authOrgId={authOrgId} commands={commands}
      />

      {/* Focus Mode overlay */}
      {focusMode && (
        <FocusMode active={focusMode} onExit={() => setFocusMode(false)}>
          <EditorLayout
            mode={mode}
            docContent={doc.content}
            deferredContent={deferredContent}
            deferredDocKey={deferredPreview.docKey}
            editorRef={editorRef}
            vimEnabled={vimEnabled}
            spellCheck={spellCheck}
            grammarCheck={grammarCheck}
            typewriterMode={typewriterMode}
            suggestingMode={suggestingMode}
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
