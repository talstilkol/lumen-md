import { useMemo, useState } from "react";
import {
  parseSQL,
  parseObjectLiteral,
  parsePandas,
  detectAndParse,
} from "../data/parsers";
import type { DataSet } from "../data/csv";
import { suggestCharts, type ChartSuggestion } from "../data/suggest";
import { DataTable } from "./DataTable";
import { ChartSuggestions } from "./ChartSuggestions";
import { Table2, BarChart3, Database } from "lucide-react";

interface Props {
  source: string;
  meta?: string;
  /** Forwarded by the renderer so a single component can serve every fence. */
  lang?: "sql" | "pandas" | "object" | "data";
}

const LABELS: Record<string, string> = {
  sql: "SQL",
  pandas: "Pandas DataFrame",
  object: "JS object",
  data: "Auto-detected",
};

export default function DataBlock({ source, meta, lang }: Props) {
  const result = useMemo<{ data: DataSet | null; error?: string }>(() => {
    try {
      let data: DataSet;
      switch (lang) {
        case "sql":
          data = parseSQL(source);
          break;
        case "pandas":
          data = parsePandas(source);
          break;
        case "object":
          data = parseObjectLiteral(source);
          break;
        default:
          data = detectAndParse(source);
      }
      return { data };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  }, [source, lang]);

  const suggestions = useMemo<ChartSuggestion[]>(
    () => (result.data ? suggestCharts(result.data) : []),
    [result.data],
  );

  const [view, setView] = useState<"table" | "chart">("table");

  if (!result.data || result.data.rows.length === 0) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ {LABELS[lang ?? "data"]} parse error:{" "}
          {result.error ?? "no rows detected"}
        </div>
      </div>
    );
  }

  const data = result.data;
  const titleMatch = meta?.match(/title=["']([^"']+)["']/);

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Database size={13} style={{ opacity: 0.7 }} />
          {titleMatch?.[1] ??
            `${LABELS[lang ?? "data"]} • ${data.rows.length} rows × ${data.columns.length} cols`}
        </span>
        <div className="chart-block-tabs">
          <button
            type="button"
            className={`chart-block-tab ${view === "table" ? "active" : ""}`}
            onClick={() => setView("table")}
          >
            <Table2 size={12} style={{ display: "inline", marginRight: 4 }} />
            Table
          </button>
          {suggestions.length > 0 && (
            <button
              type="button"
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
      {view === "chart" && suggestions.length > 0 && (
        <ChartSuggestions suggestions={suggestions} />
      )}
    </div>
  );
}
