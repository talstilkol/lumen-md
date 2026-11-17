/**
 * Writing goals dialog (W13.W14): set this note's goal (words, minutes,
 * readability, tone — written to its frontmatter as `goal: {…}`, one undo
 * step in the editor) and the weekly report from the log on this device.
 * Nothing is sent; there is no comparison with anyone else.
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { t, getLocale } from "../i18n";
import { Modal } from "./Modal";
import { useAppStore } from "../store/useStore";
import { goalProgress, parseGoal, removeGoal, weeklyReport, type NoteGoal } from "../agents/writing/goals/goals";
import { loadGoalLog } from "./writingGoalLog";
import { setFrontmatterField } from "../ai/batchWrites";
import "./goalsDialogStrings";
// Hebrew readability from W13.W9's index, not the provisional stand-in (INT7).
import "../agents/writing/goals/hebrewIndex";

export function goalValue(g: NoteGoal): string | null {
  const parts = [g.words ? `words: ${g.words}` : "", g.minutes ? `minutes: ${g.minutes}` : "", g.readability ? `readability: ${g.readability}` : "", g.tone ? `tone: ${g.tone}` : ""].filter(Boolean);
  return parts.length ? `{ ${parts.join(", ")} }` : null;
}

export function GoalsDialogImpl({ onClose, now = new Date() }: { onClose: () => void; now?: Date }) {
  const content = useAppStore((s) => s.doc.content);
  const setContent = useAppStore((s) => s.setContent);
  const current = useMemo(() => parseGoal(content) ?? {}, [content]);
  const [g, setG] = useState<NoteGoal>(current);
  const p = useMemo(() => goalProgress(content, g), [content, g]);
  const report = useMemo(() => weeklyReport(loadGoalLog(), now), [now]);
  const n = (x: number) => x.toLocaleString(getLocale());
  const max = Math.max(1, ...report.days.map((d) => d.words));
  const fmtDay = new Intl.DateTimeFormat(getLocale(), { weekday: "short" });

  const save = () => {
    const v = goalValue(g);
    // The user's own edit of the frontmatter (not AI text).
    setContent(v ? setFrontmatterField(removeGoal(content), "goal", v) : removeGoal(content));
    onClose();
  };

  const num = (k: "words" | "minutes", label: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
      {label}
      <input type="number" min={0} step={k === "words" ? 100 : 5} value={g[k] ?? ""} data-testid={`goal-${k}`} onChange={(e) => setG({ ...g, [k]: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined })} style={{ width: 110 }} />
    </label>
  );

  return (
    <Modal
      onClose={onClose}
      aria-labelledby="goals-title"
      data-testid="goals-dialog"
      style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh", zIndex: 9999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 12, width: "min(620px, calc(100vw - 32px))", maxHeight: "84vh", overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="goals-title" style={{ margin: 0, fontSize: 16 }}>
          {t("goal.dialog.title")}
        </h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{t("goal.dialog.local")}</p>
        <fieldset style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: 12, padding: "8px 12px" }}>
          <legend style={{ fontSize: 13, fontWeight: 600 }}>{t("goal.dialog.thisNote")}</legend>
          {num("words", t("goal.field.words"))}
          {num("minutes", t("goal.field.minutes"))}
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
            {t("goal.field.readability")}
            <select value={g.readability ?? ""} data-testid="goal-readability" onChange={(e) => setG({ ...g, readability: (e.target.value || undefined) as NoteGoal["readability"] })}>
              <option value="">{t("goal.none")}</option>
              {(["easy", "medium", "hard"] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`goal.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
            {t("goal.field.tone")}
            <select value={g.tone ?? ""} data-testid="goal-tone" onChange={(e) => setG({ ...g, tone: (e.target.value || undefined) as NoteGoal["tone"] })}>
              <option value="">{t("goal.none")}</option>
              {(["formal", "neutral", "casual"] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`goal.tone.${l}`)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div role="status" style={{ fontSize: 13 }} data-testid="goal-now">
          {[
            t("goal.now.words", { n: n(p.words) }),
            p.readability ? t("goal.now.readability", { level: t(`goal.level.${p.readability.level}`), score: p.readability.score }) + (p.readability.provisional ? ` ${t("goal.provisional")}` : "") : "",
            p.tone ? t("goal.now.tone", { tone: t(`goal.tone.${p.tone.tone}`) }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <section aria-labelledby="goals-week">
          <h3 id="goals-week" style={{ margin: "0 0 6px", fontSize: 14 }}>
            {t("goal.week.title", { from: report.from, to: report.to })}
          </h3>
          <p style={{ margin: "0 0 6px", fontSize: 13 }} data-testid="goal-week-total">
            {t("goal.week.total", { words: n(report.totalWords), minutes: n(report.totalMinutes), streak: report.streak })}
          </p>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("goal.week.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "start" }}>{t("goal.week.day")}</th>
                <th scope="col" style={{ textAlign: "start" }}>{t("goal.week.words")}</th>
                <th scope="col" style={{ textAlign: "end" }}>{t("goal.week.minutes")}</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((d) => (
                <tr key={d.day}>
                  <th scope="row" style={{ textAlign: "start", fontWeight: 400, padding: "2px 6px 2px 0" }}>{fmtDay.format(new Date(`${d.day}T12:00:00`))}</th>
                  <td style={{ width: "70%" }}>
                    <span aria-hidden="true" style={{ display: "inline-block", height: 8, borderRadius: 2, verticalAlign: "middle", background: "hsl(var(--accent))", width: `${Math.round((d.words / max) * 80)}%`, marginInlineEnd: 6 }} />
                    {n(d.words)}
                  </td>
                  <td style={{ textAlign: "end" }}>{n(d.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.notes.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, fontSize: 12 }} data-testid="goal-week-notes">
              {report.notes.slice(0, 8).map((x) => (
                <li key={x.note} dir="auto">
                  <bdi>{x.note}</bdi>: {t("goal.week.note", { words: n(x.words), minutes: n(x.minutes) })}
                  {x.reached ? ` ✓ ${t("goal.week.reached")}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            {t("goal.close")}
          </button>
          <button type="button" onClick={save} data-testid="goal-save">
            {t("goal.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function openGoalsDialog(): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    try {
      root.unmount();
    } catch {
      // why: the dialog root is already unmounted
    }
    host.remove();
  };
  root.render(<GoalsDialogImpl onClose={close} />);
}
