import { useMemo } from "react";
import YAML from "yaml";
import { EChart } from "./EChart";

interface Props {
  source: string;
  meta?: string;
}

function parseSpec(source: string): {
  option: Record<string, unknown> | null;
  error?: string;
} {
  const trimmed = source.trim();
  if (!trimmed) return { option: null, error: "(empty chart spec)" };
  // Try JSON first.
  try {
    const o = JSON.parse(trimmed);
    if (o && typeof o === "object") return { option: o };
  } catch {
    /* fall through to YAML */
  }
  try {
    const o = YAML.parse(trimmed);
    if (o && typeof o === "object")
      return { option: o as Record<string, unknown> };
  } catch (e) {
    return { option: null, error: (e as Error).message };
  }
  return { option: null, error: "Could not parse chart spec." };
}

export default function ChartBlock({ source, meta }: Props) {
  const { option, error } = useMemo(() => parseSpec(source), [source]);
  const heightMatch = meta?.match(/height=(\d+)/);
  const height = heightMatch ? Number(heightMatch[1]) : 360;
  if (!option) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ Chart error: {error ?? "unknown"}
        </div>
      </div>
    );
  }
  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>Chart</span>
      </div>
      <div style={{ padding: "0.5rem" }}>
        <EChart option={option} height={height} />
      </div>
    </div>
  );
}
