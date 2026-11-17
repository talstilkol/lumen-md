---
title: Sheet block
description: A small spreadsheet inside a note, stored as CSV, with A1 formulas on the app's formula engine.
type: how-to
tasks: ["W12.X1"]
---

A ` ```sheet ` block is a small spreadsheet. Its content is CSV, so the note
stays plain Markdown and Obsidian shows it as a code block. A cell that
starts with `=` is a formula.

````markdown
```sheet
מוצר,מחיר,כמות,סה״כ
תפוחים,4.5,3,=B2*C2
"שוקולד, מריר",12,2,=B3*C3
,,,=SUM(D2:D3)
```
````

- **References:** `B3`, `$B$3` (the `$` is accepted), and ranges such as
  `A1:A5` or `A1:C4`.
- **Functions:** the database formula functions, written in any case:
  `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `IF`, `ROUND`, `ABS`, `LEN`,
  `UPPER`, `&` to join text, and the rest of
  [formulas](/workspace/database-formulas/).
- **Commas:** a comma inside a formula's parentheses belongs to the formula,
  so `=IF(A1>5, "high", "low")` needs no CSV quotes.
- **Right to left:** a Hebrew sheet runs right to left, with column A on the
  right as in Hebrew Excel. The arrow keys move the way they point on
  screen; Home and End go to the row's ends. The bar above the grid shows
  the focused cell's formula.
- **Errors:** a circular reference shows `#CYCLE!` in every cell on the
  cycle, and the bar names the path (`A1 → B1 → A1`). A formula that fails
  shows `#ERROR!`, and a range of more than 10,000 cells shows `#RANGE!`.

To change a cell, edit the CSV in the source view.
