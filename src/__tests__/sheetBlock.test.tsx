/**
 * W12.X1: the ```sheet block. 30+ formula cases on the real formula engine
 * (src/views/formula), circular references, the RTL layout (column A on the
 * right) and keyboard navigation. The sheets are small synthetic examples.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { columnIndex, columnName, displayResult, evaluateSheet, parseRef, parseSheet, prepareFormula, serializeSheet } from "../plugins/sheet/sheet";
import SheetBlock from "../plugins/SheetBlock";

afterEach(cleanup);

/** The shown value of `cell` after evaluating the CSV. */
function value(csv: string, cell: string): string {
  const grid = parseSheet(csv);
  const res = evaluateSheet(grid, new Date("2026-11-15T12:00:00Z"));
  const p = parseRef(cell)!;
  return displayResult(res[p.row][p.col]);
}

describe("references", () => {
  it("columns and A1 refs", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(columnIndex("AA")).toBe(26);
    expect(parseRef("$B$12")).toEqual({ row: 11, col: 1 });
    expect(parseRef("B0")).toBeNull();
  });

  it("ranges become lists; text in quotes and function names are left alone", () => {
    expect(prepareFormula("SUM(A1:B2)")).toEqual({ source: "SUM([A1, B1, A2, B2])", refs: ["A1", "B1", "A2", "B2"] });
    expect(prepareFormula('concat(a1, "B2")').source).toBe('concat(A1, "B2")');
    expect(prepareFormula("LOG10(4)").refs).toEqual([]);
  });
});

const cases: Array<[string, string, string, string]> = [
  // [name, csv, cell, expected]
  ["a number", "5", "A1", "5"],
  ["text", "שלום", "A1", "שלום"],
  ["thousands separator", '"1,234"', "A1", "1234"],
  ["percent", "12%", "A1", "0.12"],
  ["addition", "2,3,=A1+B1", "C1", "5"],
  ["precedence", "2,3,=A1+B1*2", "C1", "8"],
  ["parentheses", "2,3,=(A1+B1)*2", "C1", "10"],
  ["power", "2,=A1^10", "B1", "1024"],
  ["division", "7,2,=A1/B1", "C1", "3.5"],
  ["SUM of a column range", "1\n2\n3\n4\n5\n=SUM(A1:A5)", "A6", "15"],
  ["SUM of a 2D range", "1,2\n3,4\n=SUM(A1:B2)", "A3", "10"],
  ["SUM skips empty cells", "1\n\n3\n=SUM(A1:A3)", "A4", "4"],
  ["AVERAGE", "2\n4\n6\n=AVERAGE(A1:A3)", "A4", "4"],
  ["MIN and MAX", "5,1,9,=MIN(A1:C1)&\"-\"&MAX(A1:C1)", "D1", "1-9"],
  ["COUNT", "a,,c,=COUNT(A1:C1)", "D1", "2"],
  ["IF true", "10,=IF(A1>5, \"גבוה\", \"נמוך\")", "B1", "גבוה"],
  ["IF false", "3,=IF(A1>5, \"גבוה\", \"נמוך\")", "B1", "נמוך"],
  ["text join with &", "דנה,כהן,=A1&\" \"&B1", "C1", "דנה כהן"],
  ["chain of formulas", "1,=A1+1,=B1+1,=C1+1", "D1", "4"],
  ["a formula reading a formula below it", "=A2*2\n21", "A1", "42"],
  ["absolute references", "4,=$A$1*$A$1", "B1", "16"],
  ["lower-case references", "4,=a1+1", "B1", "5"],
  ["ROUND", "3.14159,=ROUND(A1, 2)", "B1", "3.14"],
  ["ABS", "-7,=ABS(A1)", "B1", "7"],
  ["LEN of Hebrew text", "שלום,=LEN(A1)", "B1", "4"],
  ["UPPER", "abc,=UPPER(A1)", "B1", "ABC"],
  ["comparison", "3,4,=A1<B1", "C1", "true"],
  ["empty reference is empty", "=A2", "A1", ""],
  ["division by zero is an error", "1,0,=A1/B1", "C1", "#ERROR!"],
  ["unknown function is an error", "=NOPE(1)", "A1", "#ERROR!"],
  ["syntax error", "=1+", "A1", "#ERROR!"],
  ["direct cycle", "=A1", "A1", "#CYCLE!"],
  ["two-cell cycle", "=B1,=A1", "A1", "#CYCLE!"],
  ["three-cell cycle, every cell marked", "=B1,=C1,=A1", "C1", "#CYCLE!"],
  ["a cell that reads a cycle shows it", "=B1,=A1,=A1+1", "C1", "#CYCLE!"],
  ["cycle through a range", "1,=SUM(A1:C1),5", "B1", "#CYCLE!"],
  ["a cell outside the cycle still computes", "=B1,=A1,7,=C1*2", "D1", "14"],
  ["CSV-quoted formula with commas", '3,"=IF(A1>2, ""כן"", ""לא"")"', "B1", "כן"],
  ["unquoted commas inside a formula's parentheses stay in the cell", "1.25,=ROUND(A1, 1),x", "C1", "x"],
];

describe("formulas (30+ cases on the app's formula engine)", () => {
  expect(cases.length).toBeGreaterThanOrEqual(30);
  for (const [name, csv, cell, want] of cases) it(name, () => expect(value(csv, cell)).toBe(want));

  it("the cycle names its path", () => {
    const res = evaluateSheet(parseSheet("=B1,=C1,=A1"));
    expect(res[0][0]).toMatchObject({ kind: "error", code: "#CYCLE!" });
    expect(res[0][0].kind === "error" && res[0][0].message).toContain("A1 → B1 → C1 → A1");
  });

  it("a huge range is refused, not expanded", () => {
    expect(value("=SUM(A1:Z1000)", "A1")).toBe("#RANGE!");
  });
});

describe("storage stays plain CSV in a code block", () => {
  it("round-trips through CSV, formulas and quoting included", () => {
    const grid = [["מוצר", "מחיר", "כמות", "סה״כ"], ["תפוחים", "4.5", "3", "=B2*C2"], ['שוקולד, מריר', "12", "2", "=B3*C3"], ["", "", "", "=SUM(D2:D3)"]];
    const csv = serializeSheet(grid);
    expect(parseSheet(csv)).toEqual(grid);
    expect(csv).toContain('"שוקולד, מריר"');
    const md = "```sheet\n" + csv + "\n```\n";
    // A fenced code block: Obsidian and any CommonMark reader show it as text.
    expect(md.split("\n")[0]).toBe("```sheet");
    expect(md).not.toMatch(/\n```[^\n]*\n[\s\S]*\n```[\s\S]*\n```/);
    expect(value(csv, "D4")).toBe("37.5");
  });
});

describe("the block", () => {
  const csv = "מוצר,מחיר\nתפוח,4\nאגס,6\nסה״כ,=SUM(B2:B3)";

  it("a Hebrew sheet is right to left, so column A is the rightmost", () => {
    const { container } = render(<SheetBlock source={csv} />);
    const block = container.querySelector(".sheet-block") as HTMLElement;
    expect(block.getAttribute("dir")).toBe("rtl");
    const heads = Array.from(container.querySelectorAll<HTMLElement>("thead th")).map((th) => th.textContent);
    expect(heads).toEqual(["", "A", "B"]);
    expect(container.querySelector('[data-cell="B4"]')?.textContent).toBe("10");
  });

  it("an English sheet is left to right", () => {
    const { container } = render(<SheetBlock source={"item,price\napple,4\n,=B2*2"} />);
    expect(container.querySelector(".sheet-block")?.getAttribute("dir")).toBe("ltr");
    expect(container.querySelector('[data-cell="B3"]')?.textContent).toBe("8");
  });

  it("arrow keys move on screen: in RTL, ArrowLeft goes to the next column; the bar shows the formula", () => {
    const { container } = render(<SheetBlock source={csv} />);
    const a4 = container.querySelector('[data-cell="A4"]') as HTMLElement;
    fireEvent.click(a4);
    fireEvent.keyDown(a4, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("B4");
    expect(container.querySelector(".sheet-formula")?.textContent).toBe("=SUM(B2:B3)");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("B3");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("A3");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("B3");
    // Only the focused cell is in the tab order (a roving tabindex).
    expect(container.querySelectorAll('td[tabindex="0"]')).toHaveLength(1);
  });

  it("a cycle is shown in the cell and explained", () => {
    const { container } = render(<SheetBlock source={"=B1,=A1"} />);
    expect(container.querySelector('[data-cell="A1"]')?.textContent).toBe("#CYCLE!");
    expect(container.querySelector(".sheet-note")).toBeTruthy();
  });
});
