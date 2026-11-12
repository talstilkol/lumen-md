/**
 * The Hebrew date (and, for a deadline, the suggested working day) next to a
 * date in the note's properties (plan W5.15). Lazy: src/ui/Frontmatter.tsx
 * loads it only for values that look like dates.
 */
import { t, tPlural } from "../i18n";
import { useAppStore } from "../store/useStore";
import { DEADLINE_KEY, dateCell, type DateCell } from "./dateCells";

/** The words for a deadline cell: "Falls on Shabbat · Rosh Hashana I: suggested 2026-09-14 (Tzom Gedaliah)", "1 working day left". */
export function deadlineText(d: NonNullable<DateCell["deadline"]>): { moved: string | null; left: string; notes: string | null } {
  const notes = d.notes.length ? d.notes.join(" · ") : null;
  const base = d.moved ? t("israeliTime.moved", { reason: d.off.join(" · "), date: d.due }) : d.off.length ? t("israeliTime.dayOff", { reason: d.off.join(" · ") }) : null;
  // why: a moved deadline's notes are about the day it moves to, so they go with that date
  const moved = base && d.moved && notes ? `${base} (${notes})` : base;
  const left = d.left === 0 ? t("israeliTime.dueToday") : d.left > 0 ? tPlural("israeliTime.left", d.left) : tPlural("israeliTime.overdue", -d.left);
  return { moved, left, notes: d.moved ? null : notes };
}

export default function DateHint({ name, value }: { name: string; value: unknown }) {
  const locale = useAppStore((s) => s.locale) as string;
  const settings = useAppStore((s) => s.dailyNotes);
  const cell = dateCell(value, { locale, settings, deadline: DEADLINE_KEY.test(name) });
  if (!cell) return null;
  const d = cell.deadline && deadlineText(cell.deadline);
  return (
    <>
      {cell.hebrew && (
        <span data-testid="hebrew-date" lang="he" dir={locale === "he" ? "rtl" : "auto"} style={{ marginInlineStart: 6, color: "hsl(var(--fg-muted))" }}>
          ({cell.hebrew})
        </span>
      )}
      {d?.moved && (
        <span data-testid="deadline-moved" role="note" style={{ marginInlineStart: 6, color: "hsl(var(--warning, 35 90% 40%))" }}>
          ⚠ {d.moved}
        </span>
      )}
      {d?.notes && <span style={{ marginInlineStart: 6, color: "hsl(var(--fg-muted))" }}>· {d.notes}</span>}
    </>
  );
}
