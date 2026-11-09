/** Accessibility commands (plan W1.23): what the editor announces, "where am I", the accessibility statement. */
import { cmdIcons, type Command } from "../../ui/CommandPalette";
import { getLocale, t } from "../../i18n";
import { announce, nextVerbosity, setVerbosity, verbosity } from "../../a11y/announce";
import { describePosition } from "../../editor/srAnnouncements";
import { docsUrl } from "../../lib/docsLinks";
import type { CommandContext } from "./context";

export function buildAccessibilityCommands({ getEditorView }: CommandContext): Command[] {
  return [
    {
      id: "a11y.srVerbosity",
      label: t("cmd.a11y.srVerbosity", { mode: t(`sr.mode.${verbosity()}`) }),
      hint: t("cmd.a11y.srVerbosity.hint"),
      icon: cmdIcons.Eye,
      group: t("group.view"),
      action: () => {
        const next = nextVerbosity(verbosity());
        setVerbosity(next);
        announce(t("cmd.a11y.srVerbosity", { mode: t(`sr.mode.${next}`) }));
      },
    },
    {
      id: "a11y.whereAmI",
      label: t("cmd.a11y.whereAmI"),
      hint: t("cmd.a11y.whereAmI.hint"),
      icon: cmdIcons.Eye,
      group: t("group.view"),
      action: () => {
        const view = getEditorView?.();
        if (view) announce(describePosition(view));
      },
    },
    {
      id: "help.a11yStatement",
      label: t("cmd.help.a11yStatement"),
      hint: t("cmd.help.a11yStatement.hint"),
      icon: cmdIcons.FileText,
      group: t("group.file"),
      action: () => window.open(docsUrl("a11yStatement", undefined, getLocale() === "he" ? "he" : undefined), "_blank", "noopener,noreferrer"),
    },
  ];
}
