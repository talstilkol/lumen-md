/**
 * The Israeli academic calendar (plan W7.8), in the palette: choose the
 * institution and year (the daily note's {{academic}} line follows it), and
 * export that year as an ICS file. Nothing goes over the network: the data
 * is in the app. What the commands do loads on use (academic/commandActions.ts).
 */
import { t } from "../../i18n";
import { cmdIcons } from "../../ui/cmdIcons";
import type { Command } from "../../ui/CommandPalette";

const actions = () => import("../../academic/commandActions");

export function buildAcademicCommands(): Command[] {
  const group = t("group.tools");
  return [
    {
      id: "academic.choose",
      label: t("cmd.academic.choose"),
      hint: t("cmd.academic.choose.hint"),
      icon: cmdIcons.FileText,
      group,
      action: async () => (await actions()).chooseAcademicCalendar(),
    },
    {
      id: "academic.ics",
      label: t("cmd.academic.ics"),
      hint: t("cmd.academic.ics.hint"),
      icon: cmdIcons.Download,
      group,
      action: async () => (await actions()).exportAcademicIcs(),
    },
  ];
}
