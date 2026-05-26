import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface Props {
  option: Record<string, unknown>;
  height?: number | string;
  isDark?: boolean;
}

export function EChart({ option, height = 360, isDark = true }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const latestOptionRef = useRef<Record<string, unknown>>(option);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    // ECharts.init warns ("Can't get DOM width or height") when the
    // container is 0-sized at mount — common in tabs/modals/lazy lists
    // that haven't laid out yet. Defer init until ResizeObserver sees a
    // real size, then keep observing for layout-driven resizes.
    let disposed = false;

    const ensureChart = () => {
      if (chartRef.current || disposed) return chartRef.current;
      if (el.clientWidth === 0 || el.clientHeight === 0) return null;
      const chart = echarts.init(el, isDark ? "dark" : undefined, {
        renderer: "canvas",
      });
      chartRef.current = chart;
      // Apply the most recent option immediately on init.
      chart.setOption(latestOptionRef.current, { notMerge: true });
      return chart;
    };

    ensureChart();

    const onResize = () => {
      const c = ensureChart();
      if (c) c.resize();
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [isDark]);

  useEffect(() => {
    // The `?.` is deliberate: when the chart isn't yet initialized
    // (container is still 0×0), `setOption` is intentionally a no-op.
    // Writing to `latestOptionRef` ensures the next `ensureChart()`
    // call from ResizeObserver picks up this option on init.
    latestOptionRef.current = option;
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}
