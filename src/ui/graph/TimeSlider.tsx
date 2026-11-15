/**
 * The time slider of the graphs (plans W12.E7, W12.V8): one component for
 * the entity graph and the note graph. A range over the days of the graph;
 * the last day shows everything. It is a native range input, so it follows
 * the document's direction — in Hebrew it runs right to left — and the
 * keyboard (←/→, Home/End, PageUp/PageDown) is the browser's own. Play steps
 * through the days. No strings of its own: the host passes its labels.
 */
import { useEffect, useState } from "react";

export interface TimeSliderLabels {
  until: string;
  play: string;
  pause: string;
}

interface Props {
  /** The days, ascending. */
  domain: readonly string[];
  /** Index into `domain`; the last index shows everything. */
  value: number;
  onChange: (index: number) => void;
  labels: TimeSliderLabels;
  testId?: string;
  style?: React.CSSProperties;
}

export function TimeSlider({ domain, value, onChange, labels, testId, style }: Props) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      if (value + 1 < domain.length) onChange(value + 1);
      else setPlaying(false);
    }, 700);
    return () => clearInterval(h);
  }, [playing, value, domain.length, onChange]);
  if (!domain.length) return null;
  return (
    <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {labels.until}
      <input type="range" min={0} max={domain.length - 1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={domain[value]} data-testid={testId} />
      <output>{domain[value]}</output>
      <button
        type="button"
        style={style}
        onClick={() => {
          if (value >= domain.length - 1) onChange(0);
          setPlaying((p) => !p);
        }}
        aria-pressed={playing}
      >
        {playing ? labels.pause : labels.play}
      </button>
    </label>
  );
}

/** The filter's `until` for a slider position: none at the last day (everything shows). */
export const untilOf = (domain: readonly string[], index: number): string | undefined => (domain.length && index < domain.length - 1 ? domain[Math.max(0, index)] : undefined);
