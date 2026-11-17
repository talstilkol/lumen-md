/**
 * "Create a syllabus…" (plan W12.H5), the palette command's body: pick the
 * institution's academic calendar (an .ics file in the vault: a calendar
 * subscription saved there, or the file the institution publishes), name the
 * course, and get a syllabus note with one heading per teaching week of the
 * current (or next) semester, its dates and its days off (./syllabus.ts).
 *
 * Nothing is fetched here: the calendar is read from the vault.
 */
import { t } from "../i18n";
import "./syllabusStrings";
import { defaultIsrael } from "../daily/hebrewCalendar";
import { defaultWorkWeek, type WorkWeek } from "../daily/israeliTime";
import { semesterFor, syllabusTemplate, teachingWeeks, type TeachingWeek } from "./syllabus";
import { explainError } from "../lib/userError";

export const SYLLABUS_FOLDER = "Syllabus";

export interface SyllabusDraft {
  path: string;
  md: string;
  weeks: TeachingWeek[];
}

/** The note for a course on this calendar, or why there is none. Pure. */
export function draftSyllabus(input: { ics: string; title: string; lang: "he" | "en"; israel: boolean; workWeek?: WorkWeek; today: string }): SyllabusDraft | { error: "noSemester" | "noWeeks" } {
  const sem = semesterFor(input.ics, input.today);
  if (!sem) return { error: "noSemester" };
  const weeks = teachingWeeks(sem, { israel: input.israel, workWeek: input.workWeek ?? defaultWorkWeek(input.israel) });
  if (!weeks.length) return { error: "noWeeks" };
  const name = input.title.trim().replace(/[\\/:*?"<>|]/g, "-") || t("syllabus.defaultTitle");
  return { path: `${SYLLABUS_FOLDER}/${name}.md`, md: syllabusTemplate(weeks, input.lang, input.title.trim() || name), weeks };
}

const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The palette command: asks, writes the note, opens it. */
export async function createSyllabus(now = new Date()): Promise<void> {
  const [{ uiAlert, uiPrompt, uiSelect }, ws, { useAppStore }, { useToastStore }] = await Promise.all([
    import("../ui/PromptDialog"),
    import("../storage/workspace"),
    import("../store/useStore"),
    import("../store/useToastStore"),
  ]);
  const calendars = (await ws.listWorkspace({ includeAssets: true })).filter((e) => /\.ics$/i.test(e.name)).map((e) => e.path);
  if (!calendars.length) {
    await uiAlert({ message: t("syllabus.noCalendar") });
    return;
  }
  const calendar = calendars.length === 1 ? calendars[0] : await uiSelect({ message: t("syllabus.pickCalendar"), choices: calendars.map((p) => ({ value: p, label: p })) });
  if (!calendar) return;
  const title = await uiPrompt({ message: t("syllabus.titlePrompt"), defaultValue: "" });
  if (title === null) return;
  const store = useAppStore.getState();
  const lang = store.locale === "he" ? "he" : "en";
  const daily = store.dailyNotes;
  const israel = daily.israel ?? defaultIsrael(store.locale);
  try {
    const d = draftSyllabus({ ics: await ws.readWorkspaceFile(calendar), title, lang, israel, workWeek: daily.workWeek, today: todayIso(now) });
    if ("error" in d) {
      await uiAlert({ message: t(d.error === "noSemester" ? "syllabus.noSemester" : "syllabus.noWeeks", { calendar }) });
      return;
    }
    const path = await ws.uniqueWorkspaceName(d.path);
    await ws.createWorkspaceFolder(SYLLABUS_FOLDER).catch(() => {
      // why: the folder already exists; the write below fails loudly if it really is missing
    });
    await ws.writeWorkspaceFile(path, d.md);
    window.dispatchEvent(new CustomEvent("lumen-workspace-changed"));
    store.openTab({ name: path.split("/").pop()!, content: d.md, workspaceName: path });
    useToastStore.getState().push({ kind: "success", title: t("syllabus.created", { weeks: d.weeks.length, from: d.weeks[0].from, to: d.weeks.at(-1)!.to }) });
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("syllabus.failed", { error: explainError(e) }) });
  }
}
