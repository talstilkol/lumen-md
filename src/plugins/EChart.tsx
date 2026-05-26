import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

interface Props {
  option: Record<string, unknown>;
  height?: number | string;
  isDark?: boolean;
}

export function EChart({ option, height = 360, isDark = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const latestOptionRef = useRef<Record<string, unknown>>(option);
  // Defer chart init until the element enters viewport.
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!containerRef.current || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(containerRef.current);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView || !containerRef.current) return;
    const el = containerRef.current;
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
  }, [isDark, inView]);

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
      ref={containerRef}
      style={{
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}
