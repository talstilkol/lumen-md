/**
 * Calendar and timeline views of a base (plan W1.12): drag, or Alt + arrow
 * keys, changes only the date property of the note. Out of BasesBlock.tsx to
 * keep it under 800 lines; loaded with it (lazily, never at startup).
 */
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { BaseRow } from "./base";
import { editNote } from "../databaseEdit";
import { addDays, daysBetween, monthWeeks, moveDateInText, rowsByDay, timelineItems, writableKey } from "./viewsData";
import { showAiToast } from "../../ui/AiToast";
import { t } from "../../i18n";
import { explainError } from "../../lib/userError";
import { EmptyState, learnHow } from "../../ui/EmptyState";
import { nameCell, type ViewProps } from "./basesCells";

const muted = "hsl(var(--fg-muted))";

/* ─── Calendar and timeline (W1.12) ──────────────────────────────────── */

/** Move a row's date to `day`: only that property changes in the file. */
async function moveRow(row: BaseRow, dateId: string, day: string, endId?: string) {
  const key = writableKey(dateId);
  if (!key) return showAiToast(t("base.move.readOnly", { property: dateId }), "error");
  const oldStart = row.file.fm[key];
  try {
    await editNote(row.file.path, (text) => {
      let next = moveDateInText(text, key, oldStart, day);
      // A timeline item keeps its length: the end moves by as many days.
      const endKey = endId ? writableKey(endId) : null;
      const from = typeof oldStart === "string" ? oldStart.slice(0, 10) : oldStart instanceof Date ? oldStart.toISOString().slice(0, 10) : null;
      const oldEnd = endKey ? row.file.fm[endKey] : undefined;
      const endDay = typeof oldEnd === "string" ? oldEnd.slice(0, 10) : oldEnd instanceof Date ? oldEnd.toISOString().slice(0, 10) : null;
      if (endKey && from && endDay && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(endDay)) next = moveDateInText(next, endKey, oldEnd, addDays(endDay, daysBetween(from, day)));
      return next;
    });
    showAiToast(t("base.moved", { name: row.file.basename, date: day }));
  } catch (e) {
    showAiToast(t("base.moveFailed", { error: explainError(e) }), "error");
  }
}

/** Alt + arrow keys move an item a day (left / right, as the text runs) or a week (up / down). */
function keyShift(e: ReactKeyboardEvent, rtl: boolean): number {
  if (!e.altKey) return 0;
  if (e.key === "ArrowUp") return -7;
  if (e.key === "ArrowDown") return 7;
  if (e.key === "ArrowLeft") return rtl ? 1 : -1;
  if (e.key === "ArrowRight") return rtl ? -1 : 1;
  return 0;
}

const isRtl = () => typeof document !== "undefined" && document.documentElement.dir === "rtl";

export function CalendarView({ result, files }: ViewProps) {
  const locale = (useAppStore((s) => s.locale) as string) || "en";
  const dateId = result.view.date ?? "note.date";
  const byDay = useMemo(() => rowsByDay(result.rows, dateId), [result, dateId]);
  const first = useMemo(() => [...byDay.keys()].sort()[0] ?? new Date().toISOString().slice(0, 10), [byDay]);
  const [month, setMonth] = useState(() => ({ y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) }));
  const [over, setOver] = useState<string | null>(null);
  const firstDay = ["he", "en", "ja", "ar"].includes(locale) ? (locale === "ar" ? 6 : 7) : 1;
  const weeks = monthWeeks(month.y, month.m, firstDay);
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.y, month.m - 1, 1)));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const undated = result.rows.length - [...byDay.values()].reduce((n, r) => n + r.length, 0);
  const shift = (n: number) =>
    setMonth(({ y, m }) => {
      const k = y * 12 + m - 1 + n;
      return { y: Math.floor(k / 12), m: (k % 12) + 1 };
    });
  const rtl = isRtl();
  return (
    <div data-testid="base-calendar">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBlockEnd: 6 }}>
        <button type="button" onClick={() => shift(-1)} aria-label={t("base.calendar.prev")}>
          {rtl ? "›" : "‹"}
        </button>
        <strong data-testid="base-calendar-title">{title}</strong>
        <button type="button" onClick={() => shift(1)} aria-label={t("base.calendar.next")}>
          {rtl ? "‹" : "›"}
        </button>
        {undated > 0 && <span style={{ fontSize: 11, color: muted }}>{t("base.calendar.undated", { count: undated })}</span>}
        <span id="base-move-hint" style={{ fontSize: 11, color: muted, marginInlineStart: "auto" }}>
          {t("base.move.hint")}
        </span>
      </div>
      <div role="grid" aria-label={title} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, fontSize: 11 }}>
        {weeks[0].map((_, i) => (
          <div key={`h${i}`} role="columnheader" style={{ color: muted, textAlign: "center" }}>
            {weekday.format(new Date(Date.UTC(2024, 0, ((firstDay - 1 + i) % 7) + 1)))}
          </div>
        ))}
        {weeks.flat().map((day, i) =>
          day === null ? (
            <div key={`e${i}`} role="gridcell" aria-hidden />
          ) : (
            <div
              key={day}
              role="gridcell"
              data-day={day}
              aria-label={day}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver((o) => (o === day ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const path = e.dataTransfer.getData("text/x-lumen-path");
                const row = result.rows.find((r) => r.file.path === path);
                if (row) void moveRow(row, dateId, day);
              }}
              style={{ minBlockSize: 64, border: "1px solid hsl(var(--border))", borderRadius: 4, padding: 2, background: over === day ? "hsl(var(--accent) / 0.12)" : undefined }}
            >
              <div style={{ color: muted }}>{Number(day.slice(8))}</div>
              {(byDay.get(day) ?? []).map((r) => (
                <div
                  key={r.file.path}
                  data-path={r.file.path}
                  draggable
                  tabIndex={0}
                  aria-describedby="base-move-hint"
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-lumen-path", r.file.path);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onKeyDown={(e) => {
                    const n = keyShift(e, rtl);
                    if (!n) return;
                    e.preventDefault();
                    void moveRow(r, dateId, addDays(day, n));
                  }}
                  style={{ background: "hsl(var(--bg-subtle))", borderRadius: 3, paddingInline: 3, marginBlockStart: 2, cursor: "grab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {nameCell(r, result.columns[0]?.id ?? "file.name", files)}
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

const DAY_PX = 24;

export function TimelineView({ result, files }: ViewProps) {
  const startId = result.view.date ?? "note.date";
  const endId = result.view.end;
  const { items, from, to } = useMemo(() => timelineItems(result.rows, startId, endId), [result, startId, endId]);
  const [drag, setDrag] = useState<{ path: string; x: number; days: number } | null>(null);
  const rtl = isRtl();
  if (!from || !to) return <EmptyState style={{ padding: 12 }} message={t("base.timeline.empty", { property: startId })} action={learnHow("workspace/obsidian-bases#calendar-and-timeline-views-lumen")} />;
  const span = daysBetween(from, to) + 1;
  const months: Array<{ day: string; label: string }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (d.endsWith("-01") || d === from) months.push({ day: d, label: d.slice(0, 7) });
  return (
    <div data-testid="base-timeline" style={{ overflowX: "auto" }}>
      <div id="base-move-hint-tl" style={{ fontSize: 11, color: muted, marginBlockEnd: 4 }}>
        {t("base.move.hint")}
      </div>
      <div style={{ position: "relative", inlineSize: span * DAY_PX, minInlineSize: "100%", fontSize: 11 }}>
        <div style={{ position: "relative", blockSize: 16, color: muted }}>
          {months.map((m) => (
            <span key={m.day} style={{ position: "absolute", insetInlineStart: daysBetween(from, m.day) * DAY_PX }}>
              {m.label}
            </span>
          ))}
        </div>
        {items.map((it) => {
          const offset = daysBetween(from, it.start) + (drag?.path === it.row.file.path ? drag.days : 0);
          const len = daysBetween(it.start, it.end) + 1;
          return (
            <div key={it.row.file.path} style={{ position: "relative", blockSize: 24 }}>
              <div
                data-path={it.row.file.path}
                role="button"
                tabIndex={0}
                aria-describedby="base-move-hint-tl"
                aria-label={`${it.row.file.basename}: ${it.start}${it.end !== it.start ? ` – ${it.end}` : ""}`}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  setDrag({ path: it.row.file.path, x: e.clientX, days: 0 });
                }}
                onPointerMove={(e) => {
                  if (drag?.path !== it.row.file.path) return;
                  const dx = (e.clientX - drag.x) * (rtl ? -1 : 1);
                  setDrag({ ...drag, days: Math.round(dx / DAY_PX) });
                }}
                onPointerUp={() => {
                  if (drag?.path === it.row.file.path && drag.days) void moveRow(it.row, startId, addDays(it.start, drag.days), endId);
                  setDrag(null);
                }}
                onKeyDown={(e) => {
                  const n = keyShift(e, rtl);
                  if (!n) return;
                  e.preventDefault();
                  void moveRow(it.row, startId, addDays(it.start, n), endId);
                }}
                style={{
                  position: "absolute",
                  insetInlineStart: offset * DAY_PX,
                  inlineSize: Math.max(1, len) * DAY_PX - 2,
                  insetBlock: 2,
                  background: "hsl(var(--accent) / 0.25)",
                  border: "1px solid hsl(var(--accent))",
                  borderRadius: 4,
                  paddingInline: 4,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  cursor: "grab",
                  touchAction: "none",
                }}
              >
                {nameCell(it.row, result.columns[0]?.id ?? "file.name", files)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
