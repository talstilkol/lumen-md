/**
 * The frame every visualisation of wave 12 is drawn in (plan W12.V1, gate
 * W12.V7): a `<figure>` with its caption, a switch between the picture and
 * its accessible alternative (a data table, or an ARIA tree), and keyboard
 * navigation over the picture's points.
 *
 * Keyboard: the picture is one tab stop (the APG composite-widget pattern).
 * Inside it, the arrow keys walk the points in reading order — in right to
 * left, ArrowLeft is "next", because the first point is on the right —
 * Home / End jump to the ends, and each step is announced in a polite live
 * region and handed to the host (`onPoint`), which moves the chart's own
 * highlight and tooltip. When the picture can't be drawn (no canvas, the
 * chart library failed to load) the alternative is shown instead.
 */

import { Component, Suspense, useCallback, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../i18n";
import "./vizStrings";
import "./viz.css";
import type { Dir } from "./bidi";

export interface VizPointLabel {
  series?: string;
  label: string;
  value: string;
}

interface Props {
  title: string;
  /** One line under the title: the kind and the number of points. */
  summary: string;
  dir: Dir;
  kind: string;
  /** The picture (lazy: ECharts, Leaflet, SVG). */
  picture: ReactNode;
  /** The accessible alternative, always in the DOM (hidden while the picture shows). */
  alternative: (id: string, hidden: boolean) => ReactNode;
  points: readonly VizPointLabel[];
  onPoint?: (index: number | null) => void;
  /** Enter on a point (R12.8: a Sankey band opens its claim). */
  onActivate?: (index: number) => void;
  notes?: readonly string[];
  initial?: "picture" | "alternative";
  /** The switch's labels (default: chart / table). */
  showPictureLabel?: string;
  showAlternativeLabel?: string;
}

/** The step an arrow key makes, or null; in RTL the visual direction is mirrored. */
export function stepFor(key: string, dir: Dir): number | "home" | "end" | null {
  if (key === "Home") return "home";
  if (key === "End") return "end";
  const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  if (key === next || key === "ArrowDown") return 1;
  if (key === prev || key === "ArrowUp") return -1;
  return null;
}

export function pointText(p: VizPointLabel): string {
  return p.series ? t("viz.pointSeries", { series: p.series, label: p.label, value: p.value }) : t("viz.point", { label: p.label, value: p.value });
}

class PictureBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function VizFrame(props: Props) {
  const { title, summary, dir, kind, picture, alternative, points, onPoint, notes = [] } = props;
  const uid = useId();
  const capId = `${uid}-cap`;
  const altId = `${uid}-alt`;
  const statusId = `${uid}-status`;
  const [showAlt, setShowAlt] = useState(props.initial === "alternative");
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const alt = showAlt || failed;

  const move = useCallback(
    (to: number | null) => {
      setActive(to);
      onPoint?.(to);
    },
    [onPoint],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (e.key === "Enter" && active !== null && props.onActivate) {
      e.preventDefault();
      props.onActivate(active);
      return;
    }
    const step = stepFor(e.key, dir);
    if (step === null) {
      if (e.key === "Escape" && active !== null) move(null);
      return;
    }
    e.preventDefault();
    const last = points.length - 1;
    const next = step === "home" ? 0 : step === "end" ? last : active === null ? (step > 0 ? 0 : last) : Math.max(0, Math.min(last, active + step));
    move(next);
  };

  return (
    <figure className="lumen-viz" dir={dir} data-viz-kind={kind} aria-labelledby={capId}>
      <figcaption id={capId} className="lumen-viz-caption">
        <span className="lumen-viz-title" dir="auto">
          {title}
        </span>
        <span className="lumen-viz-summary">{summary}</span>
      </figcaption>
      {notes.map((n) => (
        <p key={n} className="lumen-viz-note">
          {n}
        </p>
      ))}
      {failed && <p className="lumen-viz-note">{t("viz.chartFailed")}</p>}
      {!failed && (
        <div className="lumen-viz-bar">
          <button type="button" className="lumen-viz-switch" aria-controls={altId} aria-expanded={alt} onClick={() => setShowAlt((s) => !s)} data-viz-switch="">
            {alt ? (props.showPictureLabel ?? t("viz.showChart")) : (props.showAlternativeLabel ?? t("viz.showTable"))}
          </button>
        </div>
      )}
      {!alt && (
        <div
          className="lumen-viz-plot"
          tabIndex={0}
          role="group"
          aria-roledescription={t("viz.chart")}
          aria-label={t("viz.navHint", { title, count: points.length })}
          aria-describedby={statusId}
          onKeyDown={onKeyDown}
          onBlur={() => active !== null && onPoint?.(null)}
          data-viz-plot=""
        >
          <PictureBoundary onError={() => setFailed(true)}>
            <Suspense fallback={null}>{picture}</Suspense>
          </PictureBoundary>
        </div>
      )}
      <p id={statusId} className="sr-only" role="status" aria-live="polite" data-viz-status="">
        {active !== null && points[active] ? pointText(points[active]) : ""}
      </p>
      {alternative(altId, !alt)}
    </figure>
  );
}
