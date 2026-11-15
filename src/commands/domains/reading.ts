/**
 * The reading list's palette entries (plan W12.X2): a new source note from
 * an item of the citation library (Zotero, BibTeX, CSL-JSON), and from a
 * page captured with the web clipper. The bodies load on first use
 * (readingActions.ts), so the startup bundle holds only these entries.
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import type { CommandContext } from "./context";

export function buildReadingCommands(ctx: CommandContext): Command[] {
  const group = t("group.insert");
  return [
    {
      id: "reading.newFromLibrary",
      label: t("cmd.reading.newFromLibrary"),
      hint: t("cmd.reading.newFromLibrary.hint"),
      icon: cmdIcons.Quote,
      group,
      action: () => import("./readingActions").then((m) => m.newSourceFromLibrary()),
    },
    {
      id: "reading.newFromCapture",
      label: t("cmd.reading.newFromCapture"),
      hint: t("cmd.reading.newFromCapture.hint"),
      icon: cmdIcons.Link,
      group,
      action: () => import("./readingActions").then((m) => m.newSourceFromCapture(ctx)),
    },
  ];
}
