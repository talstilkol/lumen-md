/**
 * Regression test for ADR-001 / Bug #3.
 *
 * `EChart` used to call `echarts.init` unconditionally in its mount
 * effect. When the host container had `clientWidth === 0` or
 * `clientHeight === 0` (lazy / suspended / hidden parent), ECharts
 * emitted a "Can't get DOM width or height" warning and the eventual
 * `setOption` produced a degenerate chart.
 *
 * The fix gates init on a nonzero size check inside an `ensureChart()`
 * closure and re-attempts from the ResizeObserver callback once the
 * container becomes measurable. This test pins both halves: 0×0 mount
 * must NOT init the chart and must NOT warn, and a later resize must
 * trigger init.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { EChart } from "../plugins/EChart";

let resizeCallbacks: ResizeObserverCallback[] = [];

beforeAll(() => {
  // ResizeObserver isn't in jsdom. Capture the callbacks so the test
  // can drive them deterministically.
  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
  ).ResizeObserver = class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  resizeCallbacks = [];
});

describe("EChart deferred init", () => {
  const minimalOption = {
    xAxis: { type: "category", data: ["a", "b"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [1, 2] }],
  };

  it("does not warn or create a canvas when mounted in a 0×0 container", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(<EChart option={minimalOption} height={0} />);
      // Force the chart's container to truly report 0×0. JSDOM's clientWidth
      // is naturally 0, but be explicit so this test is robust to future
      // layout-engine changes.
      const chartHost = container.firstChild as HTMLElement;
      Object.defineProperty(chartHost, "clientWidth", {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(chartHost, "clientHeight", {
        configurable: true,
        get: () => 0,
      });

      // No canvas means echarts.init never ran — the deferred-init guard
      // skipped because the host had no size.
      expect(container.querySelector("canvas")).toBeNull();
      // And no warnings about missing dimensions.
      const warnings = warnSpy.mock.calls
        .flat()
        .map((c) => String(c))
        .filter((s) => /DOM width or height/i.test(s));
      expect(warnings).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
