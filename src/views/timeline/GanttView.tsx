/**
 * The Gantt view (plan W13.G5): one row per item, a bar over its range (a
 * diamond for a one-day item), dependencies as arrows from the end of the
 * earlier item to the start of the later one (red when the later one starts
 * first), ticks by week, month, year or decade. Right to left in Hebrew:
 * the right end is the earliest, as in the R12.7 timeline.
 *
 * Accessible: the rows are a list of buttons (↑/↓, Home/End, Enter opens
 * the source), each named with its dates and what it comes after; the
 * arrows are decoration (aria-hidden) because the names carry them; and the
 * same data is one click away as a table (W12.V7).
 */
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getLocale, t } from "../../i18n";
import { ganttLayout, type GanttItem, type GanttLayout } from "./gantt";
import "./timelineStrings";

export interface GanttViewProps {
  items: readonly GanttItem[];
  onOpen?: (item: GanttItem) => void;
  /** Start as the table. */
  initialTable?: boolean;
  /** The reading direction (default: the document's). */
  dir?: "rtl" | "ltr";
}

const ROW = 28;
/** The rows' viewport, in pixels, and the rows drawn beyond it on each side. */
const VIEW = 480;
const OVERSCAN = 8;
const LABEL = "minmax(120px, 28%)";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(precision: GanttItem["precision"]) {
  const locale = getLocale() || "en";
  const key = `${locale}|${precision}`;
  const hit = formatters.get(key);
  if (hit) return hit;
  const f = makeFormatter(locale, precision);
  formatters.set(key, f);
  return f;
}
function makeFormatter(locale: string, precision: GanttItem["precision"]) {
  const opts: Intl.DateTimeFormatOptions = precision === "year" ? { year: "numeric", timeZone: "UTC" } : precision === "month" ? { year: "numeric", month: "short", timeZone: "UTC" } : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(locale, opts);
  } catch {
    // why: an unknown locale tag: English dates rather than none
    return new Intl.DateTimeFormat("en", opts);
  }
}
const fmt = (day: string, precision: GanttItem["precision"]) => formatter(precision).format(new Date(`${day}T00:00:00Z`));
const range = (i: GanttItem) => (i.start === i.end || (i.precision !== "day" && fmt(i.start, i.precision) === fmt(i.end, i.precision)) ? fmt(i.start, i.precision) : `${fmt(i.start, i.precision)} – ${fmt(i.end, i.precision)}`);

export default function GanttView({ items, onOpen, initialTable = false, dir }: GanttViewProps) {
  const rtl = (dir ?? (typeof document !== "undefined" ? (document.documentElement.dir as "rtl" | "ltr") : "ltr")) === "rtl";
  const layout = useMemo(() => ganttLayout(items), [items]);
  const titleId = useId();
  const [table, setTable] = useState(initialTable);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(1, el.getBoundingClientRect().width || 600));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [table]);

  const after = (i: GanttItem) => i.deps.map((d) => byId.get(d)?.label ?? d);
  const name = (i: GanttItem) => [`${i.label}: ${range(i)}`, i.group ? i.group : "", i.deps.length ? t("timeline.gantt.after", { items: after(i).join(", ") }) : "", i.done ? t("timeline.gantt.done") : ""].filter(Boolean).join(". ");
  // Each bar's accessible name, worked out once per data change (500 bars: no Intl calls per render).
  const names = useMemo(() => layout.rows.map((r) => name(r.item)), [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Windowing: only the rows in view (plus a margin) are in the DOM, so 500 or 5,000 items
  // draw at once; each row says where it is in the whole list (aria-posinset / setsize).
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: VIEW });
  const [active, setActive] = useState(0);
  const want = useRef<number | null>(null);
  const n = layout.rows.length;
  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(n, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  const onScroll = () => {
    const el = scroller.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight || VIEW });
  };
  const moveTo = (k: number) => {
    const el = scroller.current;
    setActive(k);
    want.current = k;
    if (el) {
      const top = k * ROW;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW > el.scrollTop + (el.clientHeight || VIEW)) el.scrollTop = top + ROW - (el.clientHeight || VIEW);
      setView({ top: k < first + OVERSCAN || k >= last - OVERSCAN ? Math.max(0, top - (el.clientHeight || VIEW) / 2) : el.scrollTop, height: el.clientHeight || VIEW });
    }
  };
  useEffect(() => {
    if (want.current === null) return;
    const b = buttons.current[want.current];
    if (b) {
      b.focus();
      want.current = null;
    }
  });

  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!n) return;
    const next = e.key === "ArrowDown" ? Math.min(n - 1, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "PageDown" ? Math.min(n - 1, active + 10) : e.key === "PageUp" ? Math.max(0, active - 10) : -1;
    if (next < 0) return;
    e.preventDefault();
    moveTo(next);
  };

  // The bars depend on the data and the window, not on the track's width (they are placed in %): a resize redraws only the arrows.
  const rowsEl = useMemo(
    () => (
      <ol aria-label={t("timeline.gantt.list")} onKeyDown={onKey} style={{ listStyle: "none", margin: 0, padding: 0, position: "relative", blockSize: n * ROW }} data-testid="gantt-rows">
        {layout.rows.slice(first, last).map(({ item, x0, x1 }, j) => {
          const k = first + j;
          return (
            <li key={item.id} data-item={item.id} aria-posinset={k + 1} aria-setsize={n} style={{ position: "absolute", insetBlockStart: k * ROW, insetInlineStart: 0, insetInlineEnd: 0, display: "grid", gridTemplateColumns: `${LABEL} 1fr`, columnGap: 8, blockSize: ROW, alignItems: "center" }}>
              <span dir="auto" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.label}>
                {item.label}
              </span>
              <span style={{ position: "relative", blockSize: ROW }}>
                <button
                  type="button"
                  ref={(b) => void (buttons.current[k] = b)}
                  tabIndex={k === active ? 0 : -1}
                  aria-label={names[k]}
                  title={names[k]}
                  onClick={() => onOpen?.(item)}
                  onFocus={() => setActive(k)}
                  data-milestone={item.milestone || undefined}
                  style={
                    item.milestone
                      ? { position: "absolute", insetInlineStart: `calc(${x0 * 100}% - 6px)`, insetBlockStart: ROW / 2 - 6, inlineSize: 12, blockSize: 12, transform: "rotate(45deg)", padding: 0, border: "1px solid hsl(var(--fg))", background: "hsl(var(--accent, 212 80% 45%))", borderRadius: 2 }
                      : { position: "absolute", insetInlineStart: `${x0 * 100}%`, inlineSize: `max(6px, ${(x1 - x0) * 100}%)`, insetBlockStart: 6, blockSize: ROW - 12, padding: 0, border: 0, borderRadius: 4, background: item.done ? "hsl(var(--fg-muted))" : "hsl(var(--accent, 212 80% 45%))", opacity: item.precision === "day" ? 1 : 0.75 }
                  }
                />
              </span>
            </li>
          );
        })}
      </ol>
    ),
    [layout, names, onOpen, first, last, active], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const toggle = (
    <button type="button" aria-pressed={table} onClick={() => setTable((v) => !v)} data-testid="gantt-table-toggle" style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit" }}>
      {t("timeline.gantt.asTable")}
    </button>
  );

  if (!layout.rows.length && !layout.undated.length) return <p data-testid="gantt-empty">{t("timeline.empty")}</p>;

  return (
    <section aria-labelledby={titleId} data-testid="gantt" dir={rtl ? "rtl" : "ltr"} style={{ display: "grid", gap: 8, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h3 id={titleId} style={{ margin: 0, fontSize: 13 }}>
          {t("timeline.gantt.title", { n: String(layout.rows.length) })}
        </h3>
        {toggle}
        {layout.cycle.length > 0 && <span role="note" data-testid="gantt-cycle">{t("timeline.gantt.cycle", { n: String(layout.cycle.length) })}</span>}
      </div>
      {table ? (
        <table data-testid="gantt-table">
          <caption className="sr-only">{t("timeline.gantt.title", { n: String(layout.rows.length) })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("timeline.gantt.item")}</th>
              <th scope="col">{t("timeline.gantt.group")}</th>
              <th scope="col">{t("timeline.gantt.start")}</th>
              <th scope="col">{t("timeline.gantt.end")}</th>
              <th scope="col">{t("timeline.gantt.afterCol")}</th>
            </tr>
          </thead>
          <tbody>
            {layout.rows.map(({ item }) => (
              <tr key={item.id} data-item={item.id}>
                <th scope="row" dir="auto" style={{ fontWeight: 400, textAlign: "start" }}>
                  {item.label}
                </th>
                <td dir="auto">{item.group}</td>
                <td>
                  <time dateTime={item.start}>{fmt(item.start, item.precision)}</time>
                </td>
                <td>
                  <time dateTime={item.end}>{fmt(item.end, item.precision)}</time>
                </td>
                <td dir="auto">{after(item).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `${LABEL} 1fr`, columnGap: 8 }}>
          <div aria-hidden />
          <div ref={track} aria-hidden style={{ position: "relative", blockSize: 18, borderBlockEnd: "1px solid hsl(var(--border))" }} data-testid="gantt-axis">
            {layout.ticks.map((k) => (
              <span key={k.day} style={{ position: "absolute", insetInlineStart: `${k.at * 100}%`, insetBlockStart: 0, paddingInlineStart: 3, borderInlineStart: "1px solid hsl(var(--border))", color: "hsl(var(--fg-muted))", whiteSpace: "nowrap", fontSize: 11 }}>
                {fmt(k.day, k.unit === "week" ? "day" : k.unit === "month" ? "month" : "year")}
              </span>
            ))}
          </div>
          <div ref={scroller} onScroll={onScroll} style={{ gridColumn: "1 / -1", position: "relative", maxBlockSize: VIEW, overflowY: "auto" }} data-testid="gantt-scroller">
            {rowsEl}
            {layout.arrows.length > 0 && <Arrows layout={layout} width={width} rtl={rtl} first={first} last={last} />}
          </div>
        </div>
      )}
      {layout.undated.length > 0 && (
        <p data-testid="gantt-undated" style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>
          {t("timeline.gantt.undated", { n: String(layout.undated.length) })}
        </p>
      )}
    </section>
  );
}

/**
 * The dependency arrows, in physical pixels of the track (mirrored in RTL).
 * Its own component: a new track width redraws the arrows, not 500 bars.
 */
const Arrows = memo(function Arrows({ layout, width, rtl, first, last }: { layout: GanttLayout; width: number; rtl: boolean; first: number; last: number }) {
  const px = (f: number) => (rtl ? (1 - f) * width : f * width);
  return (
              <svg aria-hidden="true" data-testid="gantt-arrows" width={width} height={layout.rows.length * ROW} style={{ position: "absolute", insetBlockStart: 0, insetInlineEnd: 0, pointerEvents: "none", overflow: "visible" }}>
                <defs>
                  <marker id="gantt-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" fill="hsl(var(--fg-muted))" />
                  </marker>
                </defs>
                {layout.arrows.map((a, k) => {
                  // Only arrows that cross the rows in the window.
                  if (Math.max(a.from, a.to) < first || Math.min(a.from, a.to) >= last) return null;
                  const from = layout.rows[a.from];
                  const to = layout.rows[a.to];
                  const out = rtl ? -6 : 6;
                  const x1 = px(from.item.milestone ? from.x0 : from.x1);
                  const x2 = px(to.x0);
                  const y1 = a.from * ROW + ROW / 2;
                  const y2 = a.to * ROW + ROW / 2;
                  const d = `M${x1},${y1} h${out} V${y2} H${x2 - out / 2}`;
                  return <path key={k} d={d} data-arrow={`${from.item.id}>${to.item.id}`} data-conflict={a.conflict || undefined} fill="none" stroke={a.conflict ? "hsl(0 70% 50%)" : "hsl(var(--fg-muted))"} strokeWidth={1.25} markerEnd="url(#gantt-head)" />;
                })}
              </svg>
            
  );
});
