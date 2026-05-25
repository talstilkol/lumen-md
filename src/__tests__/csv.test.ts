/**
 * Tests for the CSV / JSON-table parser. Covers type inference (number /
 * date / boolean / string), coercion edge cases, and the round-trip from
 * raw text to a typed DataSet.
 */

import { describe, it, expect } from "vitest";
import { inferType, coerce, parseCSV, parseJSONTable } from "../data/csv";

describe("inferType", () => {
  it("returns 'number' when every value is a numeric string", () => {
    expect(inferType(["1", "2.5", "-3", "1e5"])).toBe("number");
  });
  it("returns 'date' for ISO timestamps", () => {
    expect(inferType(["2026-04-27", "2025-01-15T13:00:00Z"])).toBe("date");
  });
  it("returns 'boolean' for true/false strings", () => {
    expect(inferType(["true", "false", "true", "false"])).toBe("boolean");
  });
  it("falls back to 'string' on mixed input", () => {
    expect(inferType(["1", "two", "2026-04-27"])).toBe("string");
  });
  it("ignores empty cells when inferring", () => {
    expect(inferType(["", "1", null, "2"])).toBe("number");
  });
});

describe("coerce", () => {
  it("parses numeric strings to numbers", () => {
    expect(coerce("3.14", "number")).toBe(3.14);
  });
  it("returns null for non-numeric input under 'number'", () => {
    expect(coerce("foo", "number")).toBeNull();
  });
  it("parses ISO dates to numeric timestamps", () => {
    const v = coerce("2026-04-27", "date");
    expect(typeof v).toBe("number");
    expect(Number.isFinite(v as number)).toBe(true);
  });
  it("parses 'true' / 'false' to booleans", () => {
    expect(coerce("true", "boolean")).toBe(true);
    expect(coerce("FALSE", "boolean")).toBe(false);
  });
  it("returns null for empty cells regardless of type", () => {
    expect(coerce("", "number")).toBeNull();
    expect(coerce(null, "string")).toBeNull();
  });
});

describe("parseCSV", () => {
  it("returns column metadata + rows from a basic CSV", () => {
    const csv = "name,age\nalice,30\nbob,25";
    const ds = parseCSV(csv);
    expect(ds.columns).toHaveLength(2);
    expect(ds.columns[0].name).toBe("name");
    expect(ds.columns[1].type).toBe("number");
    expect(ds.rows).toHaveLength(2);
    expect(ds.rows[0]).toEqual({ name: "alice", age: 30 });
  });

  it("supports tab-delimited via the delimiter argument", () => {
    const tsv = "name\tage\nalice\t30";
    expect(parseCSV(tsv, "\t").rows[0]).toEqual({ name: "alice", age: 30 });
  });

  it("infers per-column types independently", () => {
    const csv = "n,b,d,s\n1,true,2026-01-01,hi\n2,false,2026-02-02,there";
    const ds = parseCSV(csv);
    const types = ds.columns.map((c) => `${c.name}:${c.type}`);
    expect(types).toEqual(["n:number", "b:boolean", "d:date", "s:string"]);
  });

  it("preserves the original column order from the header row", () => {
    const ds = parseCSV("z,a,m\n1,2,3");
    expect(ds.rawColumns).toEqual(["z", "a", "m"]);
  });

  it("computes min/max for numeric columns", () => {
    const ds = parseCSV("score\n10\n5\n20\n15");
    const col = ds.columns[0];
    expect(col.min).toBe(5);
    expect(col.max).toBe(20);
  });
});

describe("parseJSONTable", () => {
  it("parses an array of homogeneous objects", () => {
    const json = '[{"a":1,"b":"x"},{"a":2,"b":"y"}]';
    const ds = parseJSONTable(json);
    expect(ds.columns).toHaveLength(2);
    expect(ds.rows).toHaveLength(2);
  });

  it("infers types from JSON values directly (no string coercion)", () => {
    const json = '[{"n":1,"b":true},{"n":2,"b":false}]';
    const ds = parseJSONTable(json);
    expect(ds.columns.find((c) => c.name === "n")?.type).toBe("number");
    expect(ds.columns.find((c) => c.name === "b")?.type).toBe("boolean");
  });

  it("throws on non-array JSON", () => {
    expect(() => parseJSONTable('{"a":1}')).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJSONTable("not json")).toThrow();
  });

  it("handles missing keys gracefully (column.filled drops)", () => {
    const ds = parseJSONTable('[{"a":1,"b":2},{"a":3}]');
    const colB = ds.columns.find((c) => c.name === "b");
    expect(colB?.filled).toBe(1);
  });
});
