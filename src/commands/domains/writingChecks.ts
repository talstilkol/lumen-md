/**
 * The local writing checkers in the palette, each on this device, with no
 * network and no model unless a local one is set up. They only suggest:
 * edits are staged in the review panel (accept or reject each one), and
 * comments go to a report note that is itself staged.
 *
 * W13.W6–W10 (L5):
 *  - writing.consistency  the whole vault, against the entity graph (W13.W6)
 *  - writing.structure    the open note's structure, comments only (W13.W7)
 *  - writing.argument     the open note's argument and logic (W13.W8)
 *  - writing.readability  the open note's readability level (W13.W9)
 *  - writing.harper       English grammar with Harper (W13.W10)
 * W13.W11–W15 (L6): repetition and clichés, loanwords, explain my change,
 * writing goals. Everything is loaded on use, in its own chunk.
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import { useAppStore } from "../../store/useStore";
import type { CommandContext } from "./context";

const flow = (ctx: CommandContext, name: "consistencyFlow" | "structureFlow" | "argumentFlow" | "readabilityFlow" | "harperFlow") => () =>
  void import("./writingChecksActions").then((m) => m[name]({ getEditorView: ctx.getEditorView, liveDoc: ctx.liveDoc }));

export function buildWritingCheckCommands(ctx: CommandContext): Command[] {
  const group = t("group.tools");
  const { getEditorView, liveDoc } = ctx;
  const target = () => {
    const doc = liveDoc();
    const content = () => getEditorView?.()?.state.doc.toString() ?? useAppStore.getState().doc.content;
    return { getView: () => getEditorView?.() ?? null, getContent: content, path: doc.workspaceName ?? null, lang: (useAppStore.getState().locale === "he" ? "he" : "en") as "he" | "en" };
  };
  return [
    { id: "writing.consistency", label: t("cmd.writing.consistency"), hint: t("cmd.writing.consistency.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "consistencyFlow") },
    { id: "writing.structure", label: t("cmd.writing.structure"), hint: t("cmd.writing.structure.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "structureFlow") },
    { id: "writing.argument", label: t("cmd.writing.argument"), hint: t("cmd.writing.argument.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "argumentFlow") },
    { id: "writing.readability", label: t("cmd.writing.readability"), hint: t("cmd.writing.readability.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "readabilityFlow") },
    { id: "writing.harper", label: t("cmd.writing.harper"), hint: t("cmd.writing.harper.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "harperFlow") },
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
      id: "writing.abstract",
      label: t("cmd.writing.abstract"),
      hint: t("cmd.writing.abstract.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.edit"),
      action: () => import("./writingChecksActions").then((m) => m.abstractFlow(target())),
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
