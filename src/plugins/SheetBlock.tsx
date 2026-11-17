/**
 * The ```sheet block (plan W12.X1): the CSV in the fence shown as a small
 * spreadsheet, with formulas computed (./sheet/sheet.ts).
 *
 * In a right-to-left sheet column A is on the right, as in Hebrew Excel:
 * the grid takes the direction of its text, and the browser lays the
 * columns out from the right. The arrow keys move between cells in the
 * direction they point on screen, Home/End go to the row's first and last
 * cell, and the bar above the grid shows the focused cell's formula.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { firstStrongDirection } from "../lib/textDirection";
import { columnName, displayResult, evaluateSheet, parseSheet, refName } from "./sheet/sheet";
import "./sheetBlockStrings";
import "./SheetBlock.css";

export default function SheetBlock({ source }: { source: string }) {
  const grid = useMemo(() => parseSheet(source), [source]);
  const results = useMemo(() => evaluateSheet(grid), [grid]);
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const dir = firstStrongDirection(grid.flat().filter((c) => !c.trimStart().startsWith("=")).join(" ")) ?? "ltr";
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const table = useRef<HTMLTableElement | null>(null);

  if (!grid.length) return <p className="sheet-empty">{t("sheet.empty")}</p>;

  const focusCell = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(grid.length - 1, r));
    const nc = Math.max(0, Math.min(cols - 1, c));
    setActive({ r: nr, c: nc });
    table.current?.querySelector<HTMLElement>(`[data-cell="${refName(nr, nc)}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    // On screen, "right" is the next column in LTR and the previous one in RTL.
    const ahead = dir === "rtl" ? -1 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowRight: [r, c + ahead],
      ArrowLeft: [r, c - ahead],
      Home: [r, 0],
      End: [r, cols - 1],
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    focusCell(to[0], to[1]);
  };

  const cur = results[active.r]?.[active.c];
  const curSource = grid[active.r]?.[active.c] ?? "";
  const errors = results.flat().filter((x) => x.kind === "error").length;

  return (
    <div className="sheet-block" dir={dir}>
      <div className="sheet-bar" aria-live="polite">
        <span className="sheet-ref">{refName(active.r, active.c)}</span>
        <code dir="ltr" className="sheet-formula">
          {curSource}
        </code>
        {cur?.kind === "error" && <span className="sheet-error-msg">{cur.message}</span>}
      </div>
      <table ref={table} role="grid" className="sheet-grid" aria-label={t("sheet.label", { rows: grid.length, cols })}>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} scope="col">
                {columnName(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              <th scope="row">{r + 1}</th>
              {Array.from({ length: cols }, (_, c) => {
                const res = results[r][c] ?? { kind: "empty" };
                const shown = displayResult(res);
                const isActive = active.r === r && active.c === c;
                const num = res.kind === "value" && typeof res.value === "number";
                return (
                  <td
                    key={c}
                    role="gridcell"
                    data-cell={refName(r, c)}
                    tabIndex={isActive ? 0 : -1}
                    aria-label={`${refName(r, c)} ${shown}`}
                    title={res.kind === "error" ? res.message : (row[c] ?? "").startsWith("=") ? row[c] : undefined}
                    className={`${res.kind === "error" ? "sheet-err" : ""}${num ? " sheet-num" : ""}`}
                    dir={num ? "ltr" : "auto"}
                    onFocus={() => setActive({ r, c })}
                    onClick={() => focusCell(r, c)}
                    onKeyDown={(e) => onKey(e, r, c)}
                  >
                    {shown}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {errors > 0 && <p className="sheet-note">{t("sheet.errors", { n: errors })}</p>}
    </div>
  );
}
