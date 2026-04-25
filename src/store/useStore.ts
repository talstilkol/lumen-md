import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "../i18n";
import { applyLocale } from "../i18n";

export type ViewMode = "source" | "split" | "preview" | "wysiwyg";
export type Theme = "light" | "dark" | "system";
export type SyncScrollMode = "single" | "all";

interface DocFile {
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
  pageView: boolean;
  aiKey: string | null;
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
      pageView: false,
      aiKey: null,
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
        set((state) => ({
          doc: { ...state.doc, content: s, dirty: true },
        })),
      setDoc: (d) =>
        set((state) => ({
          doc: { ...state.doc, ...d, dirty: d.dirty ?? false },
        })),
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
        pageView: s.pageView,
        aiKey: s.aiKey,
        doc: {
          name: s.doc.name,
          content: s.doc.content,
          dirty: s.doc.dirty,
          workspaceName: s.doc.workspaceName ?? null,
        },
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
