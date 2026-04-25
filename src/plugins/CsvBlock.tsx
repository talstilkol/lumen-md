import { useMemo, useState } from "react";
import { parseCSV } from "../data/csv";
import type { DataSet } from "../data/csv";
import { suggestCharts, type ChartSuggestion } from "../data/suggest";
import { DataTable } from "./DataTable";
import { EChart } from "./EChart";
import { chat, parseJsonResponse, AiError } from "../ai/llm";
import { PROMPTS } from "../ai/prompts";
import { showAiToast } from "../ui/AiToast";
import { Table2, BarChart3, Sparkles } from "lucide-react";

interface Props {
  source: string;
  lang: "csv" | "tsv";
  meta?: string;
}

type View = "table" | "chart" | "ai-chart";

export default function CsvBlock({ source, lang, meta }: Props) {
  const data = useMemo<DataSet | null>(() => {
    try {
      return parseCSV(source, lang === "tsv" ? "\t" : undefined);
    } catch {
      return null;
    }
  }, [source, lang]);

  const suggestions = useMemo<ChartSuggestion[]>(
    () => (data ? suggestCharts(data) : []),
    [data],
  );

  const [view, setView] = useState<View>(
    suggestions.length > 0 && /\bview=chart\b/i.test(meta ?? "")
      ? "chart"
      : "table",
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOption, setAiOption] = useState<any>(null);

  if (!data) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ Could not parse {lang.toUpperCase()} data.
        </div>
      </div>
    );
  }

  const active = suggestions[activeIdx];
  const titleMatch = meta?.match(/title=["']([^"']+)["']/);

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={13} style={{ opacity: 0.7 }} />
          {titleMatch?.[1] ?? `${lang.toUpperCase()} • ${data.rows.length} rows × ${data.columns.length} cols`}
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
          <button
            className={`chart-block-tab ${view === "ai-chart" ? "active" : ""}`}
            onClick={async () => {
              setView("ai-chart");
              if (aiOption || aiLoading) return;
              setAiLoading(true);
              try {
                const response = await chat([
                  { role: "system", content: PROMPTS.visualization },
                  { role: "user", content: `Raw CSV Data:\n\n${source}` },
                ]);
                setAiOption(parseJsonResponse(response));
              } catch (e) {
                console.error(e);
                showAiToast("AI chart generation failed", "error");
                setAiOption(null);
              } finally {
                setAiLoading(false);
              }
            }}
          >
            <Sparkles size={12} style={{ display: "inline", marginRight: 4 }} />
            AI Chart
          </button>
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
                {iconFor(s.kind)} {s.label}
              </button>
            ))}
          </div>
          <div style={{ padding: "0.5rem" }}>
            <EChart option={active.option} height={360} />
          </div>
        </div>
      )}

      {view === "ai-chart" && (
        <div style={{ padding: "0.5rem" }}>
          {aiLoading ? (
            <div style={{ color: "hsl(var(--fg-muted))", fontSize: 13 }}>
              🤖 Generating AI visualization...
            </div>
          ) : aiOption ? (
            <EChart option={aiOption} height={360} />
          ) : (
            <div style={{ color: "hsl(var(--fg-muted))", fontSize: 13 }}>
              No AI visualization available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function iconFor(kind: string): string {
  switch (kind) {
    case "line":
      return "📈";
    case "bar":
      return "📊";
    case "pie":
      return "🥧";
    case "scatter":
      return "✦";
    case "radar":
      return "◆";
    case "heatmap":
      return "▦";
    default:
      return "•";
  }
}
