/**
 * Local writing checks in the palette (wave 13, W13.W11–W15): rule engines
 * and local models that only propose — every change goes through the
 * review panel. Everything is loaded on use, in its own chunk.
 */
import { cmdIcons } from "../../ui/cmdIcons";
import type { Command } from "../../ui/CommandPalette";
import { useAppStore } from "../../store/useStore";
import { t } from "../../i18n";
import type { CommandContext } from "./context";

export function buildWritingCheckCommands({ getEditorView, liveDoc }: CommandContext): Command[] {
  const target = () => {
    const doc = liveDoc();
    const content = () => getEditorView?.()?.state.doc.toString() ?? useAppStore.getState().doc.content;
    return { getView: () => getEditorView?.() ?? null, getContent: content, path: doc.workspaceName ?? null, lang: (useAppStore.getState().locale === "he" ? "he" : "en") as "he" | "en" };
  };
  return [
    {
      id: "writing.repetition",
      label: t("cmd.writing.repetition"),
      hint: t("cmd.writing.repetition.hint"),
      icon: cmdIcons.Pencil,
      group: t("group.edit"),
      action: async () => {
        const [{ openWritingChecksDialog }, { detectRepetition }] = await Promise.all([import("../../ui/WritingChecksDialog"), import("../../agents/writing/repetition")]);
        const tg = target();
        openWritingChecksDialog({ ...tg, check: "repetition", run: (text, s) => detectRepetition(text, { ...s, lang: tg.lang }) });
      },
    },
    {
      id: "writing.loanwords",
      label: t("cmd.writing.loanwords"),
      hint: t("cmd.writing.loanwords.hint"),
      icon: cmdIcons.Pencil,
      group: t("group.edit"),
      action: async () => {
        const [{ openWritingChecksDialog }, { detectLoanwords }] = await Promise.all([import("../../ui/WritingChecksDialog"), import("../../agents/writing/loanwords")]);
        const tg = target();
        openWritingChecksDialog({ ...tg, check: "loanwords", run: (text, s) => detectLoanwords(text, { register: s.register, disabledTerms: s.disabledTerms, lang: tg.lang }) });
      },
    },
    {
      id: "writing.explainChange",
      label: t("cmd.writing.explainChange"),
      hint: t("cmd.writing.explainChange.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.edit"),
      action: () => import("./writingChecksActions").then((m) => m.explainChangeFlow(target())),
    },
    {
      id: "writing.goals",
      label: t("cmd.writing.goals"),
      hint: t("cmd.writing.goals.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.edit"),
      action: () => import("../../ui/GoalsDialog").then((m) => m.openGoalsDialog()),
    },
  ];
}
