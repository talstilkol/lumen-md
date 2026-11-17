/**
 * The note's writing goal in the status bar (W13.W14): words against the
 * target (the W5.8 count), the readability and tone targets met or not,
 * and a button to the goals dialog (set the goal, the weekly report).
 * Loaded only when the note's frontmatter has a `goal`; logs the day's
 * progress on this device.
 */
import { useEffect, useMemo } from "react";
import { t, getLocale } from "../i18n";
import { useAppStore } from "../store/useStore";
import { goalProgress, parseGoal, recordProgress } from "../agents/writing/goals/goals";
import { loadGoalLog, saveGoalLog } from "./writingGoalLog";
import "./goalsDialogStrings";

export default function NoteGoalStatus({ text }: { text: string }) {
  const goal = useMemo(() => parseGoal(text), [text]);
  const p = useMemo(() => (goal ? goalProgress(text, goal) : null), [text, goal]);
  const doc = useAppStore((s) => s.doc);
  const note = doc.workspaceName ?? doc.name;
  useEffect(() => {
    if (!p) return;
    saveGoalLog(recordProgress(loadGoalLog(), note, p.words, new Date(), p.goal.words));
  }, [p, note]);
  if (!p) return null;
  const n = (x: number) => x.toLocaleString(getLocale());
  const mark = (ok: boolean | null) => (ok == null ? "…" : ok ? "✓" : "✗");
  const parts: string[] = [];
  if (p.goal.words) parts.push(t("goal.status.words", { n: n(p.words), goal: n(p.goal.words) }));
  if (p.goal.readability) parts.push(`${t("goal.status.readability")} ${mark(p.readabilityMet)}`);
  if (p.goal.tone) parts.push(`${t("goal.status.tone")} ${mark(p.toneMet)}`);
  const title = [
    p.goal.words ? t("goal.title.words", { n: n(p.words), goal: n(p.goal.words), pct: Math.round((p.wordsRatio ?? 0) * 100) }) : "",
    p.goal.readability ? t("goal.title.readability", { want: t(`goal.level.${p.goal.readability}`), now: p.readability ? t(`goal.level.${p.readability.level}`) : t("goal.tooShort") }) : "",
    p.goal.tone ? t("goal.title.tone", { want: t(`goal.tone.${p.goal.tone}`), now: p.tone ? t(`goal.tone.${p.tone.tone}`) : t("goal.tooShort") }) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <button
      type="button"
      className="sb-item"
      data-testid="status-note-goal"
      title={title}
      aria-label={`${t("goal.status.label")}: ${title.replace(/\n/g, "; ")}`}
      onClick={() => void import("./GoalsDialog").then((m) => m.openGoalsDialog())}
      style={{ gap: 6, background: "transparent", border: 0, color: "inherit", font: "inherit", cursor: "pointer" }}
    >
      {p.wordsRatio != null && (
        <span aria-hidden="true" style={{ display: "inline-block", width: 40, height: 4, borderRadius: 2, background: "hsl(var(--border))", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${Math.round(p.wordsRatio * 100)}%`, background: p.wordsRatio >= 1 ? "hsl(var(--ok, 140 60% 40%))" : "hsl(var(--accent))" }} />
        </span>
      )}
      <span>{parts.join(" · ")}</span>
    </button>
  );
}
