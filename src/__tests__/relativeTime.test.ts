/**
 * relativeTime — tests for the time-ago formatting logic.
 * Uses extracted pure logic (avoids importing App.tsx directly).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Extracted from src/App.tsx, using raw strings for testing */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

describe("relativeTime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns 'just now' for recent timestamps", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const ts = Date.now() - 10_000; // 10 seconds ago
    expect(relativeTime(ts)).toBe("just now");
  });

  it("returns minutes for < 60 min", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const ts = Date.now() - 5 * 60_000; // 5 minutes ago
    expect(relativeTime(ts)).toBe("5m ago");
  });

  it("returns hours for < 24 hours", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const ts = Date.now() - 3 * 60 * 60_000; // 3 hours ago
    expect(relativeTime(ts)).toBe("3h ago");
  });

  it("returns days for < 30 days", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const ts = Date.now() - 7 * 24 * 60 * 60_000; // 7 days ago
    expect(relativeTime(ts)).toBe("7d ago");
  });

  it("returns formatted date for > 30 days", () => {
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const ts = new Date("2026-01-01T00:00:00Z").getTime();
    const result = relativeTime(ts);
    // Should be a localized date string, not "Xd ago"
    expect(result).not.toContain("ago");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns 'just now' for 0ms diff", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(relativeTime(Date.now())).toBe("just now");
  });

  it("returns 1m ago for exactly 60 seconds", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const ts = Date.now() - 60_000;
    expect(relativeTime(ts)).toBe("1m ago");
  });
});
