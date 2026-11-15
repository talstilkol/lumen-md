/**
 * The ink layer of one PDF page (plan 4.14, W10.E64): the page's saved strokes
 * always drawn, and, in ink mode, a pen. Pointer, pen or touch draws one
 * stroke per press; pressure comes from the pen when it reports one. The
 * strokes are in page units (ink.ts), drawn here at the page's size in
 * pixels, so they stay in place at any zoom.
 */
import { useRef, useState, type PointerEvent } from "react";
import type { InkSample, PdfInkStroke } from "./ink";

interface Props {
  strokes: readonly PdfInkStroke[];
  /** The page box in CSS pixels (at the current zoom). */
  width: number;
  height: number;
  drawing: boolean;
  color: string;
  /** Pen diameter as a fraction of the page width. */
  size: number;
  label: string;
  onStroke: (stroke: PdfInkStroke) => void;
}

const pathOf = (pts: readonly InkSample[], w: number, h: number) =>
  pts.length ? `M${pts[0][0] * w} ${pts[0][1] * h}` + (pts.length > 1 ? pts.slice(1).map(([x, y]) => ` L${x * w} ${y * h}`).join("") : ` L${pts[0][0] * w} ${pts[0][1] * h}`) : "";

export function InkLayer({ strokes, width, height, drawing, color, size, label, onStroke }: Props) {
  const [live, setLive] = useState<InkSample[] | null>(null);
  const ref = useRef<SVGSVGElement | null>(null);
  const sample = (e: PointerEvent<SVGSVGElement>): InkSample => {
    const r = ref.current!.getBoundingClientRect();
    const p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return [(e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1), p];
  };
  const end = () => {
    if (live && live.length) onStroke({ points: live, size, color });
    setLive(null);
  };
  return (
    <svg
      ref={ref}
      className="pdf-ink-layer"
      data-testid="pdf-ink-layer"
      data-drawing={drawing ? "true" : undefined}
      role={drawing ? "img" : undefined}
      aria-label={drawing ? label : undefined}
      aria-hidden={drawing ? undefined : true}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, pointerEvents: drawing ? "auto" : "none", touchAction: drawing ? "none" : undefined, cursor: drawing ? "crosshair" : undefined, zIndex: 3 }}
      onPointerDown={(e) => {
        if (!drawing) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setLive([sample(e)]);
      }}
      onPointerMove={(e) => {
        if (live) setLive([...live, sample(e)]);
      }}
      onPointerUp={end}
      onPointerCancel={() => setLive(null)}
    >
      {strokes.map((s, i) => (
        <path key={i} d={pathOf(s.points, width, height)} fill="none" stroke={s.color} strokeWidth={s.size * width} strokeLinecap="round" strokeLinejoin="round" data-testid="pdf-ink-stroke" />
      ))}
      {live && <path d={pathOf(live, width, height)} fill="none" stroke={color} strokeWidth={size * width} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />}
    </svg>
  );
}
