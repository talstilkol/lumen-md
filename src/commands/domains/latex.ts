/**
 * Academic LaTeX export with Hebrew (plan W5.22) in the palette: the open
 * note as a ZIP with main.tex (babel, Hebrew right to left, math, natbib
 * citations from Pandoc [@key]), the cited BibTeX entries and the images.
 */
import { t } from "../../i18n";
import { cmdIcons } from "../../ui/cmdIcons";
import type { Command } from "../../ui/CommandPalette";
import type { CommandContext } from "./context";

export function buildLatexCommands({ liveDoc }: CommandContext): Command[] {
  return [
    {
      id: "export.latexProject",
      label: t("cmd.export.latexProject"),
      hint: t("cmd.export.latexProject.hint"),
      icon: cmdIcons.Download,
      group: t("group.file"),
      action: async () => {
        // Snapshot before the import: a tab switch while the chunk loads must not export another note.
        const doc = liveDoc();
        await (await import("./latexActions")).exportLatexFor(doc);
      },
    },
    {
      // W10.E14 (plan W5.22 step 3): compiled by the user's Tectonic on the desktop.
      id: "export.latexPdf",
      label: t("cmd.export.latexPdf"),
      hint: t("cmd.export.latexPdf.hint"),
      icon: cmdIcons.Printer,
      group: t("group.file"),
      action: async () => {
        const doc = liveDoc();
        await (await import("./latexActions")).exportLatexPdfFor(doc);
      },
    },
  ];
}
