/**
 * A timeline for an entity or a case (plan R12.7): the claims in time
 * order, laid out right to left in Hebrew (the right end is the earliest),
 * each with its date's uncertainty in words and a link to its source
 * paragraph; the undated claims in their own group, never placed; the gaps
 * the time checker found, as questions; and "what did I know on date X",
 * which shows only what had been recorded by that day.
 *
 * Keyboard: the line is a list of buttons; ←/→ (and ↑/↓) move between
 * them in reading order, Home/End jump to the ends, Enter opens the source.
 *
 * Clean reimplementation (design reference only: israelconnect's
 * uncertainty timeline and time slider, AGPL; no code taken).
 */
import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getLocale, t } from "../../i18n";
import { buildTimeline, checkTimeline, knownOn, spanWords, type TimelineClaim } from "../../entities/temporal";
import "./timelineStrings";
import { EmptyState, learnHow } from "../../ui/EmptyState";
import { ganttFromClaims } from "./gantt";

// W13.G5: ranges and dependencies, on demand.
const GanttView = lazy(() => import("./GanttView"));

export interface TimelineViewProps {
  claims: readonly TimelineClaim[];
  /** Names of subjects, for the rows (`id → name`). */
  names?: ReadonlyMap<string, string>;
  onOpenSource: (note: string, anchor: string | null) => void;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "start" };

export function TimelineView({ claims, names, onOpenSource }: TimelineViewProps) {
  const lang = getLocale() === "he" ? "he" : "en";
  const [asOf, setAsOf] = useState("");
  const [gantt, setGantt] = useState(false);
  const shown = useMemo(() => (asOf ? knownOn(claims, asOf) : [...claims]), [claims, asOf]);
  const line = useMemo(() => buildTimeline(shown), [shown]);
  const gaps = useMemo(() => checkTimeline(shown), [shown]);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const name = (id: string) => names?.get(id) ?? id;
  const byId = new Map<string, TimelineClaim>(shown.map((c: TimelineClaim) => [c.id, c] as const));

  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const n = line.rows.length;
    const at = refs.current.findIndex((b) => b === document.activeElement);
    if (at < 0 || !n) return;
    let next = at;
    // In RTL the next (later) row is to the left.
    const rtl = (e.currentTarget.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir) === "rtl";
    if (e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = Math.min(n - 1, at + 1);
    else if (e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  const row = (c: TimelineClaim) => {
    const when = c.start && c.end && c.end !== c.start ? `${spanWords(c.start, lang)} – ${spanWords(c.end, lang)}` : spanWords((c.start ?? c.end)!, lang);
    return `${when} · ${name(c.subject)} · ${c.value}`;
  };

  return (
    <section aria-labelledby="timeline-title" data-testid="timeline" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <h2 id="timeline-title" style={{ fontSize: 15, margin: 0 }}>
        {t("timeline.title")}
      </h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          {t("timeline.asOf")} <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="timeline-as-of" />
        </label>
        {asOf && (
          <button type="button" style={btn} onClick={() => setAsOf("")}>
            {t("timeline.asOf.clear")}
          </button>
        )}
        <button type="button" style={btn} aria-pressed={gantt} onClick={() => setGantt((v) => !v)} data-testid="timeline-gantt">
          {t("timeline.gantt.show")}
        </button>
      </div>
      {asOf && (
        <p role="status" style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>
          {t("timeline.asOf.note", { day: asOf })}
        </p>
      )}
      {gantt && (line.rows.length > 0 || line.undated.length > 0) ? (
        <Suspense fallback={null}>
          <GanttView items={ganttFromClaims(shown, names)} onOpen={(i) => i.source && onOpenSource(i.source.note, i.source.anchor)} />
        </Suspense>
      ) : line.rows.length === 0 && line.undated.length === 0 ? (
        <EmptyState style={{ padding: 0 }} message={t("timeline.empty")} action={learnHow("workspace/hebrew-calendar")} />
      ) : (
        <ol aria-label={t("timeline.list")} onKeyDown={onKey} data-testid="timeline-rows" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {line.rows.map(({ claim: c }, i) => (
            <li key={c.id} data-claim={c.id}>
              <button type="button" style={btn} ref={(b) => void (refs.current[i] = b)} tabIndex={i === 0 ? 0 : -1} onClick={() => onOpenSource(c.source.note, c.source.anchor ?? null)} aria-label={`${row(c)}. ${t("timeline.open", { note: c.source.note })}`}>
                <span dir="auto">{row(c)}</span>
                <br />
                <q dir="auto" style={{ color: "hsl(var(--fg-muted))" }}>
                  {c.source.quote}
                </q>{" "}
                <small>{t("timeline.recorded", { day: c.observed })}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
      {line.undated.length > 0 && (
        <section aria-labelledby="timeline-undated" data-testid="timeline-undated">
          <h3 id="timeline-undated" style={{ fontSize: 13, margin: "4px 0" }}>
            {t("timeline.undated", { n: String(line.undated.length) })}
          </h3>
          <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>{t("timeline.undated.note")}</p>
          <ul>
            {line.undated.map((c) => (
              <li key={c.id} data-claim={c.id}>
                <button type="button" style={btn} onClick={() => onOpenSource(c.source.note, c.source.anchor ?? null)}>
                  <span dir="auto">
                    {name(c.subject)} · {c.value}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="timeline-gaps" data-testid="timeline-gaps">
        <h3 id="timeline-gaps" style={{ fontSize: 13, margin: "4px 0" }}>
          {t("timeline.gaps", { n: String(gaps.length) })}
        </h3>
        {/* empty-allow: the result of the gap check, not an empty view */}
        <p style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>{gaps.length ? t("timeline.gaps.note") : t("timeline.gaps.none")}</p>
        {gaps.length > 0 && (
          <ul>
            {gaps.map((g, i) => (
              <li key={`${g.kind}:${g.claims.join(",")}:${i}`} data-gap={g.kind}>
                <strong>{t(`timeline.gap.${g.kind}`)}</strong> ({t(`timeline.certainty.${g.certainty}`)}):{" "}
                <span dir="auto">{g.claims.map((id) => (byId.get(id) ? `${name(byId.get(id)!.subject)} · ${byId.get(id)!.value}` : id)).join(" ↔ ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
