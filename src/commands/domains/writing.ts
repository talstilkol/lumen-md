/**
 * The writing agents' palette entries (plan W13.W1–W5). Every entry runs an
 * agent on this device that proposes changes; the suggestions panel shows
 * them, and nothing changes in the note until the user accepts. The bodies
 * load on first use (writingActions.ts), so the startup bundle holds only
 * these entries. Later writing agents (W13.W6–W15) add their entries here.
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import type { CommandContext } from "./context";

type Run = { agent: string; options?: Record<string, unknown> };

export function buildWritingCommands(ctx: CommandContext): Command[] {
  const group = t("group.tools");
  const run = (r: Run) => () => void import("./writingActions").then((m) => m.runWritingAgent(ctx, r.agent, r.options));
  const entry = (id: string, r: Run): Command => ({ id: `writing.${id}`, label: t(`cmd.writing.${id}`), hint: t(`cmd.writing.${id}.hint`), icon: cmdIcons.Sparkles, group, action: run(r) });
  return [
    entry("proofreadHe", { agent: "proofreaderHe" }),
    {
      id: "writing.panel",
      label: t("cmd.writing.panel"),
      hint: t("cmd.writing.panel.hint"),
      icon: cmdIcons.Sparkles,
      group,
      action: () => void import("./writingActions").then((m) => m.showWritingPanel(ctx)),
    },
  ];
}
