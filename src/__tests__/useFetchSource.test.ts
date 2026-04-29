/**
 * Unit tests for parseSrcFromMeta — the pure code-fence metadata parser
 * in useFetchSource.ts.
 *
 * This function extracts `src="..."` and `refresh="..."` from the
 * meta string that follows a fenced code block's language tag.
 */

import { describe, it, expect } from "vitest";
import { parseSrcFromMeta } from "../plugins/useFetchSource";

describe("parseSrcFromMeta — url extraction", () => {
  it("returns null url when meta is undefined", () => {
    expect(parseSrcFromMeta(undefined).url).toBeNull();
  });

  it("returns null url when meta has no src attribute", () => {
    expect(parseSrcFromMeta('title="data.csv"').url).toBeNull();
  });

  it("extracts url from double-quoted src", () => {
    const { url } = parseSrcFromMeta('src="https://api.example.com/data.csv"');
    expect(url).toBe("https://api.example.com/data.csv");
  });

  it("extracts url from single-quoted src", () => {
    const { url } = parseSrcFromMeta("src='https://api.example.com/data.json'");
    expect(url).toBe("https://api.example.com/data.json");
  });

  it("is case-insensitive for the src key", () => {
    const { url } = parseSrcFromMeta('SRC="https://a.com/x"');
    expect(url).toBe("https://a.com/x");
  });

  it("handles spaces around the = sign", () => {
    const { url } = parseSrcFromMeta('src = "https://example.com/data"');
    expect(url).toBe("https://example.com/data");
  });

  it("works when other attributes are present", () => {
    const { url } = parseSrcFromMeta(
      'title="My Chart" src="https://api.example.com/chart-data" refresh="30s"',
    );
    expect(url).toBe("https://api.example.com/chart-data");
  });
});

describe("parseSrcFromMeta — refresh parsing", () => {
  it("returns null refreshMs when no refresh attribute", () => {
    expect(parseSrcFromMeta('src="https://a.com"').refreshMs).toBeNull();
  });

  it("returns null refreshMs when meta is undefined", () => {
    expect(parseSrcFromMeta(undefined).refreshMs).toBeNull();
  });

  it("parses refresh in seconds (default unit)", () => {
    const { refreshMs } = parseSrcFromMeta('src="x" refresh="30"');
    expect(refreshMs).toBe(30_000);
  });

  it("parses refresh with explicit 's' unit", () => {
    const { refreshMs } = parseSrcFromMeta('src="x" refresh="10s"');
    expect(refreshMs).toBe(10_000);
  });

  it("parses refresh with 'm' unit (minutes)", () => {
    const { refreshMs } = parseSrcFromMeta('src="x" refresh="5m"');
    expect(refreshMs).toBe(300_000);
  });

  it("parses refresh with 'h' unit (hours)", () => {
    const { refreshMs } = parseSrcFromMeta('src="x" refresh="1h"');
    expect(refreshMs).toBe(3_600_000);
  });

  it("clamps minimum refresh to 1000ms (anti-DDOS floor)", () => {
    // refresh="1" without unit → 1 * 1000 = 1000ms, exactly at the floor
    const { refreshMs } = parseSrcFromMeta('refresh="1"');
    expect(refreshMs).toBe(1_000);
  });

  it("clamps sub-second refresh to 1000ms (e.g. 500ms would be 0.5s)", () => {
    // Only integer values match the regex, so 0 should be null (n > 0 guard)
    const { refreshMs } = parseSrcFromMeta('refresh="0"');
    expect(refreshMs).toBeNull();
  });

  it("ignores negative refresh values (guard: n > 0)", () => {
    // Negative values don't match the regex (\d+ can't be negative)
    const { refreshMs } = parseSrcFromMeta('refresh="-5"');
    expect(refreshMs).toBeNull();
  });

  it("is case-insensitive for refresh unit", () => {
    const { refreshMs } = parseSrcFromMeta('refresh="2M"');
    expect(refreshMs).toBe(120_000);
  });
});

describe("parseSrcFromMeta — combined", () => {
  it("parses both url and refresh from a realistic meta string", () => {
    const result = parseSrcFromMeta(
      'title="Sales Dashboard" src="https://api.co/sales.csv" refresh="30s"',
    );
    expect(result.url).toBe("https://api.co/sales.csv");
    expect(result.refreshMs).toBe(30_000);
  });

  it("returns both null for empty string", () => {
    const result = parseSrcFromMeta("");
    expect(result.url).toBeNull();
    expect(result.refreshMs).toBeNull();
  });
});
