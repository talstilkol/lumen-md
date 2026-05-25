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

let resizeCallbacks: ResizeObserverCallback[] = [];

// Minimal echarts stub so this test runs in JSDOM (the real echarts
// disposes through zrender's canvas painter, which JSDOM can't honour).
// We just need to prove that `init` is called when (and only when) the
// host has nonzero size, and that a canvas element lands in the DOM.
vi.mock("echarts", () => {
  return {
    init: vi.fn((el: HTMLElement) => {
      const canvas = document.createElement("canvas");
      el.appendChild(canvas);
      return {
        setOption: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(() => {
          canvas.remove();
        }),
      };
    }),
  };
});

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
  vi.clearAllMocks();
});

// Lazy import after the mock is set up.
const { EChart } = await import("../plugins/EChart");

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

  it("initializes the chart once the ResizeObserver reports a real size", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { container } = render(<EChart option={minimalOption} height={300} />);
      const chartHost = container.firstChild as HTMLElement;
      // Start at 0×0 → no canvas yet.
      Object.defineProperty(chartHost, "clientWidth", {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(chartHost, "clientHeight", {
        configurable: true,
        get: () => 0,
      });
      expect(container.querySelector("canvas")).toBeNull();

      // Switch to a real size and fire the captured ResizeObserver
      // callbacks. The deferred-init path should now construct echarts
      // and a canvas should appear.
      Object.defineProperty(chartHost, "clientWidth", {
        configurable: true,
        get: () => 400,
      });
      Object.defineProperty(chartHost, "clientHeight", {
        configurable: true,
        get: () => 200,
      });
      for (const cb of resizeCallbacks) {
        // Each captured RO callback gets called with no entries — the
        // EChart effect just uses the callback as a "re-check size"
        // signal, not the entry payload.
        cb([], {} as ResizeObserver);
      }

      // After the resize fires, echarts.init runs and a canvas lands
      // in the DOM. (echarts uses canvas renderer per our config.)
      expect(container.querySelector("canvas")).not.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
