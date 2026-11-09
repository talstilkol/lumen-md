/**
 * App start-up effects: theme and locale, the plugin system, launches from
 * the installed app and from the iOS share extension, and the first-run
 * Welcome document and tour. Moved out of App.tsx unchanged (plan 12.1);
 * App calls this where the effects were, so they run in the same order.
 */
import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { openNewDoc } from "../commands/useCommands";
import { htmlToMarkdown } from "../storage/fileFormats";
import { wirePluginAPI, registerPlugin, unregisterPlugin, wordCountPlugin } from "../plugins/pluginSystem";
import { showAiToast } from "../ui/AiToast";
import { useAppStore, applyTheme } from "../store/useStore";
import type { DocFile, Theme } from "../store/useStore";
import { applyLocale, t } from "../i18n";
import type { Locale } from "../i18n";
import { welcomeDoc } from "../welcomeDoc";

type AppStore = ReturnType<typeof useAppStore.getState>;

export interface AppStartupOptions {
  theme: Theme;
  locale: Locale;
  doc: DocFile;
  openTabs: AppStore["openTabs"];
  openTabAction: AppStore["openTab"];
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setTourOpen: Dispatch<SetStateAction<boolean>>;
}

export function useAppStartup({ theme, locale, doc, openTabs, openTabAction, setPaletteOpen, setTourOpen }: AppStartupOptions): void {
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
    void registerPlugin(wordCountPlugin);
    // Expose a tiny test surface on window.__lumen for e2e specs. This
    // lets the prod-build paste-html spec call htmlToMarkdown without
    // importing /src/* at runtime (which only works against the dev
    // server). The surface is intentionally minimal — only utilities
    // the test suite needs.
    (window as unknown as { __lumen?: unknown }).__lumen = {
      htmlToMarkdown,
    };
    return () => {
      unregisterPlugin(wordCountPlugin.id);
      delete (window as unknown as { __lumen?: unknown }).__lumen;
    };
  }, []);

  // Apply locale (sets <html lang dir>) on mount and on change.
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  // Launched from the installed app: share target, shortcut, or a file
  // opened with Lumen (D3).
  useEffect(() => {
    void import("../pwa/launch").then(({ parseLaunch, clearLaunchParams, onLaunchFiles }) => {
      const l = parseLaunch(location.search);
      if (l.kind === "share") {
        // A fresh tab name each time: two shares with the same title (or two
        // links from one host) stay two notes.
        openNewDoc(l.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60).trim() || "Shared", l.body, true);
      } else if (l.kind === "action" && l.action === "new") {
        openNewDoc(t("doc.untitled"), "", false);
      } else if (l.kind === "action" && l.action === "palette") {
        setPaletteOpen(true);
      }
      if (l.kind !== "none") clearLaunchParams();
      // With the file's handle, so Save writes back to the file that was opened.
      onLaunchFiles((name, content, handle) => openTabAction({ name, content, workspaceName: null, handle }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for a shared note from the iOS Share Extension.
  useEffect(() => {
    const pending = (window as unknown as Record<string, unknown>).__pendingSharedNote;
    if (typeof pending === "string" && pending.length > 0) {
      // Clear the pending note so we don't process it again.
      delete (window as unknown as Record<string, unknown>).__pendingSharedNote;
      openNewDoc("Shared Note", pending, true);
      showAiToast(t("toast.openedSharedNoteFromIos"), "info");
    }
  }, []);

  // Seed the Welcome document on first launch
  useEffect(() => {
    if (!doc.content) {
      // Use openTab so the Welcome doc lands on the tab strip too.
      openTabAction({ name: "Welcome.md", content: welcomeDoc(), workspaceName: null });
    } else if (openTabs.length === 0) {
      // Existing session before tabs existed — backfill a tab for the
      // currently active doc so the strip shows up immediately.
      openTabAction({
        name: doc.name,
        content: doc.content,
        workspaceName: doc.workspaceName ?? null,
      });
    }
    // Show onboarding tour on first launch
    let tourTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!localStorage.getItem("lumen-tour-done")) {
        tourTimer = setTimeout(() => setTourOpen(true), 1200);
      }
    } catch {
      /* why: storage may be denied in private browsing — onboarding silently skips */
    }
    return () => {
      if (tourTimer) clearTimeout(tourTimer);
    };
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
