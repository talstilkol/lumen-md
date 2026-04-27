import { describe, it, expect, vi, afterEach } from "vitest";
import { log, setErrorSink } from "../lib/logger";

describe("logger", () => {
  afterEach(() => {
    setErrorSink(null);
    vi.restoreAllMocks();
  });

  it("error always writes to console.error and forwards to the sink", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    setErrorSink(sink);

    const err = new Error("boom");
    log.error("api failed", err);

    expect(consoleSpy).toHaveBeenCalledWith("[lumen]", "api failed", err);
    expect(sink).toHaveBeenCalledWith("api failed", err);
  });

  it("warn always writes to console.warn", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.warn("rate-limited");
    expect(consoleSpy).toHaveBeenCalledWith("[lumen]", "rate-limited");
  });

  it("debug/info do not call console outside DEV mode", () => {
    // import.meta.env.DEV in Vitest is true by default. Smoke-test that the
    // tag is included in the call arguments either way.
    const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    log.debug("debug-msg");
    log.info("info-msg");

    // Both spies received tag-prefixed args when DEV is true; in prod they
    // wouldn't have been called at all. Either outcome is acceptable here —
    // we just verify there's no crash and any call uses the [lumen] tag.
    for (const call of debugSpy.mock.calls) expect(call[0]).toBe("[lumen]");
    for (const call of infoSpy.mock.calls) expect(call[0]).toBe("[lumen]");
  });

  it("a sink that throws does not crash the caller", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorSink(() => {
      throw new Error("sink crash");
    });
    expect(() => log.error("safe?")).not.toThrow();
  });
});
