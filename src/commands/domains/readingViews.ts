/**
 * Reading views in the palette (plan W13.R6–R9): the linked three-column
 * view and the keyboard between columns (R7), the margins mode (R9), book
 * pages (R6). The bodies load on use.
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import type { CommandContext } from "./context";
import { useAppStore } from "../../store/useStore";
import { BOOK_SPREAD_TOGGLE } from "../../reading/noteSpreadHook";

export function buildReadingViewCommands(_ctx: CommandContext): Command[] {
  const group = t("group.view");
  return [
    {
      id: "view.tripleLinked",
      label: t("cmd.view.tripleLinked"),
      hint: t("cmd.view.tripleLinked.hint"),
      icon: cmdIcons.Columns2,
      group,
      action: () => import("../../reading/readingColumns").then((m) => m.openTripleView()),
    },
    {
      id: "view.columnNext",
      label: t("cmd.view.columnNext"),
      hint: t("cmd.view.columnNext.hint"),
      group,
      action: () => import("../../reading/readingColumns").then((m) => m.moveColumn(document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight")),
    },
    {
      id: "view.columnPrev",
      label: t("cmd.view.columnPrev"),
      hint: t("cmd.view.columnPrev.hint"),
      group,
      action: () => import("../../reading/readingColumns").then((m) => m.moveColumn(document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft")),
    },
    {
      id: "reading.sidenotes",
      label: t("cmd.reading.sidenotes"),
      hint: t("cmd.reading.sidenotes.hint"),
      icon: cmdIcons.Columns2,
      group,
      action: () => import("../../reading/sidenotes").then((m) => m.toggleSidenotes()),
    },
    {
      id: "reading.bookSpread",
      label: t("cmd.reading.bookSpread"),
      hint: t("cmd.reading.bookSpread.hint"),
      icon: cmdIcons.Columns2,
      group,
      action: () => {
        // The pages are the preview's: show it first when only an editor is on screen.
        const { mode, setMode } = useAppStore.getState();
        if (mode === "source" || mode === "wysiwyg") setMode("preview");
        setTimeout(() => window.dispatchEvent(new CustomEvent(BOOK_SPREAD_TOGGLE)), mode === "source" || mode === "wysiwyg" ? 300 : 0);
      },
    },
  ];
}
