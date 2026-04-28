import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "../i18n";
import { applyLocale } from "../i18n";

export type ViewMode = "source" | "split" | "preview" | "wysiwyg";
export type Theme = "light" | "dark" | "system";
export type SyncScrollMode = "single" | "all";
/**
 * Split orientation:
 *   "auto"       – follow the viewport (horizontal on desktop, vertical on phone).
 *   "horizontal" – editor left, preview right. Locked.
 *   "vertical"   – editor top, preview bottom. Locked.
 */
export type SplitAxis = "auto" | "horizontal" | "vertical";

export interface DocFile {
  name: string;
  content: string;
  /** File System Access API handle, if the doc came from disk */
  handle?: FileSystemFileHandle;
  /** When set, the doc lives inside the OPFS workspace under this name. */
  workspaceName?: string | null;
  dirty: boolean;
}

interface AppState {
  doc: DocFile;
  mode: ViewMode;
  theme: Theme;
  locale: Locale;
  showOutline: boolean;
  showWorkspace: boolean;
  showBacklinks: boolean;
  vimEnabled: boolean;
  rtl: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  syncScroll: SyncScrollMode;
  splitAxis: SplitAxis;
  pageView: boolean;
  aiKey: string | null;
  /** Toggle browser-native red squiggle spell-check inside the editor. */
  spellCheck: boolean;
  /** Run AI locally via web-llm + WebGPU instead of OpenAI. */
  useLocalAi: boolean;
  /** Typewriter scroll mode — keep the active line vertically centred. */
  typewriterMode: boolean;
  /** Daily writing goal (words). 0 disables the banner. */
  writingGoalWords: number;
  /** Toggle LanguageTool-powered grammar/style checking in the editor. */
  grammarCheck: boolean;
  /**
   * F3 — when set, `chat()` routes to the user's fine-tuned model
   * (id stored in `fineTunedModelId`). Off by default; flipped from
   * Settings only after a fine-tune job has succeeded.
   */
  useFineTunedModel: boolean;
  /** Persisted result of the last successful fine-tune job. */
  fineTunedModelId: string | null;
  /**
   * Active tag filter for the FileTree. When non-null, the tree shows only
   * the listed paths (and their parent directories). Driven by the Tags panel.
   * Not persisted — purely a runtime view-filter.
   */
  tagFilter: { tag: string; paths: string[] } | null;
  /**
   * Open document tabs (multi-doc UI). The currently active tab is the one
   * whose `id` matches `tabIdOf(doc)`. Tabs persist across reloads so users
   * resume where they left off.
   */
  openTabs: Array<{ id: string; name: string; content: string; workspaceName: string | null; dirty: boolean }>;
  setMode: (m: ViewMode) => void;
  setTheme: (t: Theme) => void;
  setLocale: (l: Locale) => void;
  setContent: (s: string) => void;
  setDoc: (d: Partial<DocFile>) => void;
  toggleOutline: () => void;
  toggleWorkspace: () => void;
  toggleBacklinks: () => void;
  toggleVim: () => void;
  toggleRtl: () => void;
  toggleAutoSave: () => void;
  setAutoSaveInterval: (ms: number) => void;
  markSaved: () => void;
  setAiKey: (key: string | null) => void;
  toggleSyncScroll: () => void;
  togglePageView: () => void;
  setSplitAxis: (axis: SplitAxis) => void;
  toggleSpellCheck: () => void;
  toggleLocalAi: () => void;
  toggleTypewriter: () => void;
  setWritingGoal: (words: number) => void;
  /** Toggle the LanguageTool grammar checker. */
  toggleGrammarCheck: () => void;
  /** Toggle the personal fine-tuned model on/off (F3). */
  toggleFineTunedModel: () => void;
  /** Persist the resulting model id from a successful fine-tune job. */
  setFineTunedModelId: (id: string | null) => void;
  /** Apply or clear the tag-based file-tree filter. */
  setTagFilter: (filter: { tag: string; paths: string[] } | null) => void;
  /**
   * Open (or focus) a doc as a tab. Idempotent: re-opening an already-open
   * doc just selects that tab. Updates `doc` to mirror the active tab.
   */
  openTab: (input: { name: string; content: string; workspaceName?: string | null; handle?: FileSystemFileHandle }) => void;
  /** Close a tab by id. If it was active, falls back to the neighbour. */
  closeTab: (id: string) => void;
  /** Reorder a tab from one index to another (drag-and-drop). */
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

/** Stable per-tab identity. Workspace name preferred (unique across the
 *  vault), falls back to display name for ad-hoc / untitled docs. Treats
 *  empty strings as missing — `""` should never be a tab id. */
export function tabIdOf(d: { workspaceName?: string | null; name: string }): string {
  if (d.workspaceName) return d.workspaceName;
  if (d.name) return d.name;
  return "Untitled";
}

const DEFAULT_DOC: DocFile = {
  name: "Welcome.md",
  content: "",
  dirty: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      doc: DEFAULT_DOC,
      mode: "split",
      theme: "dark",
      locale: "en",
      showOutline: true,
      showWorkspace: false,
      showBacklinks: false,
      vimEnabled: false,
      rtl: false,
      autoSave: true,
      autoSaveInterval: 30000,
      syncScroll: "all" as SyncScrollMode,
      splitAxis: "auto" as SplitAxis,
      pageView: false,
      aiKey: null,
      spellCheck: true,
      useLocalAi: false,
      typewriterMode: false,
      writingGoalWords: 0,
      grammarCheck: false,
      useFineTunedModel: false,
      fineTunedModelId: null,
      tagFilter: null,
      openTabs: [],
      setMode: (m) => set({ mode: m }),
      setTheme: (t) => {
        set({ theme: t });
        applyTheme(t);
      },
      setLocale: (l) => {
        set({ locale: l });
        applyLocale(l);
      },
      setContent: (s) =>
        set((state) => {
          const nextDoc = { ...state.doc, content: s, dirty: true };
          const id = tabIdOf(nextDoc);
          // Mirror the edit into the matching tab so the dirty-marker on
          // the tab strip stays accurate without a separate event channel.
          const nextTabs = state.openTabs.map((t) =>
            t.id === id ? { ...t, content: s, dirty: true } : t,
          );
          return { doc: nextDoc, openTabs: nextTabs };
        }),
      setDoc: (d) =>
        set((state) => {
          const nextDoc = {
            ...state.doc,
            ...d,
            dirty: d.dirty ?? state.doc.dirty,
          };
          const id = tabIdOf(nextDoc);
          // Keep the matching tab in sync with `setDoc` patches (e.g. rename,
          // markSaved) so the tab strip never lies.
          const nextTabs = state.openTabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  name: nextDoc.name,
                  content: nextDoc.content,
                  workspaceName: nextDoc.workspaceName ?? null,
                  dirty: nextDoc.dirty,
                }
              : t,
          );
          return { doc: nextDoc, openTabs: nextTabs };
        }),
      toggleOutline: () => set((s) => ({ showOutline: !s.showOutline })),
      toggleWorkspace: () => set((s) => ({ showWorkspace: !s.showWorkspace })),
      toggleBacklinks: () => set((s) => ({ showBacklinks: !s.showBacklinks })),
      toggleVim: () => set((s) => ({ vimEnabled: !s.vimEnabled })),
      toggleRtl: () => set((s) => {
        const next = !s.rtl;
        applyDirection(next);
        return { rtl: next };
      }),
      toggleAutoSave: () => set((s) => ({ autoSave: !s.autoSave })),
      setAutoSaveInterval: (ms) => set({ autoSaveInterval: ms }),
      markSaved: () =>
        set((state) => ({ doc: { ...state.doc, dirty: false } })),
      setAiKey: (key) => set({ aiKey: key }),
      toggleSyncScroll: () => set((s) => ({ syncScroll: s.syncScroll === "all" ? "single" : "all" })),
      togglePageView: () => set((s) => ({ pageView: !s.pageView })),
      setSplitAxis: (axis) => set({ splitAxis: axis }),
      toggleSpellCheck: () => set((s) => ({ spellCheck: !s.spellCheck })),
      toggleLocalAi: () => set((s) => ({ useLocalAi: !s.useLocalAi })),
      toggleTypewriter: () => set((s) => ({ typewriterMode: !s.typewriterMode })),
      setWritingGoal: (words) => set({ writingGoalWords: Math.max(0, Math.floor(words)) }),
      toggleGrammarCheck: () => set((s) => ({ grammarCheck: !s.grammarCheck })),
      toggleFineTunedModel: () =>
        set((s) => {
          // Refuse to flip ON when no model id is persisted.
          if (!s.useFineTunedModel && !s.fineTunedModelId) return s;
          return { useFineTunedModel: !s.useFineTunedModel };
        }),
      setFineTunedModelId: (id) => set({ fineTunedModelId: id }),
      setTagFilter: (filter) => set({ tagFilter: filter }),
      openTab: (input) =>
        set((state) => {
          const id = tabIdOf({
            workspaceName: input.workspaceName ?? null,
            name: input.name,
          });
          // Persist the *current* doc back into its tab before switching, so
          // unsaved edits don't get clobbered when the user switches away
          // and back. Then either focus the existing tab for `id` or push a
          // new one onto the strip.
          const currentId = tabIdOf(state.doc);
          const baseTabs = state.openTabs.some((t) => t.id === currentId)
            ? state.openTabs.map((t) =>
                t.id === currentId
                  ? {
                      ...t,
                      content: state.doc.content,
                      dirty: state.doc.dirty,
                      name: state.doc.name,
                      workspaceName: state.doc.workspaceName ?? null,
                    }
                  : t,
              )
            : state.openTabs;

          let nextTabs = baseTabs;
          if (!nextTabs.some((t) => t.id === id)) {
            nextTabs = [
              ...nextTabs,
              {
                id,
                name: input.name,
                content: input.content,
                workspaceName: input.workspaceName ?? null,
                dirty: false,
              },
            ];
          }
          return {
            openTabs: nextTabs,
            doc: {
              name: input.name,
              content: input.content,
              workspaceName: input.workspaceName ?? null,
              handle: input.handle,
              dirty: false,
            },
          };
        }),
      closeTab: (id) =>
        set((state) => {
          const idx = state.openTabs.findIndex((t) => t.id === id);
          if (idx === -1) return state;
          const nextTabs = state.openTabs.filter((t) => t.id !== id);
          const wasActive = tabIdOf(state.doc) === id;
          if (!wasActive) return { openTabs: nextTabs };
          // Active tab closed — fall back to the neighbour at the same index
          // (or the previous one if we just lost the rightmost tab).
          const fallback =
            nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
          if (!fallback) {
            return {
              openTabs: nextTabs,
              doc: {
                name: "Untitled.md",
                content: "",
                workspaceName: null,
                dirty: false,
              },
            };
          }
          return {
            openTabs: nextTabs,
            doc: {
              name: fallback.name,
              content: fallback.content,
              workspaceName: fallback.workspaceName ?? null,
              dirty: fallback.dirty,
            },
          };
        }),
      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          if (fromIndex === toIndex) return state;
          if (fromIndex < 0 || fromIndex >= state.openTabs.length) return state;
          const clamped = Math.max(0, Math.min(toIndex, state.openTabs.length - 1));
          const next = [...state.openTabs];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(clamped, 0, moved);
          return { openTabs: next };
        }),
    }),
    {
      name: "lumen-md",
      partialize: (s) => ({
        mode: s.mode,
        theme: s.theme,
        locale: s.locale,
        showOutline: s.showOutline,
        showWorkspace: s.showWorkspace,
        showBacklinks: s.showBacklinks,
        vimEnabled: s.vimEnabled,
        rtl: s.rtl,
        autoSave: s.autoSave,
        autoSaveInterval: s.autoSaveInterval,
        syncScroll: s.syncScroll,
        splitAxis: s.splitAxis,
        pageView: s.pageView,
        spellCheck: s.spellCheck,
        useLocalAi: s.useLocalAi,
        typewriterMode: s.typewriterMode,
        writingGoalWords: s.writingGoalWords,
        grammarCheck: s.grammarCheck,
        useFineTunedModel: s.useFineTunedModel,
        fineTunedModelId: s.fineTunedModelId,
        // aiKey intentionally excluded — session-only for security
        doc: {
          name: s.doc.name,
          content: s.doc.content,
          dirty: s.doc.dirty,
          workspaceName: s.doc.workspaceName ?? null,
        },
        // Persist open tabs so the user's session resumes after reload.
        // Heavy `handle` references are intentionally excluded (not
        // structured-cloneable through localStorage anyway).
        openTabs: s.openTabs,
      }),
    },
  ),
);

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

// Re-apply when the OS color scheme changes (only meaningful for theme="system").
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const t = useAppStore.getState().theme;
    if (t === "system") applyTheme(t);
  };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler);
}

export function applyDirection(rtl: boolean) {
  document.documentElement.dir = rtl ? "rtl" : "ltr";
}
