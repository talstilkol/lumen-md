/**
 * Long-running MCP server tasks in the batch jobs panel (plan W13.A2, 5.8):
 * which server, which tool, what it last said, and Cancel (tasks/cancel).
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { serverTasks, type ServerTaskRow } from "../agents/mcp/serverTasks";
import "./serverTasksStrings";

export default function ServerTasksSection({ btn }: { btn: React.CSSProperties }) {
  const [rows, setRows] = useState<ServerTaskRow[]>(() => serverTasks.list());
  useEffect(() => serverTasks.subscribe(() => setRows(serverTasks.list())), []);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="server-tasks-title" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      <h3 id="server-tasks-title" style={{ margin: 0, padding: "10px 16px 4px", fontSize: 12.5, fontWeight: 600, color: "hsl(var(--fg-muted))" }}>
        {t("serverTasks.title")}
      </h3>
      <ul style={{ margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} data-testid="server-task" style={{ padding: "8px 16px", listStyle: "none" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ flex: 1, minWidth: 0 }}>
                <bdi>{r.tool}</bdi> · <bdi>{r.server}</bdi>
              </strong>
              <span style={{ fontSize: 11.5, color: "hsl(var(--fg-muted))" }}>{t(`serverTasks.status.${r.status}`)}</span>
              <button type="button" style={btn} onClick={() => r.cancel()} aria-label={t("serverTasks.cancelLabel", { tool: r.tool, server: r.server })}>
                {t("serverTasks.cancel")}
              </button>
            </div>
            {/* No percentage from the server: an indeterminate bar, with its message read out. */}
            <progress aria-label={r.statusMessage ? r.statusMessage : t(`serverTasks.status.${r.status}`)} style={{ width: "100%", marginTop: 6 }} />
            {r.statusMessage && (
              <div dir="auto" style={{ fontSize: 12, marginTop: 2 }}>
                {r.statusMessage}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
