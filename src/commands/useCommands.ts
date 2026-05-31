import { useMemo } from "react";
import type { Command } from "../ui/CommandPalette";
import { cmdIcons } from "../ui/CommandPalette";
import { useAppStore } from "../store/useStore";
import { t, SUPPORTED_LOCALES } from "../i18n";
import { getGitIdentity, setGitIdentity, setGitToken, cloneRepo, pullRepo, commitAndPush, gitStatusSummary } from "../sync/git";
import { getRecents, removeRecent } from "../storage/recent";
import type { RecentFile } from "../storage/recent";
import { BLOCK_SNIPPETS } from "../snippets";
import { uiAlert, uiPrompt } from "../ui/PromptDialog";
import { generateAiCommitMessage } from "../ai/commands";
import { buildAiSettingsCommand, buildAiOutlineCommand } from "../ai/commands";
import type { CollabSession } from "../collab/yjs";
import { startVoiceRecording } from "../ui/VoiceDictation";
import { TEMPLATES } from "../editor/templates";
import { log } from "../lib/logger";
import { AI_PROMPT_TEMPLATES, applyTemplate } from "../ai/multiLangPrompts";
import { getPluginCommands } from "../plugins/pluginSystem";
import { showAiToast } from "../ui/AiToast";
import { encryptDocument, decryptDocument, isEncrypted } from "../storage/encryption";
import { readWorkspaceFile } from "../storage/workspace";
import { relativeTime } from "../lib/relativeTime";

export interface UseCommandsOptions {
  handleNew: () => void;
  handleOpen: () => void;
  handleSave: (saveAs?: boolean) => void;
  handleExportHtml: () => void;
  handleSaveToWorkspace: () => void;
  insertSnippet: (snippet: string) => void;
  recents: RecentFile[];
  setRecents: (r: RecentFile[]) => void;
  handleReopenRecent: (r: RecentFile) => void;
  collab: CollabSession | null;
  handleStartCollab: (roomOverride?: string) => void;
  handleStopCollab: () => void;
  setSearchOpen: (open: boolean) => void;
  setFindReplaceOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  setTableEditorOpen: (open: boolean) => void;
  setCanvasOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setTemplateGalleryOpen?: (open: boolean) => void;
  setAuditLogOpen?: (open: boolean) => void;
  setFineTuneOpen?: (open: boolean) => void;
  setTagsPanelOpen?: (open: boolean) => void;
  setCommentsPanelOpen?: (open: boolean) => void;
  setRuntimeMetricsOpen?: (open: boolean) => void;
  onAddComment?: () => void;
}

export function useCommands({
  handleNew,
  handleOpen,
  handleSave,
  handleExportHtml,
  handleSaveToWorkspace,
  insertSnippet,
  recents,
  setRecents,
  handleReopenRecent,
  collab,
  handleStartCollab,
  handleStopCollab,
  setSearchOpen,
  setFindReplaceOpen,
  setGraphOpen,
  setHistoryOpen,
  setTableEditorOpen,
  setCanvasOpen,
  setGalleryOpen,
  setTemplateGalleryOpen,
  setAuditLogOpen,
  setFineTuneOpen,
  setTagsPanelOpen,
  setCommentsPanelOpen,
  setRuntimeMetricsOpen,
  onAddComment,
}: UseCommandsOptions) {
  const doc = useAppStore((s) => s.doc);
  const theme = useAppStore((s) => s.theme);
  const showWorkspace = useAppStore((s) => s.showWorkspace);
  const locale = useAppStore((s) => s.locale);
  const rtl = useAppStore((s) => s.rtl);
  const autoSave = useAppStore((s) => s.autoSave);
  const autoSaveInterval = useAppStore((s) => s.autoSaveInterval);
  const vimEnabled = useAppStore((s) => s.vimEnabled);
  const spellCheck = useAppStore((s) => s.spellCheck);
  const useLocalAi = useAppStore((s) => s.useLocalAi);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const writingGoalWords = useAppStore((s) => s.writingGoalWords);
  const pageView = useAppStore((s) => s.pageView);
  
  const toggleRtl = useAppStore((s) => s.toggleRtl);
  const setContent = useAppStore((s) => s.setContent);
  const setDoc = useAppStore((s) => s.setDoc);
  const setLocale = useAppStore((s) => s.setLocale);
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace);
  const toggleBacklinks = useAppStore((s) => s.toggleBacklinks);
  const toggleVim = useAppStore((s) => s.toggleVim);
  const toggleSpellCheck = useAppStore((s) => s.toggleSpellCheck);
  const toggleLocalAi = useAppStore((s) => s.toggleLocalAi);
  const toggleTypewriter = useAppStore((s) => s.toggleTypewriter);
  const grammarCheck = useAppStore((s) => s.grammarCheck);
  const toggleGrammarCheck = useAppStore((s) => s.toggleGrammarCheck);
  const setWritingGoal = useAppStore((s) => s.setWritingGoal);
  const toggleAutoSave = useAppStore((s) => s.toggleAutoSave);

    return useMemo<Command[]>(() => {
    const setMode = useAppStore.getState().setMode;
    const setTheme = useAppStore.getState().setTheme;
    const toggleOutline = useAppStore.getState().toggleOutline;
    const isDark = theme === "dark";

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
        id: "file.exportDocx",
        label: t("cmd.file.exportDocx") ?? "Export to Word (.doc)",
        hint: t("cmd.file.exportDocx.hint") ?? "Download as Word document",
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { exportToDocx } = await import("../storage/exportDocx");
          await exportToDocx(doc.content, doc.name);
        },
      },
      {
        id: "file.exportRtf",
        label: t("cmd.file.exportRtf"),
        hint: t("cmd.file.exportRtf.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToRtf, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.rtf`, markdownToRtf(doc.content), "application/rtf");
        },
      },
      {
        id: "file.exportLatex",
        label: t("cmd.file.exportLatex"),
        hint: t("cmd.file.exportLatex.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToLatex, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.tex`, markdownToLatex(doc.content), "application/x-latex");
        },
      },
      {
        id: "file.exportRst",
        label: t("cmd.file.exportRst"),
        hint: t("cmd.file.exportRst.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToRst, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.rst`, markdownToRst(doc.content), "text/x-rst");
        },
      },
      {
        id: "file.exportAdoc",
        label: t("cmd.file.exportAdoc"),
        hint: t("cmd.file.exportAdoc.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToAdoc, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.adoc`, markdownToAdoc(doc.content), "text/asciidoc");
        },
      },
      {
        id: "file.exportOrg",
        label: t("cmd.file.exportOrg"),
        hint: t("cmd.file.exportOrg.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToOrg, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.org`, markdownToOrg(doc.content), "text/x-org");
        },
      },
      {
        id: "file.exportOpml",
        label: t("cmd.file.exportOpml"),
        hint: t("cmd.file.exportOpml.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToOpml, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(`${baseName}.opml`, markdownToOpml(doc.content, baseName), "text/x-opml");
        },
      },
      {
        id: "file.exportReveal",
        label: t("cmd.file.exportReveal"),
        hint: t("cmd.file.exportReveal.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToRevealHtml, downloadText } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          downloadText(
            `${baseName}.slides.html`,
            markdownToRevealHtml(doc.content, baseName),
            "text/html",
          );
        },
      },
      {
        id: "file.exportEpub",
        label: t("cmd.file.exportEpub"),
        hint: t("cmd.file.exportEpub.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToEpubBytes, downloadBytes } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          const bytes = await markdownToEpubBytes(doc.content, baseName);
          downloadBytes(`${baseName}.epub`, bytes, "application/epub+zip");
        },
      },
      {
        id: "file.exportSite",
        label: t("cmd.file.exportSite"),
        hint: t("cmd.file.exportSite.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { markdownToStaticSiteBytes, downloadBytes } = await import("../storage/exportFormats");
          const baseName = doc.name.replace(/\.[^.]+$/, "");
          const bytes = await markdownToStaticSiteBytes(doc.content, baseName);
          downloadBytes(`${baseName}-site.zip`, bytes, "application/zip");
        },
      },
      {
        id: "file.exportPdf",
        label: t("cmd.file.exportPdf"),
        hint: t("cmd.file.exportPdf.hint"),
        icon: cmdIcons.Download,
        group: t("group.file"),
        action: async () => {
          const { printDocument } = await import("../ui/PrintExport");
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
        id: "view.pageView",
        label: t("cmd.view.pageView"),
        hint: pageView ? t("cmd.view.pageView.on") : t("cmd.view.pageView.off"),
        icon: cmdIcons.FileText,
        group: t("group.view"),
        action: () => useAppStore.getState().togglePageView(),
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
        id: "view.smartSearch",
        label: t("cmd.view.smartSearch"),
        hint: t("cmd.view.smartSearch.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.view"),
        action: () => {
          (window as unknown as { __lumenSearchMode?: string }).__lumenSearchMode = "smart";
          setSearchOpen(true);
        },
      },
      ...(setRuntimeMetricsOpen
        ? [
            {
              id: "view.runtimeMetrics",
              label: t("cmd.view.runtimeMetrics"),
              hint: t("cmd.view.runtimeMetrics.hint"),
              icon: cmdIcons.BarChart3,
              group: t("group.view"),
              action: () => setRuntimeMetricsOpen(true),
            },
          ]
        : []),
      {
        id: "view.vim",
        label: vimEnabled ? t("cmd.view.vim.off") : t("cmd.view.vim.on"),
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleVim,
      },
      {
        id: "view.spellCheck",
        label: spellCheck
          ? t("cmd.view.spellCheck.off")
          : t("cmd.view.spellCheck.on"),
        hint: t("cmd.view.spellCheck.hint"),
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleSpellCheck,
      },
      {
        id: "view.typewriter",
        label: typewriterMode
          ? t("cmd.view.typewriter.off")
          : t("cmd.view.typewriter.on"),
        hint: t("cmd.view.typewriter.hint"),
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleTypewriter,
      },
      {
        id: "view.grammarCheck",
        label: grammarCheck
          ? t("cmd.view.grammarCheck.off") ?? "Disable grammar check"
          : t("cmd.view.grammarCheck.on") ?? "Enable grammar check (LanguageTool)",
        hint:
          t("cmd.view.grammarCheck.hint") ??
          "Underlines grammar / style / typo issues. Calls LanguageTool — set VITE_LANGUAGETOOL_URL to self-host.",
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleGrammarCheck,
      },
      {
        id: "tools.writingGoal",
        label: writingGoalWords > 0
          ? t("cmd.tools.writingGoal.set", { words: writingGoalWords })
          : t("cmd.tools.writingGoal.unset"),
        hint: t("cmd.tools.writingGoal.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const ans = await uiPrompt({
            message: "Daily writing goal in words (0 to disable):",
            defaultValue: String(writingGoalWords || 500),
          });
          if (ans === null) return;
          setWritingGoal(Number(ans) || 0);
        },
      },
      {
        id: "ai.localToggle",
        label: useLocalAi
          ? (t("cmd.ai.privacy.off") ?? "Privacy Mode: turn off (use cloud AI)")
          : (t("cmd.ai.privacy.on") ?? "Privacy Mode: run AI on this device (WebGPU)"),
        hint:
          t("cmd.ai.privacy.hint") ??
          "When ON, every AI prompt runs locally via @mlc-ai/web-llm. No data leaves your browser.",
        icon: cmdIcons.Sparkles,
        group: t("group.ai"),
        action: async () => {
          if (!useLocalAi) {
            // Going Local — verify WebGPU support before flipping.
            const { localLlmAvailable } = await import("../ai/localLlm");
            const status = localLlmAvailable();
            if (!status.available) {
              showAiToast(
                `Privacy Mode unavailable: ${status.reason}. Falls back to cloud AI.`,
                "error",
              );
              return;
            }
            showAiToast(
              "🛡️  Privacy Mode ON — first prompt downloads the model (~4 GB) into your browser; subsequent prompts are fully local.",
              "info",
            );
          } else {
            showAiToast("🌐 Privacy Mode OFF — switched back to cloud AI", "info");
          }
          toggleLocalAi();
        },
      },
      {
        id: "tools.autoTag",
        label: t("cmd.tools.autoTag"),
        hint: t("cmd.tools.autoTag.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          try {
            showAiToast("🏷️  Suggesting tags…", "info");
            const { suggestTags, mergeTagsIntoFrontmatter } = await import("../ai/agents");
            const tags = await suggestTags(doc.content);
            if (tags.length === 0) {
              showAiToast("No tag suggestions returned", "info");
              return;
            }
            const accept = await uiPrompt({
              message: `Suggested tags:\n  ${tags.join(", ")}\n\nPress OK to merge into frontmatter, or edit the list (comma-separated):`,
              defaultValue: tags.join(", "),
            });
            if (accept === null) return;
            const final = accept
              .split(/[,\s]+/)
              .map((s) => s.trim().toLowerCase())
              .filter((s) => s.length > 1);
            if (final.length === 0) return;
            setContent(mergeTagsIntoFrontmatter(doc.content, final));
            showAiToast(`✅ Added ${final.length} tag${final.length === 1 ? "" : "s"}`, "success");
          } catch (e) {
            showAiToast(`Auto-tag failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "tools.suggestLinks",
        label: t("cmd.tools.suggestLinks"),
        hint: t("cmd.tools.suggestLinks.hint"),
        icon: cmdIcons.Link,
        group: t("group.tools"),
        action: async () => {
          if (!doc.workspaceName) {
            await uiAlert({ message: "Open the file from your workspace first — the link agent reads neighboring notes." });
            return;
          }
          try {
            showAiToast("🔗 Scanning workspace for link suggestions…", "info");
            const { suggestLinks, applyLinkSuggestion } = await import("../ai/agents");
            const suggestions = await suggestLinks(doc.workspaceName, doc.content);
            if (suggestions.length === 0) {
              showAiToast("No link suggestions", "info");
              return;
            }
            const summary = suggestions
              .map((s, i) => `${i + 1}. "${s.phrase}" → [[${s.target}]] · ${s.reason}`)
              .join("\n");
            const accept = await uiPrompt({
              message: `Found ${suggestions.length} link suggestions:\n\n${summary}\n\nApply all? (Type 'no' to skip)`,
              defaultValue: "yes",
            });
            if (!accept || accept.toLowerCase().startsWith("n")) return;
            let next = doc.content;
            let applied = 0;
            for (const s of suggestions) {
              const updated = applyLinkSuggestion(next, s);
              if (updated !== next) {
                applied++;
                next = updated;
              }
            }
            setContent(next);
            showAiToast(`✅ Applied ${applied} link${applied === 1 ? "" : "s"}`, "success");
          } catch (e) {
            showAiToast(`Link suggest failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.productAgent",
        label: t("cmd.ai.productAgent", { defaultValue: "AI: Create Product" }),
        hint: t("cmd.ai.productAgent.hint", { defaultValue: "Generate a complete project from a description" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const idea = await uiPrompt({
            message: "Describe the product you want to create:\n(e.g., 'A todo app with drag-and-drop, dark mode, and local storage')",
          });
          if (!idea) return;
          try {
            showAiToast("🚀 Product Agent starting...", "info");
            const { createProduct } = await import("../ai/productAgent");
            const result = await createProduct(idea, (progress) => {
              showAiToast(`${progress.phase}: ${progress.message}`, "info");
            });
            if (result.success) {
              showAiToast(`✅ Product created! ${result.files.size} files generated`, "success");
              const summary = `# Product Created\n\n${result.files.size} files generated:\n\n${[...result.files.keys()].map((f) => `- \`${f}\``).join("\n")}`;
              setContent(summary);
            } else {
              showAiToast(`Product creation failed: ${result.error}`, "error");
            }
          } catch (e) {
            showAiToast(`Agent error: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.diagram",
        label: t("cmd.ai.diagram", { defaultValue: "AI: Diagram from Text" }),
        hint: t("cmd.ai.diagram.hint", { defaultValue: "Generate a Mermaid diagram from the document" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          try {
            showAiToast("🧩 Generating diagram…", "info");
            const { generateDiagram } = await import("../ai/agents");
            const block = await generateDiagram(doc.content);
            setContent(`${doc.content.trimEnd()}\n\n${block}\n`);
            showAiToast("✅ Diagram inserted", "success");
          } catch (e) {
            showAiToast(`Diagram failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.actionItems",
        label: t("cmd.ai.actionItems", { defaultValue: "AI: Extract Action Items" }),
        hint: t("cmd.ai.actionItems.hint", { defaultValue: "Pull a task list out of meeting notes" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          try {
            showAiToast("✅ Extracting action items…", "info");
            const { extractActionItems } = await import("../ai/agents");
            const list = await extractActionItems(doc.content);
            setContent(`${doc.content.trimEnd()}\n\n## Action Items\n\n${list}\n`);
            showAiToast("✅ Action items added", "success");
          } catch (e) {
            showAiToast(`Action items failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.translate",
        label: t("cmd.ai.translate", { defaultValue: "AI: Translate Document" }),
        hint: t("cmd.ai.translate.hint", { defaultValue: "Translate the whole document, preserving formatting" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const target = await uiPrompt({
            message: "Translate the document into which language?\n(e.g. Spanish, עברית, 日本語, Français)",
            defaultValue: "",
          });
          if (!target || !target.trim()) return;
          try {
            showAiToast(`🌐 Translating to ${target}…`, "info");
            const { translateMarkdown } = await import("../ai/agents");
            const translated = await translateMarkdown(doc.content, target.trim());
            setContent(translated);
            showAiToast("✅ Document translated", "success");
          } catch (e) {
            showAiToast(`Translation failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.chart",
        label: t("cmd.ai.chart", { defaultValue: "AI: Chart from Data" }),
        hint: t("cmd.ai.chart.hint", { defaultValue: "Turn CSV or table data into an ECharts chart" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          try {
            showAiToast("📊 Generating chart…", "info");
            const { generateChart } = await import("../ai/agents");
            const block = await generateChart(doc.content);
            setContent(`${doc.content.trimEnd()}\n\n${block}\n`);
            showAiToast("✅ Chart inserted", "success");
          } catch (e) {
            showAiToast(`Chart failed: ${(e as Error).message}`, "error");
          }
        },
      },
      {
        id: "ai.ollamaModels",
        label: t("cmd.ai.ollama", { defaultValue: "AI: Ollama Models" }),
        hint: t("cmd.ai.ollama.hint", { defaultValue: "Switch to a local Ollama model" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const { listOllamaModels, isOllamaAvailable, setOllamaConfig } = await import("../ai/ollamaProvider");
          const { setActiveProvider } = await import("../ai/llm");
          if (!(await isOllamaAvailable())) {
            await uiAlert({ message: "Ollama is not running.\n\nStart it with: ollama serve\nThen try again." });
            return;
          }
          const models = await listOllamaModels();
          if (models.length === 0) {
            await uiAlert({ message: "No models found.\n\nPull a model with: ollama pull llama3.1" });
            return;
          }
          const modelList = models.map((m) => `${m.name} (${(m.size / 1e9).toFixed(1)}GB)`).join("\n");
          const choice = await uiPrompt({
            message: `Available Ollama models:\n\n${modelList}\n\nType the model name to use:`,
            defaultValue: models[0].name,
          });
          if (!choice) return;
          setOllamaConfig({ model: choice.trim() });
          setActiveProvider("ollama");
          showAiToast(`✅ Switched to Ollama: ${choice.trim()}`, "success");
        },
      },
      {
        id: "ai.switchProvider",
        label: t("cmd.ai.provider", { defaultValue: "AI: Switch Provider" }),
        hint: t("cmd.ai.provider.hint", { defaultValue: "Choose between OpenAI, Ollama, or local WebGPU" }),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const { setActiveProvider, getActiveProvider } = await import("../ai/llm");
          const current = getActiveProvider();
          const choice = await uiPrompt({
            message: `Current AI provider: ${current}\n\nChoose provider:\n- openai (cloud, needs API key)\n- anthropic (Claude, cloud, needs API key)\n- gemini (Google, cloud, needs API key)\n- mistral (cloud, needs API key)\n- ollama (local server, needs ollama running)\n- local-webgpu (in-browser, needs WebGPU)\n\nType your choice:`,
            defaultValue: current,
          });
          if (!choice) return;
          const valid = choice.trim().toLowerCase();
          const known = ["openai", "anthropic", "gemini", "mistral", "ollama", "local-webgpu"];
          if (!known.includes(valid)) {
            await uiAlert({ message: `Invalid provider. Choose: ${known.join(", ")}` });
            return;
          }
          setActiveProvider(
            valid as "openai" | "anthropic" | "gemini" | "mistral" | "ollama" | "local-webgpu",
          );
          // Cloud providers other than OpenAI keep their key under
          // lumen.ai.key.<provider>; prompt for it if missing.
          if (valid === "anthropic" || valid === "gemini" || valid === "mistral") {
            const existing = localStorage.getItem(`lumen.ai.key.${valid}`);
            if (!existing) {
              const label =
                valid === "anthropic"
                  ? "Anthropic (Claude)"
                  : valid === "gemini"
                    ? "Google Gemini"
                    : "Mistral";
              const key = await uiPrompt({
                message: `Enter your ${label} API key:`,
                defaultValue: "",
              });
              if (key && key.trim()) localStorage.setItem(`lumen.ai.key.${valid}`, key.trim());
            }
          }
          showAiToast(`✅ AI provider set to: ${valid}`, "success");
        },
      },
      {
        id: "tools.checkGrammar",
        label: t("cmd.tools.grammar"),
        hint: t("cmd.tools.grammar.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          const { checkGrammar } = await import("../ai/grammar");
          try {
            showAiToast("📝 Checking grammar…", "info");
            const matches = await checkGrammar(doc.content, locale === "he" ? "he" : "en-US");
            if (matches.length === 0) {
              showAiToast("✅ No grammar issues found", "success");
              return;
            }
            const top = matches.slice(0, 5).map((m, i) => `${i + 1}. ${m.message}`).join("\n");
            await uiAlert({ message: `Found ${matches.length} issue${matches.length === 1 ? "" : "s"}:\n\n${top}` });
          } catch (e) {
            showAiToast(`Grammar check failed: ${(e as Error).message}`, "error");
          }
        },
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
        label: t("cmd.view.findReplace"),
        shortcut: "⌘H",
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setFindReplaceOpen(true),
      },
      {
        id: "view.graphView",
        label: t("cmd.view.graphView"),
        hint: t("cmd.view.graphView.hint"),
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => {
          setGraphOpen(true);
        },
      },
      {
        id: "view.versionHistory",
        label: t("cmd.view.versionHistory"),
        hint: t("cmd.view.versionHistory.hint"),
        icon: cmdIcons.PanelRightOpen,
        group: t("group.view"),
        action: () => setHistoryOpen(true),
      },
      {
        id: "insert.table",
        label: t("cmd.insert.table"),
        hint: t("cmd.insert.table.hint"),
        icon: cmdIcons.Pencil,
        group: t("group.insert"),
        action: () => setTableEditorOpen(true),
      },
      {
        id: "view.autoSave",
        label: autoSave ? t("cmd.view.autoSave.off") : t("cmd.view.autoSave.on"),
        hint: autoSave ? t("cmd.view.autoSave.hint", { interval: autoSaveInterval / 1000 }) : "off",
        icon: cmdIcons.Pencil,
        group: t("group.view"),
        action: toggleAutoSave,
      },
      {
        id: "view.canvas",
        label: t("cmd.view.canvas"),
        hint: t("cmd.view.canvas.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.view"),
        action: () => setCanvasOpen(true),
      },
      {
        id: "view.plugins",
        label: t("cmd.view.plugins"),
        hint: t("cmd.view.plugins.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.view"),
        action: () => setGalleryOpen(true),
      },
      ...(setTemplateGalleryOpen
        ? [
            {
              id: "templates.open",
              label: t("cmd.templates.open"),
              hint: t("cmd.templates.open.hint"),
              icon: cmdIcons.Sparkles,
              group: t("group.view"),
              action: () => setTemplateGalleryOpen(true),
            },
          ]
        : []),
      ...(setAuditLogOpen
        ? [
            {
              id: "audit.open",
              label: t("cmd.audit.open"),
              hint: t("cmd.audit.open.hint"),
              icon: cmdIcons.Sparkles,
              group: t("group.security"),
              action: () => setAuditLogOpen(true),
            },
          ]
        : []),
      ...(setFineTuneOpen
        ? [
            {
              id: "ai.fineTune",
              label: t("cmd.fineTune.open"),
              hint: t("cmd.fineTune.open.hint"),
              icon: cmdIcons.Sparkles,
              group: t("group.ai"),
              action: () => setFineTuneOpen(true),
            },
          ]
        : []),
      ...(setTagsPanelOpen
        ? [
            {
              id: "view.tags",
              label: t("cmd.view.tags"),
              hint: t("cmd.view.tags.hint"),
              icon: cmdIcons.Link,
              group: t("group.view"),
              action: () => setTagsPanelOpen(true),
            },
          ]
        : []),
      ...(collab && setCommentsPanelOpen
        ? [
            {
              id: "collab.viewComments",
              label: t("cmd.collab.viewComments"),
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: () => setCommentsPanelOpen(true),
            },
          ]
        : []),
      ...(collab && onAddComment
        ? [
            {
              id: "collab.addComment",
              label: t("cmd.collab.addComment"),
              hint: t("cmd.collab.addComment.hint"),
              icon: cmdIcons.Link,
              group: t("group.collab"),
              action: onAddComment,
            },
          ]
        : []),
      ...TEMPLATES.map((tpl) => ({
        id: `template.${tpl.id}`,
        label: `${t("group.templates")}: ${tpl.name}`,
        hint: tpl.category,
        icon: cmdIcons.FileText,
        group: t("group.templates"),
        action: () => {
          setContent(tpl.content);
          setDoc({ name: `${tpl.name}.md`, dirty: true });
        },
      })),
      // ── Voice-to-Markdown ─────────────────────────────────────────────────
      {
        id: "voice.dictate",
        label: t("cmd.tools.voice"),
        hint: t("cmd.tools.voice.hint"),
        icon: cmdIcons.Sparkles,
        group: t("group.tools"),
        action: async () => {
          // Language selector
          const langMap: Record<string, string> = {
            "English": "en-US", "Hebrew (עברית)": "he-IL", "Arabic (العربية)": "ar-SA",
            "Russian (Русский)": "ru-RU", "Spanish": "es-ES", "French": "fr-FR",
            "German": "de-DE", "Chinese (中文)": "zh-CN", "Japanese (日本語)": "ja-JP",
          };
          const langChoice = await uiPrompt({
            message: "Select language for voice recognition:",
            placeholder: "English",
          });
          const lang = langMap[langChoice ?? ""] ?? (useAppStore.getState().locale === "he" ? "he-IL" : "en-US");

          startVoiceRecording(lang);
        },
      },
      // ── Plugin Commands ──────────────────────────────────────────────────
      ...getPluginCommands().map((cmd) => ({
        id: cmd.id,
        label: cmd.label,
        hint: cmd.hint ?? t("group.plugins"),
        icon: cmdIcons.Sparkles,
        group: t("group.plugins"),
        action: cmd.action,
      })),
      // ── Encryption ────────────────────────────────────────────────────────
      {
        id: "vault.encrypt",
        label: t("cmd.security.encrypt"),
        hint: t("cmd.security.encrypt.hint"),
        icon: cmdIcons.Save,
        group: t("group.security"),
        action: async () => {
          const password = await uiPrompt({ message: "Enter encryption password:" });
          if (!password) return;
          const encrypted = await encryptDocument(doc.content, password);
          setContent(encrypted);
          showAiToast("🔒 Document encrypted", "info");
        },
      },
      {
        id: "vault.decrypt",
        label: t("cmd.security.decrypt"),
        hint: t("cmd.security.decrypt.hint"),
        icon: cmdIcons.Save,
        group: t("group.security"),
        action: async () => {
          if (!isEncrypted(doc.content)) {
            showAiToast("Document is not encrypted", "error");
            return;
          }
          const password = await uiPrompt({ message: "Enter decryption password:" });
          if (!password) return;
          try {
            const decrypted = await decryptDocument(doc.content, password);
            setContent(decrypted);
            showAiToast("🔓 Document decrypted", "info");
          } catch {
            showAiToast("❌ Wrong password", "error");
          }
        },
      },
      // ── Multi-Language AI Prompts (filtered by user locale) ───────────────
      ...AI_PROMPT_TEMPLATES.filter((tpl) => tpl.lang === locale).map((tpl) => ({
        id: `ai.prompt.${tpl.id}`,
        label: tpl.label,
        hint: tpl.category,
        icon: cmdIcons.Sparkles,
        group: t("group.ai"),
        action: async () => {
          const prompt = applyTemplate(tpl, doc.content);
          try {
            showAiToast(`🤖 Processing ${tpl.label}...`, "info");
            const { chat } = await import("../ai/llm");
            const result = await chat([{ role: "user", content: prompt }]);
            setContent(doc.content + "\n\n---\n\n" + result);
            showAiToast(`✅ ${tpl.label} completed`, "success");
          } catch (e) {
            showAiToast(`AI error: ${(e as Error).message}`, "error");
          }
        },
      })),
      // ── AI Capabilities ──────────────────────────────────────────────────
      buildAiSettingsCommand(),
      buildAiOutlineCommand(
        () => useAppStore.getState().doc.content,
        (s: string) => useAppStore.getState().setContent(s),
      ),
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
            log.warn("AI commit generation skipped", e);
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
        id: "git.watch",
        label: t("cmd.git.watch"),
        hint: t("cmd.git.watch.hint"),
        icon: cmdIcons.Download,
        group: t("group.git"),
        action: async () => {
          const { isWatching, setWatching, startGitWatch, stopGitWatch } = await import("../sync/gitWatch");
          if (isWatching()) {
            stopGitWatch();
            setWatching(false);
            showAiToast("⏸ Git watch paused", "info");
            return;
          }
          if (!doc.workspaceName) {
            await uiAlert({ message: t("git.prompt.openFileFirst") });
            return;
          }
          const repoFolder = doc.workspaceName.split("/")[0];
          setWatching(true);
          startGitWatch({
            repoFolder,
            onPulled: ({ changedFiles }) =>
              showAiToast(`⬇️ Pulled ${changedFiles} file${changedFiles === 1 ? "" : "s"}`, "success"),
          });
          showAiToast("👀 Git watch on — pulling every 5 min", "info");
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
    theme,
    setRuntimeMetricsOpen,
  ]);
}
