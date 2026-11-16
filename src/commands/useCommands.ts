/**
 * The command palette's list (⌘K), assembled from per-domain builders in
 * ./domains. Each builder turns the shared context (App's options plus the
 * store values below) into its commands; domains/index.ts lists them in
 * palette order. The domains load in their own chunk after the first paint
 * (plan 0.2, ./sectionsLoader); until then the list holds only the vault's
 * type commands.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Command } from "../ui/CommandPalette";
import { useAppStore } from "../store/useStore";
import { withAiQuota } from "../billing/aiQuota";
import { useInstalledTemplates } from "./installedTemplates";
import { buildTypeCommands, useTypeEntries } from "./typeCommands";
import { t } from "../i18n";
import { commandSections, loadCommandSectionsWhenIdle, onCommandSections } from "./sectionsLoader";
import { useCommandStore, type CommandContext, type UseCommandsOptions } from "./domains/context";

export type { UseCommandsOptions } from "./domains/context";
export { openNewDoc, openTemplateDoc } from "./openDoc";
export { loadCommandSections } from "./sectionsLoader";
/** The research domain's clip savers, loaded with it (static re-exports before plan 0.2). */
export async function saveClip(clip: { title: string; markdown: string }): Promise<void> {
  return (await import("./domains/research")).saveClip(clip);
}
export async function saveClipV2(payload: import("../research/clipV2").ClipPayload): Promise<string | null> {
  return (await import("./domains/research")).saveClipV2(payload);
}

export function useCommands(options: UseCommandsOptions) {
  const store = useCommandStore();
  const installedTemplates = useInstalledTemplates();
  // W12.T3: "All <type>" for each type of the vault.
  const typeEntries = useTypeEntries();
  const o = options;
  const sections = useSyncExternalStore(onCommandSections, commandSections, commandSections);
  useEffect(() => loadCommandSectionsWhenIdle(), []);

  return useMemo<Command[]>(() => {
    // Actions read the document when they run, not when the list was built:
    // the command list no longer rebuilds on every keystroke (C5).
    const { setMode, setTheme, toggleOutline } = useAppStore.getState();
    const ctx: CommandContext = {
      ...options,
      ...store,
      installedTemplates,
      liveDoc: () => useAppStore.getState().doc,
      setMode,
      setTheme,
      toggleOutline,
    };
    // AI-prompt commands are wrapped with the monthly quota check.
    return withAiQuota([...(sections ?? []).flatMap((build) => build(ctx)), ...buildTypeCommands(typeEntries, { locale: store.locale, t })]);
    // Every store value a label or an action reads is listed, so a toggle's
    // label never goes stale. The document itself is not: actions read it
    // through liveDoc(), so typing does not rebuild the list (C5).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sections,
    o.handleNew,
    o.handleOpen,
    o.handleSave,
    o.handleExportHtml,
    o.handleSaveToWorkspace,
    o.insertSnippet,
    o.recents,
    o.handleReopenRecent,
    store.toggleBacklinks,
    store.toggleVim,
    store.vimEnabled,
    o.collab,
    o.handleStartCollab,
    o.handleStopCollab,
    store.setLocale,
    store.locale,
    store.showWorkspace,
    store.toggleWorkspace,
    store.setDoc,
    store.doc.workspaceName,
    store.theme,
    o.setRuntimeMetricsOpen,
    installedTemplates,
    typeEntries,
    store.suggestingMode,
    store.toggleSuggestingMode,
    store.suggestAuthorsKey,
    store.bidiMarksOn,
    store.rtl,
    store.autoSave,
    store.autoSaveInterval,
    store.spellCheck,
    store.useLocalAi,
    store.typewriterMode,
    store.writingGoalWords,
    store.pageView,
    store.tsChecks,
    store.grammarCheck,
  ]);
}
