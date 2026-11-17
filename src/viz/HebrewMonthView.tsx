/**
 * A month of the Hebrew calendar (plan W12.V5) as an ARIA grid: Sunday to
 * Shabbat, each day with its Hebrew and Gregorian date, its holidays, the
 * Shabbat reading and the items (notes of a Base, daily notes) on it.
 *
 * Keyboard (APG date grid): one tab stop; ← / → a day (mirrored in RTL, so
 * ← is the next day in Hebrew), ↑ / ↓ a week, Home / End the week's ends,
 * PageUp / PageDown the month before / after (Adar I and Adar II are two
 * months), Enter opens the day. Crossing the month's edge moves the month.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import "./vizStrings";
import "./viz.css";
import type { Dir } from "./bidi";
import type { NameLang } from "../daily/hebrewCalendarNames";
import { fixedOfIso, hebrewMonthGrid, hebrewMonthOf, isoOfFixed, stepMonth, type HebrewDayCell } from "./hebrewMonthModel";

export interface DayItem {
  path: string;
  name: string;
}

interface Props {
  year: number;
  month: number;
  israel: boolean;
  lang: NameLang;
  locale: string;
  dir: Dir;
  items?: ReadonlyMap<string, readonly DayItem[]>;
  onDay?: (iso: string) => void;
  onItem?: (item: DayItem) => void;
  /** The day to focus first (default the 1st, or today when it is in the month). */
  focusIso?: string;
  /** Today (ISO): marked with aria-current="date", and the "Today" button goes back to it. */
  today?: string;
}

export type GridMove = { days: number } | { month: number } | { weekEdge: "start" | "end" } | null;

export function gridKey(key: string, dir: Dir): GridMove {
  const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  switch (key) {
    case next:
      return { days: 1 };
    case prev:
      return { days: -1 };
    case "ArrowDown":
      return { days: 7 };
    case "ArrowUp":
      return { days: -7 };
    case "PageDown":
      return { month: 1 };
    case "PageUp":
      return { month: -1 };
    case "Home":
      return { weekEdge: "start" };
    case "End":
      return { weekEdge: "end" };
    default:
      return null;
  }
}

function weekdayNames(locale: string): Array<{ short: string; long: string }> {
  const s = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const l = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 1 + i, 12));
    return { short: s.format(d), long: l.format(d) };
  });
}

export default function HebrewMonthView({ year, month, israel, lang, locale, dir, items, onDay, onItem, focusIso, today }: Props) {
  const [at, setAt] = useState({ year, month });
  useEffect(() => setAt({ year, month }), [year, month]);
  const grid = useMemo(() => hebrewMonthGrid(at.year, at.month, { israel, lang }), [at, israel, lang]);
  const [focus, setFocus] = useState<string>(() => focusIso ?? grid.cells[0].iso);
  const [moved, setMoved] = useState(false);
  const refs = useRef(new Map<string, HTMLTableCellElement>());
  const gdate = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const full = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }), [locale]);
  const wd = useMemo(() => weekdayNames(locale), [locale]);
  const inMonth = grid.cells.some((c) => c.iso === focus);
  const focused = inMonth ? focus : grid.cells[0].iso;

  useEffect(() => {
    if (moved) refs.current.get(focused)?.focus();
  }, [focused, moved, grid]);

  const goto = (iso: string) => {
    setMoved(true);
    setFocus(iso);
    const h = hebrewMonthOf(iso);
    if (h.year !== at.year || h.month !== at.month) setAt({ year: h.year, month: h.month });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDay?.(focused);
      return;
    }
    const mv = gridKey(e.key, dir);
    if (!mv) return;
    e.preventDefault();
    const f = fixedOfIso(focused);
    if ("days" in mv) goto(isoOfFixed(f + mv.days));
    else if ("weekEdge" in mv) {
      const w = new Date(`${focused}T12:00:00Z`).getUTCDay();
      const target = mv.weekEdge === "start" ? f - w : f + (6 - w);
      const first = grid.cells[0].fixed;
      const last = grid.cells[grid.cells.length - 1].fixed;
      goto(isoOfFixed(Math.max(first, Math.min(last, target))));
    } else {
      const h = hebrewMonthOf(focused);
      const to = stepMonth(at.year, at.month, mv.month);
      const g = hebrewMonthGrid(to.year, to.month, { israel, lang });
      goto(g.cells[Math.min(h.day, g.cells.length) - 1].iso);
    }
  };

  const step = (by: number) => {
    const to = stepMonth(at.year, at.month, by);
    setAt(to);
    setMoved(false);
  };

  const captionId = `hm-${at.year}-${at.month}`;
  const label = (c: HebrewDayCell) =>
    [`${c.dayLabel} ${grid.name}`, full.format(new Date(`${c.iso}T12:00:00Z`)), ...c.holidays, ...(c.reading ? [c.reading] : []), ...(items?.get(c.iso)?.length ? [t("viz.hcal.items", { count: items.get(c.iso)!.length })] : [])].join(", ");

  return (
    <div className="lumen-viz-hcal" dir={dir} data-hebrew-month={`${at.year}-${at.month}`}>
      <div className="lumen-viz-hcal-head">
        <button type="button" onClick={() => step(-1)} data-hcal-prev="">
          {t("viz.hcal.prev")}
        </button>
        <span id={captionId} className="lumen-viz-title" dir="auto" aria-live="polite">
          {grid.name} {grid.yearLabel}
        </span>
        <span className="lumen-viz-hcal-nav">
          {today && (
            <button type="button" onClick={() => goto(today)} data-hcal-today="" disabled={focused === today}>
              {t("viz.hcal.today")}
            </button>
          )}
          <button type="button" onClick={() => step(1)} data-hcal-next="">
            {t("viz.hcal.next")}
          </button>
        </span>
      </div>
      <table role="grid" aria-labelledby={captionId} className="lumen-viz-hcal-grid" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {wd.map((w) => (
              <th key={w.long} scope="col" abbr={w.long}>
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((c, di) =>
                c ? (
                  <td
                    key={c.iso}
                    role="gridcell"
                    tabIndex={c.iso === focused ? 0 : -1}
                    aria-selected={c.iso === focused}
                    aria-current={c.iso === today ? "date" : undefined}
                    aria-label={label(c)}
                    data-iso={c.iso}
                    data-shabbat={c.weekday === 6 || undefined}
                    data-holiday={c.holidays.length > 0 || undefined}
                    ref={(el) => {
                      if (el) refs.current.set(c.iso, el);
                      else refs.current.delete(c.iso);
                    }}
                    onClick={() => {
                      setFocus(c.iso);
                      onDay?.(c.iso);
                    }}
                  >
                    <span className="lumen-viz-hcal-day" aria-hidden="true">
                      {c.dayLabel}
                    </span>
                    <span className="lumen-viz-hcal-greg" aria-hidden="true">
                      {gdate.format(new Date(`${c.iso}T12:00:00Z`))}
                    </span>
                    {c.holidays.map((h) => (
                      <span key={h} className="lumen-viz-hcal-holiday" aria-hidden="true" dir="auto">
                        {h}
                      </span>
                    ))}
                    {c.reading && (
                      <span className="lumen-viz-hcal-reading" aria-hidden="true" dir="auto">
                        {c.reading}
                      </span>
                    )}
                    {items?.get(c.iso)?.map((it) => (
                      <span
                        key={it.path}
                        className="lumen-viz-hcal-item"
                        aria-hidden="true"
                        dir="auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          onItem?.(it);
                        }}
                      >
                        {it.name}
                      </span>
                    ))}
                  </td>
                ) : (
                  <td key={`e${di}`} className="lumen-viz-hcal-empty" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
