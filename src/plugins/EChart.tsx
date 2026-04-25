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

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, isDark ? "dark" : undefined, {
      renderer: "canvas",
    });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [isDark]);

  useEffect(() => {
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
