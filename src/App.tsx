import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./editor/Editor";
import type { EditorHandle } from "./editor/Editor";
import { Preview } from "./renderer/Preview";

const WysiwygEditor = lazy(() => import("./editor/WysiwygEditor"));
import { Toolbar } from "./ui/Toolbar";
import { Outline } from "./ui/Outline";
import { StatusBar } from "./ui/StatusBar";
import { ScrollProgress } from "./ui/ScrollProgress";
import { SearchReplace } from "./ui/SearchReplace";
import { GraphView } from "./ui/GraphView";
import { VersionHistory, saveSnapshot } from "./ui/VersionHistory";
import { MarkdownTableEditor } from "./ui/MarkdownTableEditor";
import { CommandPalette, cmdIcons } from "./ui/CommandPalette";
import type { Command } from "./ui/CommandPalette";
import { FileTree } from "./ui/FileTree";
import { SidebarResizer } from "./ui/SidebarResizer";
import { uiAlert, uiConfirm, uiPrompt } from "./ui/PromptDialog";
import { BacklinksPanel } from "./ui/BacklinksPanel";
import { SearchDialog } from "./ui/SearchDialog";
import { AiToastContainer } from "./ui/AiToast";
import { AiInlinePromptOverlay } from "./ui/AiInlinePrompt";
import { buildAiSettingsCommand, generateAiCommitMessage } from "./ai/commands";
import { useAppStore, applyTheme } from "./store/useStore";
import { SUPPORTED_LOCALES, applyLocale, t } from "./i18n";
import { openFileDialog, saveFile } from "./storage/fs";
import { exportToHtml } from "./storage/exportHtml";
import { getRecents, pushRecent, removeRecent, reopenRecent } from "./storage/recent";
import type { RecentFile } from "./storage/recent";
import {
  isOPFSAvailable,
  makeAssetName,
  readWorkspaceFile,
  uniqueWorkspaceName,
  writeWorkspaceBlob,
  writeWorkspaceFile,
} from "./storage/workspace";
import { BLOCK_SNIPPETS } from "./snippets";
import { WELCOME_DOC } from "./welcome";
import {
  connectCollab,
  makeRoomName,
  readRoomFromHash,
  setRoomInHash,
  snapshotPeers,
} from "./collab/yjs";
import type { CollabPeer, CollabSession } from "./collab/yjs";
import {
  cloneRepo,
  commitAndPush,
  getGitIdentity,
  gitStatusSummary,
  pullRepo,
  setGitIdentity,
  setGitToken,
} from "./sync/git";

function relativeTime(ts: number): string {
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
  const setLocale = useAppStore((s) => s.setLocale);
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace);
  const showBacklinks = useAppStore((s) => s.showBacklinks);
  const toggleBacklinks = useAppStore((s) => s.toggleBacklinks);
  const vimEnabled = useAppStore((s) => s.vimEnabled);
  const toggleVim = useAppStore((s) => s.toggleVim);
  const rtl = useAppStore((s) => s.rtl);
  const toggleRtl = useAppStore((s) => s.toggleRtl);
  const editorRef = useRef<EditorHandle | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tableEditorOpen, setTableEditorOpen] = useState(false);
  const toggleAutoSave = useAppStore((s) => s.toggleAutoSave);
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [collab, setCollab] = useState<CollabSession | null>(null);
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);

  // Load recents on mount.
  useEffect(() => {
    getRecents().then(setRecents).catch(() => setRecents([]));
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Apply locale (sets <html lang dir>) on mount and on change.
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  // Seed the Welcome document on first launch
  useEffect(() => {
    if (!doc.content) {
      setDoc({ name: "Welcome.md", content: WELCOME_DOC, dirty: false });
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
    },
    [doc.name, doc.content, doc.handle, setDoc, markSaved],
  );

  const handleNew = useCallback(async () => {
    if (doc.dirty && !(await uiConfirm({ message: t("doc.confirm.discardUnsaved") }))) return;
    const untitled = t("doc.untitled");
    setDoc({
      name: `${untitled}.md`,
      content: `# ${untitled}\n\n`,
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

  // ── Real-time collaboration ────────────────────────────────────────────
  const handleStartCollab = useCallback(
    (joinName?: string) => {
      if (collab) return;
      const name = joinName ?? makeRoomName();
      const session = connectCollab(name, doc.content);
      setCollab(session);
      setRoomInHash(name);
      // Mirror Yjs text changes back into the doc store so the preview pane
      // stays current. We push, but the doc is already syncing through the
      // editor → setContent pipeline; the observer is a safety net for when
      // the editor isn't visible.
      const observer = () => {
        const text = session.ytext.toString();
        useAppStore.getState().setContent(text);
        useAppStore.getState().markSaved();
      };
      session.ytext.observe(observer);
      const awarenessTick = () => setCollabPeers(snapshotPeers(session));
      session.awareness.on("change", awarenessTick);
      awarenessTick();
      // Stash cleanup on the session for `handleStopCollab` to use.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).__cleanup = () => {
        session.ytext.unobserve(observer);
        session.awareness.off("change", awarenessTick);
      };
      if (!joinName) {
        const link = `${location.origin}${location.pathname}#room=${name}`;
        navigator.clipboard?.writeText(link).catch(() => {});
      }
    },
    [collab, doc.content],
  );

  const handleStopCollab = useCallback(() => {
    if (!collab) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (collab as any).__cleanup?.();
    collab.destroy();
    setCollab(null);
    setCollabPeers([]);
    setRoomInHash(null);
  }, [collab]);

  // On first load, if the URL contains #room=, offer to join.
  useEffect(() => {
    const hashRoom = readRoomFromHash();
    if (hashRoom && !collab) {
      // Defer slightly so the welcome doc is seeded first.
      const timer = setTimeout(async () => {
        const ok = await uiConfirm({ message: t("collab.prompt.join", { room: hashRoom }) });
        if (ok) handleStartCollab(hashRoom);
      }, 600);
      return () => clearTimeout(timer);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // ⇧⌘F → workspace search (only when shift is held; raw ⌘F is editor search).
      if (e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, handleSave, handleNew]);

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

  // Drag & drop file open
  const [dragHover, setDragHover] = useState(false);
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        setDragHover(true);
      }
    }
    function onDragLeave(e: DragEvent) {
      if (e.target === document.body) setDragHover(false);
    }
    async function onDrop(e: DragEvent) {
      e.preventDefault();
      setDragHover(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const raw = await f.text();
      const lower = f.name.toLowerCase();
      let content = raw;
      if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
        const lang = lower.endsWith(".tsv") ? "tsv" : "csv";
        content = `# ${f.name}\n\n\`\`\`${lang} title="${f.name}"\n${raw.trim()}\n\`\`\`\n`;
      } else if (lower.endsWith(".json")) {
        const trimmed = raw.trim();
        let isArray = false;
        try {
          isArray = Array.isArray(JSON.parse(trimmed));
        } catch {
          /* */
        }
        content = isArray
          ? `# ${f.name}\n\n\`\`\`json-table title="${f.name}"\n${trimmed}\n\`\`\`\n`
          : `# ${f.name}\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
      }
      setDoc({ name: f.name, content, handle: undefined, dirty: false });
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [setDoc]);

  const showEditor = mode === "source" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  // Sync-scroll: link editor and preview scrolling in split mode
  const editorSectionRef = useRef<HTMLElement | null>(null);
  const previewSectionRef = useRef<HTMLElement | null>(null);
  const syncingScroll = useRef(false);

  useEffect(() => {
    if (mode !== "split") return;

    // Wait for DOM elements to be mounted
    const timer = setTimeout(() => {
      const editorEl = editorSectionRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
      const previewEl = previewSectionRef.current?.querySelector("[data-preview-root]") as HTMLElement | null;
      if (!editorEl || !previewEl) return;

      function syncFrom(source: HTMLElement, target: HTMLElement) {
        return () => {
          if (syncingScroll.current) return;
          syncingScroll.current = true;
          const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
          target.scrollTop = ratio * (target.scrollHeight - target.clientHeight || 1);
          requestAnimationFrame(() => { syncingScroll.current = false; });
        };
      }

      const handleEditorScroll = syncFrom(editorEl, previewEl);
      const handlePreviewScroll = syncFrom(previewEl, editorEl);
      editorEl.addEventListener("scroll", handleEditorScroll, { passive: true });
      previewEl.addEventListener("scroll", handlePreviewScroll, { passive: true });

      // Store cleanup ref
      (editorSectionRef as any)._scrollCleanup = () => {
        editorEl.removeEventListener("scroll", handleEditorScroll);
        previewEl.removeEventListener("scroll", handlePreviewScroll);
      };
    }, 200);

    return () => {
      clearTimeout(timer);
      (editorSectionRef as any)._scrollCleanup?.();
    };
  }, [mode, showEditor, showPreview]);
  const showWysiwyg = mode === "wysiwyg";

  // Memoize the editor's value prop to avoid resetting CM6 on every keystroke.
  const editorInitial = useMemo(() => doc.content, [doc.name]);
  // ^ keyed on doc.name so opening a new file re-syncs the editor, but typing doesn't.

  const commands = useMemo<Command[]>(() => {
    const setMode = useAppStore.getState().setMode;
    const setTheme = useAppStore.getState().setTheme;
    const toggleOutline = useAppStore.getState().toggleOutline;
    const isDark = document.documentElement.classList.contains("dark");

    const recentCmds: Command[] = recents.slice(0, 8).flatMap((r) => [
      {
        id: `recent.${r.id}`,
        label: t("cmd.file.openRecent", { name: r.name }),
        hint: relativeTime(r.openedAt),
        icon: cmdIcons.FolderOpen,
        group: t("group.recent"),
        action: () => handleReopenRecent(r),
      },
      {
        id: `recent.remove.${r.id}`,
        label: t("cmd.file.removeRecent", { name: r.name }),
        icon: cmdIcons.FolderOpen,
        group: t("group.recent"),
        action: async () => {
          await removeRecent(r.id);
          setRecents(await getRecents());
        },
      },
    ]);

    return [
      ...recentCmds,
      {
        id: "file.new",
        label: t("cmd.file.new"),
        shortcut: "⌘N",
        icon: cmdIcons.FileText,
        group: t("group.file"),
        action: handleNew,
      },
      {
        id: "file.open",
        label: t("cmd.file.open"),
        shortcut: "⌘O",
        icon: cmdIcons.FolderOpen,
        group: t("group.file"),
        action: handleOpen,
      },
      {
        id: "file.save",
        label: t("cmd.file.save"),
        shortcut: "⌘S",
        icon: cmdIcons.Save,
        group: t("group.file"),
        action: () => handleSave(false),
      },
      {
        id: "file.saveAs",
        label: t("cmd.file.saveAs"),
        shortcut: "⇧⌘S",
        icon: cmdIcons.Save,
        group: t("group.file"),
        action: () => handleSave(true),
      },
      {
        id: "file.exportHtml",
        label: t("cmd.file.exportHtml"),
        hint: t("cmd.file.exportHtml.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: handleExportHtml,
      },
      {
        id: "file.exportPdf",
        label: t("cmd.file.exportPdf"),
        hint: t("cmd.file.exportPdf.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { printDocument } = await import("./ui/PrintExport");
          await printDocument(doc.content, doc.name);
        },
      },
      {
        id: "file.print",
        label: t("cmd.file.print"),
        hint: t("cmd.file.print.hint"),
        shortcut: "⌘P",
        icon: cmdIcons.Printer,
        group: t("group.file"),
        action: () => {
          // Make sure preview is visible before printing.
          useAppStore.getState().setMode("preview");
          setTimeout(() => window.print(), 50);
        },
      },
      {
        id: "view.source",
        label: t("cmd.view.source"),
        shortcut: "⌘1",
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: () => setMode("source"),
      },
      {
        id: "view.split",
        label: t("cmd.view.split"),
        shortcut: "⌘2",
        icon: cmdIcons.Columns2,
        group: t("group.view"),
        action: () => setMode("split"),
      },
      {
        id: "view.preview",
        label: t("cmd.view.preview"),
        shortcut: "⌘3",
        icon: cmdIcons.Eye,
        group: t("group.view"),
        action: () => setMode("preview"),
      },
      {
        id: "view.wysiwyg",
        label: t("cmd.view.wysiwyg"),
        hint: t("cmd.view.wysiwyg.hint"),
        shortcut: "⌘4",
        icon: cmdIcons.Sparkles,
        group: t("group.view"),
        action: () => setMode("wysiwyg"),
      },
      {
        id: "view.outline",
        label: t("cmd.view.outline"),
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: toggleOutline,
      },
      {
        id: "view.workspace",
        label: t("cmd.view.workspace"),
        hint: t("cmd.view.workspace.hint"),
        icon: cmdIcons.FolderOpen,
        group: t("group.view"),
        action: toggleWorkspace,
      },
      {
        id: "view.backlinks",
        label: t("cmd.view.backlinks"),
        hint: t("cmd.view.backlinks.hint"),
        icon: cmdIcons.Link,
        group: t("group.view"),
        action: toggleBacklinks,
      },
      {
        id: "view.search",
        label: t("cmd.view.search"),
        shortcut: "⇧⌘F",
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setSearchOpen(true),
      },
      {
        id: "view.vim",
        label: vimEnabled ? t("cmd.view.vim.off") : t("cmd.view.vim.on"),
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleVim,
      },
      {
        id: "view.rtl",
        label: rtl ? t("cmd.view.rtl.off") : t("cmd.view.rtl.on"),
        hint: rtl ? "← LTR" : "→ RTL",
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleRtl,
      },
      ...SUPPORTED_LOCALES.map((l) => ({
        id: `lang.${l.code}`,
        label: t("cmd.view.language", { label: l.label }),
        hint:
          l.dir === "rtl"
            ? t("cmd.view.language.rtl")
            : t("cmd.view.language.ltr"),
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setLocale(l.code),
      })),
      // ── New Features ──────────────────────────────────────────────────────
      {
        id: "view.findReplace",
        label: "Find & Replace",
        shortcut: "⌘H",
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setFindReplaceOpen(true),
      },
      {
        id: "view.graphView",
        label: "Knowledge Graph",
        hint: "visual map of file connections",
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => {
          setGraphOpen(true);
        },
      },
      {
        id: "view.versionHistory",
        label: "Version History",
        hint: "restore previous versions",
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setHistoryOpen(true),
      },
      {
        id: "insert.table",
        label: "Insert Table (Editor)",
        hint: "visual table builder",
        icon: cmdIcons.Pencil,
        group: t("group.insert"),
        action: () => setTableEditorOpen(true),
      },
      {
        id: "view.autoSave",
        label: autoSave ? "Disable Auto-Save" : "Enable Auto-Save",
        hint: autoSave ? `every ${autoSaveInterval / 1000}s` : "off",
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleAutoSave,
      },
      ...(() => {
        // Lazy import templates
        const { TEMPLATES } = require("./editor/templates");
        return (TEMPLATES as { id: string; name: string; description: string; category: string; content: string }[]).map((tpl) => ({
          id: `template.${tpl.id}`,
          label: `Template: ${tpl.name}`,
          hint: tpl.category,
          icon: cmdIcons.FileText,
          group: "Templates",
          action: () => {
            setContent(tpl.content);
            setDoc({ name: `${tpl.name}.md`, dirty: true });
          },
        }));
      })(),
      // ── AI Capabilities ──────────────────────────────────────────────────
      buildAiSettingsCommand(),
      // ── Git ─────────────────────────────────────────────────────────────
      {
        id: "git.clone",
        label: t("cmd.git.clone"),
        hint: t("cmd.git.clone.hint"),
        icon: cmdIcons.Download,
        group: t("group.git"),
        action: async () => {
          const url = await uiPrompt({ message: t("git.prompt.url"), placeholder: "https://github.com/..." });
          if (!url) return;
          if (!showWorkspace) toggleWorkspace();
          try {
            const result = await cloneRepo(url.trim());
            window.dispatchEvent(new Event("lumen-workspace-changed"));
            await uiAlert({
              message: t("git.alert.cloned", {
                folder: result.workspaceFolder,
                count: result.fileCount,
              }),
            });
          } catch (e) {
            await uiAlert({
              message: t("git.alert.cloneFailed", { error: (e as Error).message }),
            });
          }
        },
      },
      {
        id: "git.commit",
        label: t("cmd.git.commit", { defaultValue: "Commit & Push" }),
        hint: t("cmd.git.commit.hint", { defaultValue: "AI Auto-Pilot Enabled" }),
        icon: cmdIcons.Save,
        group: t("group.git"),
        action: async () => {
          if (!doc.workspaceName) {
            await uiAlert({ message: t("git.prompt.openFileFirst") });
            return;
          }
          const repoFolder = doc.workspaceName.split("/")[0];
          
          let aiSuggestion = "";
          
          try {
            aiSuggestion = await generateAiCommitMessage(repoFolder);
          } catch (e) {
            console.error("AI commit generation skipped:", e);
          }

          const message = (await uiPrompt({ 
            message: "Commit Message" + (aiSuggestion ? " (AI Suggested):" : ":"),
             defaultValue: aiSuggestion 
          }))?.trim();
          if (!message) return;
          const identity = await getGitIdentity();
          try {
            await commitAndPush(repoFolder, message, identity);
            await uiAlert({ message: t("git.alert.pushed") });
          } catch (e) {
            await uiAlert({
              message: t("git.alert.commitFailed", { error: (e as Error).message }),
            });
          }
        },
      },
      {
        id: "git.pull",
        label: t("cmd.git.pull"),
        hint: t("cmd.git.pull.hint"),
        icon: cmdIcons.Download,
        group: t("group.git"),
        action: async () => {
          if (!doc.workspaceName) {
            await uiAlert({ message: t("git.prompt.openFileFirst") });
            return;
          }
          const repoFolder = doc.workspaceName.split("/")[0];
          try {
            const result = await pullRepo(repoFolder);
            window.dispatchEvent(new Event("lumen-workspace-changed"));
            await uiAlert({
              message: t("git.alert.pulled", { changed: result.changedFiles }),
            });
            // If the active file's content changed on disk, reload it.
            if (doc.workspaceName) {
              try {
                const fresh = await readWorkspaceFile(doc.workspaceName);
                if (fresh !== doc.content) {
                  setDoc({ content: fresh, dirty: false });
                }
              } catch {
                /* file may have been deleted upstream; ignore */
              }
            }
          } catch (e) {
            await uiAlert({
              message: t("git.alert.pullFailed", { error: (e as Error).message }),
            });
          }
        },
      },
      {
        id: "git.status",
        label: t("cmd.git.status"),
        icon: cmdIcons.Link,
        group: t("group.git"),
        action: async () => {
          if (!doc.workspaceName) {
            await uiAlert({ message: t("git.prompt.openFileFirst") });
            return;
          }
          const repoFolder = doc.workspaceName.split("/")[0];
          try {
            const summary = await gitStatusSummary(repoFolder);
            const total = summary.added + summary.modified + summary.deleted;
            await uiAlert({
              message: total === 0
                ? t("git.status.clean")
                : t("git.status.summary", {
                    added: summary.added,
                    modified: summary.modified,
                    deleted: summary.deleted,
                  }),
            });
          } catch (e) {
            await uiAlert({ message: (e as Error).message });
          }
        },
      },
      {
        id: "git.token",
        label: t("cmd.git.token"),
        hint: t("cmd.git.token.hint"),
        icon: cmdIcons.Link,
        group: t("group.git"),
        action: async () => {
          const token = await uiPrompt({ message: t("git.prompt.token") });
          if (token === null) return;
          await setGitToken(token.trim() || null);
          await uiAlert({
            message: token.trim()
              ? t("git.alert.tokenSaved")
              : t("git.alert.tokenCleared"),
          });
        },
      },
      {
        id: "git.identity",
        label: t("cmd.git.identity"),
        icon: cmdIcons.Link,
        group: t("group.git"),
        action: async () => {
          const current = await getGitIdentity();
          const name = (await uiPrompt({
            message: t("git.prompt.identityName"),
            defaultValue: current.name,
          }))?.trim();
          if (!name) return;
          const email = (await uiPrompt({
            message: t("git.prompt.identityEmail"),
            defaultValue: current.email,
          }))?.trim();
          if (!email) return;
          await setGitIdentity({ name, email });
          await uiAlert({ message: t("git.alert.identitySaved") });
        },
      },
      ...(collab
        ? [
            {
              id: "collab.copy",
              label: t("cmd.collab.copy"),
              hint: collab.roomName,
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: () => {
                const link = `${location.origin}${location.pathname}#room=${collab.roomName}`;
                navigator.clipboard?.writeText(link).catch(() => {});
              },
            },
            {
              id: "collab.leave",
              label: t("cmd.collab.leave"),
              hint: collab.roomName,
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: handleStopCollab,
            },
          ]
        : [
            {
              id: "collab.start",
              label: t("cmd.collab.start"),
              hint: t("cmd.collab.start.hint"),
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: () => handleStartCollab(),
            },
            {
              id: "collab.join",
              label: t("cmd.collab.join"),
              hint: t("cmd.collab.join.hint"),
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: async () => {
                const name = await uiPrompt({ message: t("collab.prompt.room") });
                if (name) handleStartCollab(name.trim());
              },
            },
          ]),
      {
        id: "file.saveToWorkspace",
        label: t("cmd.file.saveToWorkspace"),
        hint: t("cmd.file.saveToWorkspace.hint"),
        icon: cmdIcons.Save,
        group: t("group.file"),
        action: handleSaveToWorkspace,
      },
      {
        id: "theme.toggle",
        label: isDark ? t("cmd.view.theme.toLight") : t("cmd.view.theme.toDark"),
        icon: isDark ? cmdIcons.Sun : cmdIcons.Moon,
        group: t("group.view"),
        action: () => setTheme(isDark ? "light" : "dark"),
      },
      {
        id: "insert.chart",
        label: t("cmd.insert.chart"),
        hint: t("cmd.insert.chart.hint"),
        icon: cmdIcons.BarChart3,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.chart),
      },
      {
        id: "insert.csv",
        label: t("cmd.insert.csv"),
        hint: t("cmd.insert.csv.hint"),
        icon: cmdIcons.Table,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.csv),
      },
      {
        id: "insert.json",
        label: t("cmd.insert.json"),
        hint: t("cmd.insert.csv.hint"),
        icon: cmdIcons.Table,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.jsonTable),
      },
      {
        id: "insert.mermaid",
        label: t("cmd.insert.mermaid"),
        icon: cmdIcons.Network,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.mermaid),
      },
      {
        id: "insert.map",
        label: t("cmd.insert.map"),
        icon: cmdIcons.Map,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.map),
      },
      {
        id: "insert.math",
        label: t("cmd.insert.math"),
        icon: cmdIcons.Calculator,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.math),
      },
      {
        id: "insert.callout",
        label: t("cmd.insert.callout"),
        hint: t("cmd.insert.callout.hint"),
        icon: cmdIcons.Quote,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.note),
      },
      {
        id: "insert.graphviz",
        label: t("cmd.insert.graphviz"),
        icon: cmdIcons.Workflow,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.graphviz),
      },
      {
        id: "insert.plantuml",
        label: t("cmd.insert.plantuml"),
        hint: t("cmd.insert.plantuml.hint"),
        icon: cmdIcons.Workflow,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.plantuml),
      },
      {
        id: "insert.abc",
        label: t("cmd.insert.abc"),
        icon: cmdIcons.Music2,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.abc),
      },
      {
        id: "insert.model",
        label: t("cmd.insert.model"),
        hint: t("cmd.insert.model.hint"),
        icon: cmdIcons.Box,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.model),
      },
      {
        id: "insert.embed",
        label: t("cmd.insert.embed"),
        hint: t("cmd.insert.embed.hint"),
        icon: cmdIcons.Youtube,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.embed),
      },
      {
        id: "insert.htmlpreview",
        label: t("cmd.insert.htmlpreview"),
        hint: t("cmd.insert.htmlpreview.hint"),
        icon: cmdIcons.Box,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.htmlpreview),
      },
      {
        id: "insert.bibtex",
        label: t("cmd.insert.bibtex"),
        hint: t("cmd.insert.bibtex.hint"),
        icon: cmdIcons.Quote,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.bibtex),
      },
      {
        id: "insert.wikilink",
        label: t("cmd.insert.wikilink"),
        hint: "[[Page|label]]",
        icon: cmdIcons.Link,
        group: t("group.insert"),
        action: () => insertSnippet(BLOCK_SNIPPETS.wikilink),
      },
    ];
  }, [
    handleNew,
    handleOpen,
    handleSave,
    handleExportHtml,
    handleSaveToWorkspace,
    insertSnippet,
    recents,
    handleReopenRecent,
    toggleBacklinks,
    toggleVim,
    vimEnabled,
    collab,
    handleStartCollab,
    handleStopCollab,
    setLocale,
    locale,
    showWorkspace,
    toggleWorkspace,
    setDoc,
    doc.workspaceName,
    doc.content,
  ]);

  return (
    <div className="h-screen flex flex-col">
      <a href="#main" className="skip-link">
        {t("a11y.skipToContent")}
      </a>
      <Toolbar
        onOpen={handleOpen}
        onSave={handleSave}
        onNew={handleNew}
        onCommandPalette={() => setPaletteOpen(true)}
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
        {showEditor && (
          <section
            ref={editorSectionRef}
            className={
              mode === "split"
                ? "w-1/2 min-w-0 border-r border-border bg-bg"
                : "w-full min-w-0 bg-bg"
            }
          >
            <Editor
              key={collab ? `collab:${collab.roomName}` : "local"}
              ref={editorRef}
              value={editorInitial}
              onChange={setContent}
              onAddAsset={handleAddAsset}
              vimEnabled={vimEnabled}
              collab={collab}
            />
          </section>
        )}
        {showPreview && (
          <section
            ref={previewSectionRef}
            className={
              mode === "split"
                ? "w-1/2 min-w-0 bg-bg-subtle"
                : "w-full min-w-0 bg-bg-subtle"
            }
          >
            <Preview markdownText={doc.content} />
          </section>
        )}
        {showWysiwyg && (
          <section className="w-full min-w-0 bg-bg">
            <Suspense
              fallback={
                <div
                  style={{
                    padding: "2rem",
                    color: "hsl(var(--fg-muted))",
                    fontSize: 13,
                  }}
                >
                  Loading WYSIWYG editor…
                </div>
              }
            >
              <WysiwygEditor value={doc.content} onChange={setContent} />
            </Suspense>
          </section>
        )}
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

      {/* Graph View overlay */}
      {graphOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "hsl(var(--bg))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>Knowledge Graph</h3>
            <button className="icon-btn" onClick={() => setGraphOpen(false)} style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}>Close</button>
          </div>
          <div style={{ height: "calc(100vh - 42px)" }}>
            <GraphView onOpenFile={(path, content) => {
              setDoc({ name: path.split("/").pop() ?? path, content, handle: undefined, workspaceName: path, dirty: false });
              setGraphOpen(false);
            }} />
          </div>
        </div>
      )}

      {/* Version History overlay */}
      {historyOpen && (
        <VersionHistory
          fileName={doc.name}
          currentContent={doc.content}
          onRestore={(content) => setContent(content)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Table Editor overlay */}
      {tableEditorOpen && (
        <MarkdownTableEditor
          onUpdate={(md) => {
            const current = doc.content;
            setContent(current + "\n\n" + md + "\n");
          }}
          onClose={() => setTableEditorOpen(false)}
        />
      )}
    </div>
  );
}
