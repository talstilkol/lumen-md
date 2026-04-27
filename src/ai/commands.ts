/**
 * AI-related command definitions extracted from App.tsx.
 * Reduces App.tsx size and centralizes AI command logic.
 */

import type { Command } from "../ui/CommandPalette";
import { cmdIcons } from "../ui/CommandPalette";
import { useAppStore } from "../store/useStore";
import { uiPrompt, uiAlert } from "../ui/PromptDialog";
import { t } from "../i18n";
import { log } from "../lib/logger";
import { gitStatusSummary } from "../sync/git";
import { showAiToast } from "../ui/AiToast";

/**
 * Build the AI Settings command for the palette.
 */
export function buildAiSettingsCommand(): Command {
  return {
    id: "ai.settings",
    label: t("cmd.ai.settings", { defaultValue: "AI: Configure Connection" }),
    hint: t("cmd.ai.settings.hint", { defaultValue: "Set OpenAI/WebLLM Key" }),
    icon: cmdIcons.Sparkles,
    group: t("group.ai", { defaultValue: "AI Copilot" }),
    action: async () => {
      const currentKey = useAppStore.getState().aiKey;
      const key = await uiPrompt({
        message: t("ai.prompt.key", {
          defaultValue:
            "Enter OpenAI / Anthropic API Key (or leave blank for local WebLLM)",
        }),
        defaultValue: currentKey || "",
      });
      if (key !== null) {
        useAppStore.getState().setAiKey(key.trim() || null);
        await uiAlert({
          message: t("ai.alert.keySaved", {
            defaultValue: "AI Key settings updated!",
          }),
        });
      }
    },
  };
}

/**
 * Generate an AI-powered commit message based on git status.
 * Returns empty string if AI is not available.
 */
export async function generateAiCommitMessage(
  repoFolder: string,
): Promise<string> {
  try {
    const { chat } = await import("./llm");
    const { PROMPTS } = await import("./prompts");
    const summary = await gitStatusSummary(repoFolder);
    const changes = summary.entries
      .filter((e) => e.state !== "unmodified")
      .map((e) => `${e.state.toUpperCase()}: ${e.path}`)
      .join("\n");

    if (!changes) return "";

    return await chat(
      [
        { role: "system", content: PROMPTS.commitMessage },
        { role: "user", content: `Changes:\n${changes}` },
      ],
      { maxTokens: 30 },
    );
  } catch (e) {
    log.warn("AI commit generation skipped", e);
    showAiToast("AI commit suggestion unavailable", "info");
    return "";
  }
}
