# The recorded RTL test — script (plan W13.H6)

Twelve Hebrew scenarios, five apps, one screen recording per cell. The result is
public evidence for the "Hebrew and RTL" claim: anyone can watch what each app did,
in which version, on which day. Record on a Mac; Notion in its desktop app.

**Apps:** Lumen (this build), Obsidian 1.15 (no plugins, default theme, RTL on in
Settings → Editor), Notion (desktop), Bear 2, Apple Notes. Note the exact version from
each app's About box.

**Recording:** macOS screen recording (⇧⌘5 → Record Selected Portion), the app's
window only, ≤ 30 s, no sound. Keyboard visible on screen: KeyCastr (or Presentify).
File name: `<scenario>-<app>-<version>-<YYYY-MM-DD>.mp4` (H.264, ≤ 2 MB: export with
`ffmpeg -i in.mov -vf scale=1280:-2 -c:v libx264 -crf 28 -an out.mp4`), into
`docs/public/rtl-benchmark/`.

**Ledger:** after each recording, add its cell to `launch/rtl-benchmark.json`:

```json
{ "scenario": "table", "app": "obsidian", "version": "1.15.1", "date": "2026-11-20",
  "video": "rtl-benchmark/table-obsidian-1.15.1-2026-11-20.mp4", "result": "partial",
  "note": "the column order flips when the first cell is English" }
```

`result`: `pass` (what a Hebrew reader expects), `fail` (wrong order, wrong side,
lost text), `partial` (right after a manual fix, or right in one view only). Then
`npm run eval:public -- page --write` puts the table on the public page
(Project → Hebrew in notes, measured) and `npm run docs:audit` checks that all 60
cells are there, each with its version, date and video.

## The twelve scenarios

The same text in every app (copy it from here). "Expected" is what passes.

| # | id | Do | Expected |
|---|---|---|---|
| 1 | `home-end-latin-start` | Type `API של השרת החדש`. Put the caret at the end; press Home; then End. | Home: caret at the right edge, before "API" in reading order. End: after "החדש", at the left edge. One press each. |
| 2 | `numbers-in-hebrew` | Type `הפגישה ב-10:30 בחדר 204, עם 3 משתתפים.` | Numbers keep their digit order (10:30, 204); the sentence reads right to left; the full stop at the left end. |
| 3 | `paste-from-word` | In Word, a Hebrew paragraph with **bold**, a bullet list and a link; copy; paste. | Direction RTL, bold and list kept, the link clickable, no stray marks or empty lines. |
| 4 | `table` | A 3 × 3 table: header `שם / תאריך / Notes`, rows mixing Hebrew, dates and English. | Columns ordered right to left; each cell aligned by its own text; dates readable. |
| 5 | `list` | `1. ראשון` `2. שני` `- תבליט` `  - מקונן`. | Numbers and bullets on the right; the nested item indented toward the left. |
| 6 | `inline-code` | Type ``הריצו `npm run dev` ואז רעננו``. | The code reads left to right in place; the sentence around it stays in order. |
| 7 | `link` | A link labelled `האתר שלנו` to https://example.com. | The label reads right to left; the link opens; no URL text spills into the line. |
| 8 | `formula` | `השטח הוא $\pi r^2$ ס״מ רבועים` (or the app's equation feature). | The formula renders left to right inside the sentence; the Hebrew stays in order. |
| 9 | `search-niqqud` | A note containing `שָׁלוֹם`; search for `שלום`. | Found and highlighted. |
| 10 | `export-pdf` | A note with a heading, paragraph, list and table (scenarios 2–5); export to PDF. | The PDF is RTL with the same order as on screen; Hebrew text selectable. |
| 11 | `footnote` | `טקסט עם הערה[^1]` and `[^1]: ההסבר`. | The marker sits after "הערה"; the note shows at the end (or on hover) in RTL. |
| 12 | `callout` | A callout/quote block titled `שימו לב` with a Hebrew line in it. | Bar/icon on the right; title and body RTL. |

An app without the feature (e.g. no footnotes) is recorded trying it, with result
`fail` and a note — never left out, so the table compares like with like.
