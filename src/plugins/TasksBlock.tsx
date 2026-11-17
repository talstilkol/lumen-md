/**
 * ```tasks``` block (plan 4.13.2): an obsidian-tasks query over every note in
 * the vault, run in the index worker. Re-runs when the vault changes.
 *
 * The same tasks as a Gantt chart (W13.G5, audit r4 A3 #9): 🛫 start to 📅
 * due, ⛔ dependencies as arrows, with the time zoom; a bar opens its note.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { TaskList } from "../tasks/TaskList";
import { parseQuery, type QueryResult } from "../tasks/taskQuery";
import { todayIso, toggleTaskInVault } from "../tasks/toggle";
import type { Task } from "../tasks/taskParser";
import "./tasksBlockStrings";
import { explainError } from "../lib/userError";
import { useVisibleRefresh } from "../lib/visibleRefresh";
import { ganttFromTasks } from "../views/timeline/gantt";

const GanttView = lazy(() => import("../views/timeline/GanttView"));

export default function TasksBlock({ source }: { source: string }) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const today = todayIso();
  const hide = parseQuery(source).hide;
  // W12.V6: off screen (a long dashboard), a vault change waits until the block is seen again.
  const [rootRef, schedule] = useVisibleRefresh();
  const [gantt, setGantt] = useState(false);
  const items = useMemo(() => {
    if (!gantt || !result) return [];
    const seen = new Set<string>();
    const all = result.groups.flatMap((g) => g.tasks).filter((x) => !seen.has(`${x.path}:${x.line}`) && !!seen.add(`${x.path}:${x.line}`));
    return ganttFromTasks(all);
  }, [gantt, result]);

  useEffect(() => {
    let alive = true;
    void import("../storage/workspaceIndex")
      .then((m) => m.queryVaultTasks(source))
      .then((r) => alive && (setResult(r), setError(null)))
      .catch((e) => alive && setError(explainError(e)));
    return () => {
      alive = false;
    };
  }, [source, tick]);

  useEffect(() => {
    const again = () => schedule(() => setTick((n) => n + 1));
    window.addEventListener("lumen-workspace-changed", again);
    return () => window.removeEventListener("lumen-workspace-changed", again);
  }, [schedule]);

  const onToggle = useCallback(async (task: Task) => {
    if (!(await toggleTaskInVault(task))) setError(t("tasks.changed"));
    setTick((n) => n + 1);
  }, []);

  return (
    <div ref={rootRef} className="chart-block lumen-tasks-block" data-testid="tasks-block">
      <div className="chart-block-header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>{result ? t("tasks.count", { n: result.total }) : t("tasks.loading")}</span>
        <button type="button" className="btn" aria-pressed={gantt} onClick={() => setGantt((v) => !v)} disabled={!result} data-testid="tasks-gantt-toggle" style={{ marginInlineStart: "auto", fontSize: 12 }}>
          {t("tasks.view.gantt")}
        </button>
      </div>
      <div style={{ padding: "0.5rem 0.75rem" }}>
        {error ? <p style={{ color: "hsl(0 70% 55%)", fontSize: 13 }}>{error}</p> : null}
        {result?.errors.map((e) => (
          <p key={`${e.code}:${e.text}`} style={{ color: "hsl(0 70% 55%)", fontSize: 13 }} dir="auto">
            ⚠︎ {t(`tasks.error.${e.code}`, { text: e.text })}
          </p>
        ))}
        {gantt && result ? (
          <Suspense fallback={<p>{t("tasks.loading")}</p>}>
            <GanttView items={items} onOpen={(i) => i.source && window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: i.source.note } }))} />
          </Suspense>
        ) : null}
        {!gantt && result?.groups.map((g, i) => (
          <section key={`${i}:${g.label ?? ""}:${g.name}`}>
            {g.label || g.name ? (
              <h4 style={{ margin: "0.5rem 0 0.25rem" }} dir="auto">
                {g.label ? t(`tasks.group.${g.label}`) : g.name}
              </h4>
            ) : null}
            <TaskList tasks={g.tasks} hide={hide} onToggle={onToggle} today={today} />
          </section>
        ))}
      </div>
    </div>
  );
}
