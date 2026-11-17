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
import type { Choice, Conflict } from "../calendar/taskSync";
import type { Todo } from "../calendar/ical";
import "./calendarConflictStrings";
import { Modal } from "./Modal";
import { formatDate } from "../i18n/format";

type Line = { key: "summary" | "due" | "state"; text: string };

/** A YYYY-MM-DD due date in the user's calendar and language (local midnight: never a day off). */
function dueText(due: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  return m ? formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : due;
}

function describe(todo: Omit<Todo, "uid"> | null): Line[] {
  if (!todo) return [{ key: "summary", text: t("calendar.conflict.deleted") }];
  return [
    { key: "summary", text: todo.summary },
    ...(todo.due ? [{ key: "due" as const, text: t("calendar.conflict.due", { date: dueText(todo.due) }) }] : []),
    { key: "state", text: todo.completed ? t("calendar.conflict.done") : t("calendar.conflict.open") },
  ];
}

/** What differs between the two sides, field by field (a deleted side differs in everything). */
export function conflictDiffers(a: Omit<Todo, "uid"> | null, b: Omit<Todo, "uid"> | null): Set<Line["key"]> {
  if (!a || !b) return new Set(["summary", "due", "state"]);
  const out = new Set<Line["key"]>();
  if (a.summary !== b.summary) out.add("summary");
  if ((a.due ?? null) !== (b.due ?? null)) out.add("due");
  if (!!a.completed !== !!b.completed) out.add("state");
  return out;
}

const differs: React.CSSProperties = { background: "hsl(var(--accent) / 0.12)", borderInlineStart: "3px solid hsl(var(--accent))", paddingInlineStart: 6, fontWeight: 600 };

function Side({ lines, diff }: { lines: Line[]; diff: Set<Line["key"]> }) {
  return (
    <>
      {lines.map((l) => (
        <div key={l.key} dir="auto" data-differs={diff.has(l.key) ? "" : undefined} style={diff.has(l.key) ? differs : { paddingInlineStart: 9 }}>
          {l.text}
          {/* Not by colour alone: a screen reader hears it, and the bar and weight show it. */}
          {diff.has(l.key) && <span className="sr-only">{` (${t("calendar.conflict.differs")})`}</span>}
        </div>
      ))}
    </>
  );
}

const side: React.CSSProperties = { flex: "1 1 200px", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 8, minWidth: 0 };

export function CalendarConflictDialog({ conflict, onResolve }: { conflict: Conflict; onResolve: (c: Choice | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mine = describe(conflict.local?.todo ?? null);
  const theirs = describe(conflict.remote?.todo ?? null);
  const diff = conflictDiffers(conflict.local?.todo ?? null, conflict.remote?.todo ?? null);
  return (
    <Modal onClose={() => onResolve(null)} className="prompt-backdrop" aria-labelledby="cal-conflict-title" aria-describedby="cal-conflict-why" data-testid="calendar-conflict">
      <div className="prompt-dialog" ref={ref} style={{ maxWidth: 600, width: "min(600px, 94vw)", color: "hsl(var(--fg))" }}>
        <div id="cal-conflict-title" className="prompt-title">
          {t("calendar.conflict.title")}
        </div>
        <p id="cal-conflict-why" className="prompt-message">
          {t(`calendar.conflict.why.${conflict.why}`)}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <section style={side} aria-label={t("calendar.conflict.here")} data-testid="calendar-conflict-here">
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{t("calendar.conflict.here")}</h3>
            {/* A path reads left to right whatever its folder names (Projects/חתונה.md, not md.חתונה/Projects). */}
            {conflict.local && (
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                <bdi dir="ltr" data-testid="calendar-conflict-path">
                  {conflict.local.path}
                </bdi>
              </div>
            )}
            <Side lines={mine} diff={diff} />
          </section>
          <section style={side} aria-label={t("calendar.conflict.there")} data-testid="calendar-conflict-there">
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{t("calendar.conflict.there")}</h3>
            <Side lines={theirs} diff={diff} />
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
    </Modal>
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
