/**
 * The L5 writing checkers in the palette (W13.W6–W10). Each one runs on
 * this device, with no network and no model unless a local one is set up,
 * and only suggests: edits are staged in the review panel (accept or
 * reject each one), comments go to a report note that is itself staged.
 *
 *  - writing.consistency  the whole vault, against the entity graph (W13.W6)
 *  - writing.structure    the open note's structure, comments only (W13.W7)
 *  - writing.argument     the open note's argument and logic (W13.W8)
 *  - writing.readability  the open note's readability level (W13.W9)
 *  - writing.harper       English grammar with Harper (W13.W10)
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import type { CommandContext } from "./context";

const flow = (ctx: CommandContext, name: "consistencyFlow" | "structureFlow" | "argumentFlow" | "readabilityFlow" | "harperFlow") => () =>
  void import("./writingChecksActions").then((m) => m[name]({ getEditorView: ctx.getEditorView, liveDoc: ctx.liveDoc }));

export function buildWritingCheckCommands(ctx: CommandContext): Command[] {
  const group = t("group.tools");
  return [
    { id: "writing.consistency", label: t("cmd.writing.consistency"), hint: t("cmd.writing.consistency.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "consistencyFlow") },
    { id: "writing.structure", label: t("cmd.writing.structure"), hint: t("cmd.writing.structure.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "structureFlow") },
    { id: "writing.argument", label: t("cmd.writing.argument"), hint: t("cmd.writing.argument.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "argumentFlow") },
    { id: "writing.readability", label: t("cmd.writing.readability"), hint: t("cmd.writing.readability.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "readabilityFlow") },
    { id: "writing.harper", label: t("cmd.writing.harper"), hint: t("cmd.writing.harper.hint"), icon: cmdIcons.Sparkles, group, action: flow(ctx, "harperFlow") },
  ];
}
