/**
 * What the academic-calendar commands do (plan W7.8), loaded when one runs:
 * choose the institution and year, export the chosen year as ICS. The
 * palette entries are in commands/domains/academic.ts. ./app (and with it
 * the academic strings) loads here with a dynamic import: it is a lazy-English
 * user (i18nLazyEnglish).
 */
import { t } from "../i18n";
import { uiAlert, uiSelect } from "../ui/PromptDialog";
import { useToastStore } from "../store/useToastStore";

const app = () => import("./app");

export async function chooseAcademicCalendar(): Promise<void> {
  const { CALENDARS, choose } = await app();
  const pick = await uiSelect({
    message: t("academic.pick"),
    choices: [{ value: "", label: t("academic.none") }, ...CALENDARS.map((c) => ({ value: `${c.institution.id}/${c.year}`, label: `${c.institution.he} ${c.label}${c.verified ? "" : ` (${t("academic.unverified")})`}` }))],
  });
  if (pick === null) return;
  const c = CALENDARS.find((x) => `${x.institution.id}/${x.year}` === pick) ?? null;
  choose(c);
  if (c && !c.verified) await uiAlert({ message: t("academic.chosenUnverified", { name: c.institution.he }) });
  else if (c) useToastStore.getState().push({ kind: "success", title: t("academic.chosen", { name: `${c.institution.he} ${c.label}` }) });
}

export async function exportAcademicIcs(): Promise<void> {
  const { chosen, downloadIcs } = await app();
  const c = chosen();
  if (!c) {
    await uiAlert({ message: t("academic.noChoice") });
    return;
  }
  if (!c.verified) {
    await uiAlert({ message: t("academic.chosenUnverified", { name: c.institution.he }) });
    return;
  }
  downloadIcs(c);
  useToastStore.getState().push({ kind: "success", title: t("academic.exported", { file: `${c.institution.id}-${c.year}.ics` }) });
}
