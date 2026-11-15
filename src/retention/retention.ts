/**
 * Retention loops (plan W11.P15), the app side: when today's daily note
 * opens, "On this day" and (on the first day of the week) the past week's
 * summary are written into it, each only while its flag is on. Everything is
 * read from the vault index on this device; nothing is sent. Turning a loop
 * off removes its block from today's note the next time it opens.
 */
import "./retentionStrings";
import { t } from "../i18n";
import { isEnabled } from "../flags/flags";
import { dailyPath, isIsrael, type Day } from "../daily/dailyNote";
import type { DailySettings } from "../daily/defaults";
import { OTD_END, OTD_START, WEEK_END, WEEK_START, isWeekStart, onThisDay, renderOnThisDay, renderWeek, upsertBlock, weekData, type RetentionNote, type RetentionWords } from "./core";

export const ON_THIS_DAY = "retention.onThisDay";
export const WEEKLY = "retention.weeklySummary";

export function retentionWords(): RetentionWords {
  return {
    onThisDay: t("retention.onThisDay"),
    created: t("retention.created"),
    week: (from, to) => t("retention.week", { from, to }),
    edited: (n) => t("retention.edited", { n }),
    nothingEdited: t("retention.nothingEdited"),
    done: (n) => t("retention.done", { n }),
    tags: t("retention.tags"),
    words: (n) => t("retention.words", { n }),
    more: (n) => t("retention.more", { n }),
    turnOff: t("retention.turnOff"),
  };
}

/** Today's note text with the loops' blocks as the flags say: added, refreshed or removed. */
export function applyRetention(text: string, day: Day, settings: DailySettings, locale: string, notes: readonly RetentionNote[], flags: { onThisDay: boolean; weekly: boolean } = { onThisDay: isEnabled(ON_THIS_DAY), weekly: isEnabled(WEEKLY) }): string {
  const w = retentionWords();
  const folder = settings.folder.replace(/^\/+|\/+$/g, "");
  const otd = flags.onThisDay ? renderOnThisDay(onThisDay(notes, day, (d) => dailyPath(d, settings)), w) : null;
  let next = upsertBlock(text, OTD_START, OTD_END, otd);
  const date = new Date(day.y, day.m - 1, day.d);
  const week = flags.weekly && isWeekStart(date, isIsrael(settings, locale)) ? renderWeek(weekData(notes, date, (p) => p.startsWith(".lumen/") || (folder ? p.startsWith(`${folder}/`) : false)), w) : null;
  // Only the week's first day carries the summary: on other days a block left there stays as the user's text.
  if (week || !flags.weekly) next = upsertBlock(next, WEEK_START, WEEK_END, week, OTD_END);
  return next;
}

/** Write the blocks into today's note file (not when it is open with edits: the caller checks). */
export async function refreshRetentionFile(day: Day, settings: DailySettings, locale: string): Promise<void> {
  const [ws, { ensureIndex, indexedNotes }] = await Promise.all([import("../storage/workspace"), import("../storage/workspaceIndex")]);
  await ensureIndex();
  const path = dailyPath(day, settings);
  const text = await ws.readWorkspaceFile(path);
  const next = applyRetention(text, day, settings, locale, await indexedNotes());
  if (next !== text) {
    await ws.writeWorkspaceFile(path, next);
    const { notifyWorkspaceChanged } = await import("../storage/workspaceEvents");
    notifyWorkspaceChanged({ kind: "content", paths: [path] });
  }
}
