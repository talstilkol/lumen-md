/**
 * The day's timeline (plan W12.H7), under the month calendar while a daily
 * note is open: its time blocks (daily/timeBlocks: `- 09:00–10:30 …`), the
 * events of the calendar subscriptions (read-only), and Shabbat or yom tov
 * as blocked time when a city is chosen (daily/shabbatTimes; the city is
 * picked by hand, never located).
 *
 * A block is moved by dragging it (15-minute steps) or with the keyboard:
 * ↑/↓ move it, Shift+↑/↓ change its length. Moving rewrites the times on
 * that line of the note and nothing else. A block in Shabbat or a chag is
 * marked, with a suggested time and a button to move it there; it is never
 * moved without asking.
 *
 * The axis is vertical (time runs down), so it is the same in RTL and LTR;
 * labels follow the document direction. Its strings travel with
 * CalendarPanel's (ui/calendarPanelStrings), which mounts it.
 */
import { useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import type { GDay } from "../daily/hebrewCalendar";
import { localMidnight, restWindowOn, clock, type City, type ShabbatOptions } from "../daily/shabbatTimes";
import { moveBlock, parseBlocks, restConflicts, snap, type Block } from "../daily/timeBlocks";

export interface TimelineEvent {
  time?: string;
  endTime?: string;
  summary: string;
}

export interface DayTimelineProps {
  note: string;
  day: GDay;
  city: City | null;
  shabbat?: ShabbatOptions;
  events?: readonly TimelineEvent[];
  /** The note with a block moved. */
  onChange: (note: string) => void;
  /** Hours shown (default 6–24). */
  from?: number;
  to?: number;
  /** Pixels per hour (default 32). */
  hourPx?: number;
}

const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutesOf = (s?: string) => (s && /^\d{2}:\d{2}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);

export function DayTimeline({ note, day, city, shabbat, events = [], onChange, from = 6, to = 24, hourPx = 32 }: DayTimelineProps) {
  const blocks = useMemo(() => parseBlocks(note), [note]);
  const rest = useMemo(() => (city ? restWindowOn(day, city, shabbat) : null), [day, city, shabbat]);
  const conflicts = useMemo(() => (city ? restConflicts(blocks, day, city, shabbat) : []), [blocks, day, city, shabbat]);
  const conflictOf = (b: Block) => conflicts.find((c) => c.block.line === b.line);
  const [drag, setDrag] = useState<{ line: number; y0: number; start: number; end: number; delta: number } | null>(null);
  const moved = useRef(false);
  const top = (min: number) => ((min - from * 60) / 60) * hourPx;
  const height = (to - from) * hourPx;
  const midnight = city ? localMidnight(day, city.tz) : 0;
  const restBand = rest && city ? { a: Math.max(from * 60, (rest.start - midnight) / 60_000), b: Math.min(to * 60, (rest.end - midnight) / 60_000) } : null;

  const commit = (b: Block, start: number, end: number) => {
    if (start === b.start && end === b.end) return;
    onChange(moveBlock(note, b.line, start, end));
  };

  return (
    <section aria-label={t("calendar.timeline.title")} data-testid="day-timeline" style={{ marginBlockStart: 8, fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBlockEnd: 4 }}>{t("calendar.timeline.title")}</div>
      {rest && city && (
        <div data-testid="timeline-rest" style={{ color: "hsl(var(--fg-muted))", marginBlockEnd: 4 }}>
          {t("calendar.timeline.rest", { from: clock(rest.start, city.tz), to: clock(rest.end, city.tz), city: city.he })}
        </div>
      )}
      <div style={{ position: "relative", blockSize: height, borderInlineStart: "1px solid hsl(var(--border))" }}>
        {Array.from({ length: to - from }, (_, i) => (
          <div key={i} aria-hidden style={{ position: "absolute", insetBlockStart: i * hourPx, insetInline: 0, borderBlockStart: "1px dashed hsl(var(--border))", fontSize: 9, color: "hsl(var(--fg-muted))", paddingInlineStart: 2 }}>
            {hm((from + i) * 60)}
          </div>
        ))}
        {restBand && restBand.b > restBand.a && (
          <div aria-hidden data-testid="timeline-rest-band" style={{ position: "absolute", insetBlockStart: top(restBand.a), blockSize: top(restBand.b) - top(restBand.a), insetInline: 0, background: "repeating-linear-gradient(45deg, hsl(var(--fg-muted) / 0.08) 0 6px, transparent 6px 12px)" }} />
        )}
        {events.map((e, i) => {
          const s = minutesOf(e.time);
          if (s === null) return null;
          const en = minutesOf(e.endTime) ?? s + 30;
          return (
            <div key={`e${i}`} data-testid="timeline-event" title={e.summary} style={{ position: "absolute", insetBlockStart: top(s), blockSize: Math.max(12, top(en) - top(s)), insetInlineStart: "55%", insetInlineEnd: 2, borderRadius: 4, background: "hsl(var(--fg-muted) / 0.15)", paddingInline: 4, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {e.summary}
            </div>
          );
        })}
        {blocks.map((b) => {
          const d = drag && drag.line === b.line ? drag : null;
          const start = d ? d.start + d.delta : b.start;
          const end = d ? d.end + d.delta : b.end;
          const c = conflictOf(b);
          const label = `${hm(b.start)}–${hm(b.end)} ${b.text}${c ? ` — ${t("calendar.timeline.inRest")}` : ""}`;
          return (
            <div
              key={b.line}
              role="button"
              tabIndex={0}
              data-testid="timeline-block"
              data-line={b.line}
              data-conflict={c ? "rest" : undefined}
              aria-label={label}
              title={label}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                moved.current = false;
                setDrag({ line: b.line, y0: e.clientY, start: b.start, end: b.end, delta: 0 });
              }}
              onPointerMove={(e) => {
                if (!drag || drag.line !== b.line) return;
                const delta = snap(((e.clientY - drag.y0) / hourPx) * 60);
                if (delta !== drag.delta) {
                  moved.current = true;
                  setDrag({ ...drag, delta });
                }
              }}
              onPointerUp={() => {
                if (drag && drag.line === b.line) commit(b, drag.start + drag.delta, drag.end + drag.delta);
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowDown" ? 15 : e.key === "ArrowUp" ? -15 : 0;
                if (!step) return;
                e.preventDefault();
                if (e.shiftKey) commit(b, b.start, Math.max(b.start + 15, b.end + step));
                else commit(b, b.start + step, b.end + step);
              }}
              style={{
                position: "absolute",
                insetBlockStart: top(start),
                blockSize: Math.max(14, top(end) - top(start)),
                insetInlineStart: 34,
                insetInlineEnd: "46%",
                borderRadius: 4,
                paddingInline: 4,
                cursor: "grab",
                touchAction: "none",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                background: c ? "hsl(var(--danger, 0 70% 50%) / 0.18)" : "hsl(var(--accent) / 0.2)",
                border: c ? "1px solid hsl(var(--danger, 0 70% 50%))" : "1px solid hsl(var(--accent) / 0.5)",
              }}
            >
              <span dir="auto">{b.text}</span>
            </div>
          );
        })}
      </div>
      {conflicts.length > 0 && (
        <ul data-testid="timeline-conflicts" style={{ listStyle: "none", margin: 0, marginBlockStart: 4, padding: 0, display: "grid", gap: 2 }}>
          {conflicts.map((c) => (
            <li key={c.block.line} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span dir="auto" style={{ flex: 1 }}>
                {t("calendar.timeline.conflict", { text: c.block.text, when: `${c.suggest.day.d}/${c.suggest.day.m} ${hm(c.suggest.start)}–${hm(c.suggest.end)}` })}
              </span>
              {c.suggest.day.y === day.y && c.suggest.day.m === day.m && c.suggest.day.d === day.d && (
                <button type="button" onClick={() => commit(c.block, c.suggest.start, c.suggest.end)} style={{ border: "none", background: "transparent", color: "hsl(var(--accent))", cursor: "pointer", minBlockSize: 24 }}>
                  {t("calendar.timeline.move")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div style={{ fontSize: 10, color: "hsl(var(--fg-muted))", marginBlockStart: 4 }}>{t("calendar.timeline.hint")}</div>
    </section>
  );
}

export default DayTimeline;
