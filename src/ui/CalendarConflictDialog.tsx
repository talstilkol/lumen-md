/**
 * A task changed on both sides (plan W7.20 step 3, W10.C5): this device's
 * line and the calendar server's task, side by side, and three answers —
 * keep mine, keep theirs, keep both (theirs becomes a new line here, mine a
 * new task there: nothing is lost). Escape or Close leaves the conflict
 * unresolved: it is reported and asked again on the next sync, never
 * settled silently. Focus stays in the dialog; each side's text keeps its
 * own direction (Hebrew or English) inside the RTL layout.
 */
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import "./PromptDialog.css";
import { useFocusTrap } from "./useFocusTrap";
import type { Choice, Conflict } from "../calendar/taskSync";
import type { Todo } from "../calendar/ical";
import "./calendarConflictStrings";

function describe(todo: Omit<Todo, "uid"> | null): string[] {
  if (!todo) return [t("calendar.conflict.deleted")];
  return [todo.summary, todo.due ? t("calendar.conflict.due", { date: todo.due }) : "", todo.completed ? t("calendar.conflict.done") : t("calendar.conflict.open")].filter(Boolean);
}

const side: React.CSSProperties = { flex: "1 1 200px", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 8, minWidth: 0 };

export function CalendarConflictDialog({ conflict, onResolve }: { conflict: Conflict; onResolve: (c: Choice | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, { onEscape: () => onResolve(null) });
  const mine = describe(conflict.local?.todo ?? null);
  const theirs = describe(conflict.remote?.todo ?? null);
  return (
    <div className="prompt-backdrop" role="dialog" aria-modal="true" aria-labelledby="cal-conflict-title" aria-describedby="cal-conflict-why" data-testid="calendar-conflict">
      <div className="prompt-dialog" ref={ref} style={{ maxWidth: 600, width: "min(600px, 94vw)" }}>
        <div id="cal-conflict-title" className="prompt-title">
          {t("calendar.conflict.title")}
        </div>
        <p id="cal-conflict-why" className="prompt-message">
          {t(`calendar.conflict.why.${conflict.why}`)}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <section style={side} aria-label={t("calendar.conflict.here")} data-testid="calendar-conflict-here">
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{t("calendar.conflict.here")}</h3>
            {conflict.local && <div style={{ fontSize: 12, opacity: 0.8 }}>{conflict.local.path}</div>}
            {mine.map((l, i) => (
              <div key={i} dir="auto">
                {l}
              </div>
            ))}
          </section>
          <section style={side} aria-label={t("calendar.conflict.there")} data-testid="calendar-conflict-there">
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{t("calendar.conflict.there")}</h3>
            {theirs.map((l, i) => (
              <div key={i} dir="auto">
                {l}
              </div>
            ))}
          </section>
        </div>
        <div className="prompt-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => onResolve(null)} data-testid="calendar-conflict-later">
            {t("calendar.conflict.later")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => onResolve("both")} data-testid="calendar-conflict-both">
            {t("calendar.conflict.both")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => onResolve("there")} data-testid="calendar-conflict-there-btn">
            {t("calendar.conflict.keepThere")}
          </button>
          <button type="button" className="prompt-btn prompt-btn-ok" onClick={() => onResolve("here")} data-testid="calendar-conflict-here-btn" data-autofocus>
            {t("calendar.conflict.keepHere")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ask about one conflict (the default `decide` of syncTasksNow). */
export function askCalendarConflict(conflict: Conflict): Promise<Choice | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <CalendarConflictDialog
        conflict={conflict}
        onResolve={(c) => {
          try {
            root.unmount();
          } catch {
            /* why: already unmounted */
          }
          host.remove();
          resolve(c);
        }}
      />,
    );
  });
}
