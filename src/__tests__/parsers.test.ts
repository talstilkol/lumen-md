import { describe, it, expect } from "vitest";
import {
  parseSQL,
  parseObjectLiteral,
  parsePandas,
  detectAndParse,
} from "../data/parsers";

describe("parseSQL", () => {
  it("extracts rows from INSERT statements with explicit columns", () => {
    const sql = `
      INSERT INTO sales (date, region, revenue) VALUES
        ('2026-01-01', 'North', 1240.50),
        ('2026-01-02', 'South',  980.00);
    `;
    const ds = parseSQL(sql);
    expect(ds.rows).toHaveLength(2);
    expect(ds.rows[0]).toMatchObject({ region: "North", revenue: 1240.5 });
    expect(ds.rows[1]).toMatchObject({ region: "South", revenue: 980 });
  });

  it("uses CREATE TABLE column order when INSERT omits the column list", () => {
    const sql = `
      CREATE TABLE t (id INTEGER, name TEXT);
      INSERT INTO t VALUES (1, 'Alice'), (2, 'Bob');
    `;
    const ds = parseSQL(sql);
    expect(ds.rows.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  it("coerces NULL / true / numeric literals", () => {
    const sql = `INSERT INTO t (a, b, c) VALUES (NULL, true, 42);`;
    const ds = parseSQL(sql);
    expect(ds.rows[0]).toMatchObject({ a: null, b: true, c: 42 });
  });
});

describe("parseObjectLiteral", () => {
  it("parses standard JSON arrays", () => {
    const ds = parseObjectLiteral('[{"a": 1, "b": 2}]');
    expect(ds.rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("accepts unquoted keys and single quotes", () => {
    const ds = parseObjectLiteral("[{ name: 'Lumen', stars: 42 }]");
    expect(ds.rows[0]).toMatchObject({ name: "Lumen", stars: 42 });
  });

  it("strips trailing commas and comments", () => {
    const src = `[
      // first
      { a: 1, },
      /* second */
      { a: 2, },
    ]`;
    const ds = parseObjectLiteral(src);
    expect(ds.rows.map((r) => r.a)).toEqual([1, 2]);
  });
});

describe("parsePandas", () => {
  it("reads whitespace-aligned columns with a leading numeric index", () => {
    const text = `   date        region   revenue
0  2026-01-01  North     1240.5
1  2026-01-02  South      980.0`;
    const ds = parsePandas(text);
    expect(ds.columns.map((c) => c.name)).toEqual(["date", "region", "revenue"]);
    expect(ds.rows[0]).toMatchObject({ region: "North", revenue: 1240.5 });
  });
});

describe("detectAndParse", () => {
  it("dispatches to the SQL parser for INSERT statements", () => {
    const ds = detectAndParse(`INSERT INTO t (a) VALUES (1), (2);`);
    expect(ds.rows.map((r) => r.a)).toEqual([1, 2]);
  });
  it("dispatches to the JS-object parser for array literals", () => {
    const ds = detectAndParse("[{x:1},{x:2}]");
    expect(ds.rows.map((r) => r.x)).toEqual([1, 2]);
  });
});
