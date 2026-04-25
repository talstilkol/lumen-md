import { useMemo, useState } from "react";
import { parseJSONTable } from "../data/csv";
import type { DataSet } from "../data/csv";
import { suggestCharts, type ChartSuggestion } from "../data/suggest";
import { DataTable } from "./DataTable";
import { EChart } from "./EChart";
import { Table2, BarChart3, Sparkles } from "lucide-react";

interface Props {
  source: string;
  meta?: string;
}

export default function JsonTableBlock({ source, meta }: Props) {
  const result = useMemo<{ data: DataSet | null; error?: string }>(() => {
    try {
      return { data: parseJSONTable(source) };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  }, [source]);

  const suggestions = useMemo<ChartSuggestion[]>(
    () => (result.data ? suggestCharts(result.data) : []),
    [result.data],
  );

  const [view, setView] = useState<"table" | "chart">("table");
  const [activeIdx, setActiveIdx] = useState(0);

  if (!result.data) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ JSON table parse error: {result.error ?? "unknown"}
        </div>
      </div>
    );
  }

  const data = result.data;
  const active = suggestions[activeIdx];
  const titleMatch = meta?.match(/title=["']([^"']+)["']/);

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={13} style={{ opacity: 0.7 }} />
          {titleMatch?.[1] ??
            `JSON • ${data.rows.length} rows × ${data.columns.length} cols`}
        </span>
        <div className="chart-block-tabs">
          <button
            className={`chart-block-tab ${view === "table" ? "active" : ""}`}
            onClick={() => setView("table")}
          >
            <Table2 size={12} style={{ display: "inline", marginRight: 4 }} />
            Table
          </button>
          {suggestions.length > 0 && (
            <button
              className={`chart-block-tab ${view === "chart" ? "active" : ""}`}
              onClick={() => setView("chart")}
            >
              <BarChart3 size={12} style={{ display: "inline", marginRight: 4 }} />
              Chart
            </button>
          )}
        </div>
      </div>
      {view === "table" && <DataTable data={data} />}
      {view === "chart" && active && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "0.5rem 0.85rem",
              borderBottom: "1px solid hsl(var(--border))",
              flexWrap: "wrap",
              background: "hsl(var(--bg-subtle))",
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                className={`chart-block-tab ${i === activeIdx ? "active" : ""}`}
                onClick={() => setActiveIdx(i)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ padding: "0.5rem" }}>
            <EChart option={active.option} height={360} />
          </div>
        </div>
      )}
    </div>
  );
}
