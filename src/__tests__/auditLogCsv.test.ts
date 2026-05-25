/**
 * Tests for the AuditLog CSV export helpers (ε.2.5).
 *
 * Driving the React component is overkill — the interesting logic is
 * the CSV escaping. Compromised data (commas, quotes, newlines, NULs)
 * must round-trip through Excel / Google Sheets without breaking
 * column alignment. Hand-rolled because we don't ship a CSV
 * dependency for a single export feature.
 */

import { describe, it, expect } from "vitest";
import { rowsToCsv, csvCell } from "../ui/AuditLog";
import type { AuditRow } from "../lib/audit";

describe("csvCell escaping", () => {
  it("returns plain values untouched", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("returns empty string for null / undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes fields containing commas", () => {
    expect(csvCell("a, b")).toBe('"a, b"');
  });

  it("quotes + escapes embedded double-quotes", () => {
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("quotes fields containing newlines", () => {
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
  });

  it("quotes fields with carriage returns (Windows-style)", () => {
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("rowsToCsv", () => {
  const sample: AuditRow[] = [
    {
      user_id: "u1",
      org_id: "org-1",
      action: "doc.publish",
      payload_json: '{"slug":"hello"}',
      ts: Date.parse("2026-04-28T10:30:00Z"),
    },
    {
      user_id: "u2",
      org_id: "org-1",
      action: "billing.subscribe",
      payload_json: undefined,
      ts: Date.parse("2026-04-28T11:00:00Z"),
    },
  ];

  it("emits a header row first", () => {
    const csv = rowsToCsv(sample);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toBe("ts,user_id,org_id,action,payload,ip,user_agent");
  });

  it("emits one row per AuditRow plus a trailing newline", () => {
    const csv = rowsToCsv(sample);
    const lines = csv.split("\n");
    // header + 2 rows + trailing newline → 4 elements, last empty.
    expect(lines).toHaveLength(4);
    expect(lines[lines.length - 1]).toBe("");
  });

  it("formats ts as ISO date-time", () => {
    const csv = rowsToCsv([sample[0]]);
    expect(csv).toMatch(/2026-04-28 10:30:00/);
  });

  it("preserves user_id + action verbatim when ASCII-safe", () => {
    const csv = rowsToCsv(sample);
    expect(csv).toContain("u1,org-1,doc.publish");
    expect(csv).toContain("u2,org-1,billing.subscribe");
  });

  it("quotes JSON payloads that contain commas", () => {
    const row: AuditRow[] = [
      {
        user_id: "u",
        org_id: "o",
        action: "x",
        payload_json: '{"a":1,"b":2}',
        ts: 0,
      },
    ];
    const csv = rowsToCsv(row);
    expect(csv).toContain('"{""a"":1,""b"":2}"');
  });

  it("returns just the header for an empty rowset", () => {
    const csv = rowsToCsv([]);
    expect(csv).toBe("ts,user_id,org_id,action,payload,ip,user_agent\n");
  });
});
