/**
 * Database formulas (plan 4.11): 30 golden formulas, the typed errors, the
 * deterministic limits, a seeded fuzz (only FormulaError, never a hang) and
 * a scan that the formula module never reaches for eval / Function / with /
 * dynamic import.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_FUNCTIONS,
  evaluate,
  evaluateFormula,
  evaluateOrThrow,
  FormulaError,
  functionNames,
  parseFormula,
  parseFormulaOrThrow,
  type FormulaRow,
  type FormulaValue,
  type FunctionTable,
} from "../views/formula";

const NOW = new Date("2026-10-20T09:30:00Z");
const ROW: FormulaRow = {
  fm: {
    title: "Invisible Cities",
    price: 12.5,
    qty: 4,
    status: "done",
    due: "2026-11-01",
    started: new Date("2026-10-01T00:00:00Z"),
    tags: ["fav", "sci-fi"],
    ratings: [4, 5, 3],
    "due date": "2026-12-25",
    מחיר: 10,
    כמות: 3,
    סטטוס: "הושלם",
    blank: null,
    meta: { owner: "tal" },
  },
  file: { name: "Invisible Cities", path: "books/Invisible Cities.md", folder: "books" },
};

const run = (src: string, row: FormulaRow = ROW) => evaluateFormula(src, row, { now: NOW });
const value = (src: string): FormulaValue => {
  const r = run(src);
  if (!r.ok) throw new Error(`${src}: ${r.error.code} ${r.error.message}`);
  return r.value;
};
const errorOf = (src: string, row: FormulaRow = ROW) => {
  const r = run(src, row);
  if (r.ok) throw new Error(`${src} did not fail (got ${JSON.stringify(r.value)})`);
  return r.error;
};
const iso = (v: FormulaValue) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

/** 30 golden formulas: expression → expected value (dates compared as YYYY-MM-DD). */
const GOLDEN: Array<[string, FormulaValue]> = [
  ["price * qty", 50],
  ["1 + 2 * 3", 7],
  ["(1 + 2) * 3", 9],
  ["0.1 + 0.2", 0.3],
  ["2 ^ 3 ^ 2", 512],
  ["-2 ^ 2", -4],
  ["10 % 4", 2],
  ["מחיר * כמות", 30],
  ['if(status = "done", "✓", "…")', "✓"],
  ['if(סטטוס = "הושלם", 1, 0)', 1],
  ["if(blank, \"x\")", null],
  ['concat(title, " (", year(due), ")")', "Invisible Cities (2026)"],
  ['upper("abc") & lower("DEF")', "ABCdef"],
  ['len("שלום")', 4],
  ['contains(tags, "FAV")', true],
  ['contains(title, "cities") and not contains(title, "towns")', true],
  ["round(2.345, 2)", 2.35],
  ["round(1.005, 2)", 1.01],
  ["round(-2.5)", -3],
  ["floor(-1.5) + ceil(1.2) + abs(-3)", 3],
  ["min(4, 2, 8) + max(ratings)", 7],
  ["sum(ratings) / len(ratings)", 4],
  ["avg(price, qty, blank)", 8.25],
  ["datediff(due, today())", 12],
  ['datediff(prop("due date"), started, "months")', 2],
  ['dateadd("2026-01-31", 1, "month")', "2026-02-28"],
  ["dateadd(started, 2, \"weeks\") - started", 14],
  ["due > today() and status != \"todo\"", true],
  ["coalesce(blank, meta.owner, \"nobody\")", "tal"],
  ['file.folder & "/" & replace(file.name, " ", "-")', "books/Invisible-Cities"],
];

describe("formula — golden table", () => {
  it("has 30 cases", () => expect(GOLDEN).toHaveLength(30));
  for (const [src, want] of GOLDEN) {
    it(src, () => expect(iso(value(src))).toEqual(want));
  }
});

describe("formula — semantics", () => {
  it("an empty property empties arithmetic instead of failing", () => {
    expect(value("blank + 1")).toBeNull();
    expect(value("missing * 2")).toBeNull();
    expect(value("sum(blank, 2)")).toBe(2);
  });

  it("numeric text is a number; + joins plain text", () => {
    expect(value('"12" * 2')).toBe(24);
    expect(value('"x" + 1')).toBe("x1");
    expect(value('"a" & 1 & true')).toBe("a1true");
  });

  it("a list equals a value it holds, as in the filter", () => {
    expect(value('tags = "sci-fi"')).toBe(true);
    expect(value('tags != "romance"')).toBe(true);
  });

  it("today() and now() come from the evaluation, in UTC", () => {
    expect(iso(value("today()"))).toBe("2026-10-20");
    expect((value("now()") as Date).toISOString()).toBe(NOW.toISOString());
    expect(value('weekday("2026-10-18")')).toBe(1);
  });

  it("only the branch that is taken runs", () => {
    expect(value("if(true, 1, 1 / 0)")).toBe(1);
    expect(value("false and 1 / 0")).toBe(false);
    expect(value("or(true, unknownfield / 0)")).toBe(true);
  });

  it("keywords are case-insensitive; prop() reads any name", () => {
    expect(value("TRUE AND Not FALSE")).toBe(true);
    expect(iso(value('date(prop("due date"))'))).toBe("2026-12-25");
  });

  it("fields read only the row's own keys", () => {
    for (const k of ["constructor", "__proto__", "toString", "meta.constructor", "tags.length", "title.length"]) expect(value(k)).toBeNull();
  });

  it("parses once, evaluates on many rows", () => {
    const tree = parseFormulaOrThrow("price * qty");
    expect(evaluateOrThrow(tree, { fm: { price: 2, qty: 3 } })).toBe(6);
    expect(evaluate(tree, { fm: { price: "x", qty: 3 } }).ok).toBe(false);
  });
});

describe("formula — errors are typed and placed", () => {
  it("syntax errors carry the character", () => {
    expect(parseFormula("1 +").ok).toBe(false);
    const e = errorOf("price * (qty + 1");
    expect(e).toBeInstanceOf(FormulaError);
    expect(e.code).toBe("syntax");
    expect(e.at).toBe(16);
    expect(errorOf('"open').code).toBe("syntax");
    expect(errorOf("a < b < c").message).toMatch(/chained/);
    expect(errorOf("").code).toBe("syntax");
    expect(errorOf("1 $ 2").at).toBe(2);
  });

  it("unknown functions — including host names — are rejected at parse time", () => {
    for (const src of ["eval(1)", "Function(1)", "constructor(1)", "toString(1)", "hasOwnProperty(1)", "__proto__(1)", "import(1)", "alert(1)"]) {
      const p = parseFormula(src);
      expect(p.ok ? "parsed" : p.error.code, src).toBe("unknown-function");
    }
  });

  it("arity, type and math errors", () => {
    expect(errorOf("round()").code).toBe("arity");
    expect(errorOf("if(1)").code).toBe("arity");
    expect(errorOf('"a" * 2').code).toBe("type");
    expect(errorOf('year("soon")').code).toBe("type");
    expect(errorOf("started + started").code).toBe("type");
    expect(errorOf("10 / 0").code).toBe("math");
    expect(errorOf("sqrt(-1)").code).toBe("math");
    expect(errorOf("10 ^ 400").code).toBe("math");
  });
});

describe("formula — deterministic limits", () => {
  it("source length", () => {
    expect(errorOf("1+".repeat(1500) + "1").code).toBe("limit");
    expect(parseFormula("1 + 1", { limits: { maxLength: 3 } }).ok).toBe(false);
  });

  it("nesting depth, for parentheses, prefixes and long chains", () => {
    expect(errorOf("(".repeat(200) + "1" + ")".repeat(200)).code).toBe("limit");
    expect(errorOf("-".repeat(200) + "1").code).toBe("limit");
    expect(errorOf("1" + "+1".repeat(100)).code).toBe("limit");
    expect(value("(".repeat(30) + "1" + ")".repeat(30))).toBe(1);
  });

  it("steps, text and list sizes", () => {
    expect(errorOf('repeat("x", 100000)').code).toBe("limit");
    expect(errorOf('len(repeat(repeat("abcdefghij", 1000), 1000))').code).toBe("limit");
    const r = evaluateFormula("sum([1,2,3]) + sum([1,2,3])", ROW, { limits: { maxSteps: 10 } });
    expect(r.ok ? "ok" : r.error.code).toBe("limit");
    expect(errorOf('len(split(repeat("a,", 5000), ","))').code).toBe("limit");
  });

  it("the same formula fails at the same step every time (no clock)", () => {
    const src = 'join(split(repeat("ab", 3000), ""), "")';
    const a = run(src);
    const b = run(src);
    expect(a).toEqual(b);
  });
});

describe("formula — seeded fuzz", () => {
  // A small LCG: the same seed, the same expressions, on every machine.
  let seed = 0x4c554d;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const atoms = ["0", "1", "-3.5", "1e308", "1e-308", '"x"', '"2026-02-29"', "''", "true", "null", "price", "tags", "due", "started", "blank", "file.name", "[1, 2]", "[]", 'prop("due date")', "today()", "constructor", "__proto__", "מחיר", "meta.owner"];
  const ops = ["+", "-", "*", "/", "%", "^", "&", "=", "!=", "<", ">=", "and", "or"];
  const fns = functionNames();
  const gen = (d: number): string => {
    if (d <= 0 || rnd() < 0.25) return pick(atoms);
    const r = rnd();
    if (r < 0.4) return `${gen(d - 1)} ${pick(ops)} ${gen(d - 1)}`;
    if (r < 0.5) return `(${gen(d - 1)})`;
    if (r < 0.6) return `${pick(["-", "not ", "!"])}${gen(d - 1)}`;
    return `${pick(fns)}(${Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d - 1)).join(", ")})`;
  };
  const noise = `()[],+-*/%^&=<>!"'.e1 9_xש\\`;

  it("3000 random formulas: a value or a FormulaError, never anything else", () => {
    const codes = new Set<string>();
    let values = 0;
    for (let i = 0; i < 3000; i++) {
      const src = i % 3 === 0 ? Array.from({ length: Math.floor(rnd() * 30) }, () => pick([...noise])).join("") : gen(5);
      try {
        evaluateOrThrow(parseFormulaOrThrow(src), ROW, { now: NOW });
        values++;
      } catch (e) {
        if (!(e instanceof FormulaError)) throw new Error(`${JSON.stringify(src)} threw ${String(e)}`);
        codes.add(e.code);
      }
    }
    // The fuzz reaches both outcomes and several error kinds.
    expect(values).toBeGreaterThan(100);
    expect([...codes]).toEqual(expect.arrayContaining(["syntax", "arity", "type"]));
  });

  it("pathological inputs end in a limit, quickly", () => {
    for (const src of ["(".repeat(5000) + "1" + ")".repeat(5000), "-".repeat(1999) + "1", "[".repeat(1000), "x".repeat(2001), '"' + "a".repeat(2000) + '"']) {
      const r = run(src);
      expect(r.ok, src.slice(0, 10)).toBe(false);
      if (!r.ok) expect(["limit", "syntax"]).toContain(r.error.code);
    }
  });
});

describe("formula — closed function table and the extension point", () => {
  it("the built-in table is frozen", () => {
    expect(Object.isFrozen(BUILTIN_FUNCTIONS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_FUNCTIONS.sum)).toBe(true);
  });

  it("a caller-supplied table adds functions (plan 11.2: plugin formulas)", () => {
    const functions: FunctionTable = { ...BUILTIN_FUNCTIONS, double: { min: 1, max: 1, doc: "double(x)", call: ([x]) => (typeof x === "number" ? x * 2 : null) } };
    expect(evaluateFormula("double(price)", ROW, { functions })).toEqual({ ok: true, value: 25 });
    expect(parseFormula("double(price)").ok).toBe(false);
  });
});

describe("formula — no eval in the code", () => {
  const dir = join(__dirname, "..", "views", "formula");
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  // Comments are stripped first: the docs may name what is forbidden.
  const code = (f: string) =>
    readFileSync(join(dir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["eval(", /\beval\s*\(/],
    ["new Function", /\bnew\s+Function\b/],
    ["Function(", /\bFunction\s*\(/],
    ["with(", /\bwith\s*\(/],
    ["import(", /\bimport\s*\(/],
    ["setTimeout/setInterval with a string", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/],
  ];

  it("scans the formula module", () => expect(files.length).toBeGreaterThanOrEqual(5));
  for (const f of files) {
    it(`${f}: no eval / Function / with / dynamic import`, () => {
      const src = code(f);
      expect(FORBIDDEN.filter(([, re]) => re.test(src)).map(([name]) => name)).toEqual([]);
    });
  }

  it("the scan catches what it looks for", () => {
    const samples = ["eval (src)", "new Function('return 1')", "Function('x')", "with (obj) {}", 'import("./x")', 'setTimeout("x()", 1)'];
    FORBIDDEN.forEach(([name, re], i) => expect(re.test(samples[i]), name).toBe(true));
    expect(FORBIDDEN.some(([, re]) => re.test('const evaluate = (x) => x; // "with" in a comment'.replace(/\/\/.*$/, "")))).toBe(false);
  });
});
