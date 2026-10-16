/**
 * Ranked chart alternatives for tabular blocks (csv / json-table / data).
 * Shows each suggestion as a tab, the active one's "why" line, and renders
 * either the ECharts option or — for `map` suggestions — the Leaflet map
 * block with the detected markers.
 */

import { Suspense, lazy, useMemo, useState } from "react";
import type { ChartSuggestion } from "../data/suggest";
import { EChart } from "./EChart";
import { t } from "../i18n";

const MapBlock = lazy(() => import("./MapBlock"));

export function chartIcon(kind: string): string {
  switch (kind) {
    case "line":
      return "📈";
    case "bar":
      return "📊";
    case "stackedBar":
      return "▥";
    case "histogram":
      return "▁▃▅";
    case "pie":
      return "🥧";
    case "scatter":
      return "✦";
    case "map":
      return "🗺";
    case "radar":
      return "◆";
    case "heatmap":
      return "▦";
    default:
      return "•";
  }
}

export function ChartSuggestions({ suggestions }: { suggestions: ChartSuggestion[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = suggestions[Math.min(activeIdx, suggestions.length - 1)];
  const mapSource = useMemo(
    () => (active?.map ? JSON.stringify({ markers: active.map.markers }) : null),
    [active],
  );
  if (!active) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label={t("chart.alternatives")}
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
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s === active}
            title={s.reason}
            className={`chart-block-tab ${s === active ? "active" : ""}`}
            onClick={() => setActiveIdx(i)}
          >
            <span aria-hidden="true">{chartIcon(s.kind)}</span> {s.label}
          </button>
        ))}
      </div>
      <p
        data-testid="chart-reason"
        style={{ margin: 0, padding: "0.4rem 0.85rem 0", fontSize: 12, color: "hsl(var(--fg-muted))" }}
      >
        {active.reason}
      </p>
      <div style={{ padding: "0.5rem" }}>
        {mapSource ? (
          <Suspense fallback={<div style={{ height: 360 }} />}>
            <MapBlock source={mapSource} lang="map" />
          </Suspense>
        ) : (
          <EChart option={active.option} height={360} />
        )}
      </div>
    </div>
  );
}
