---
title: Literature review matrix
description: One table of every PDF in the vault, with question, method, sample, findings and limitations, and each value backed by a quote verified on its page. Runs on this device.
type: reference
tasks: ["W12.V4", "R12.20", "W5.12"]
---

`⌘K` → **Literature review from the vault's PDFs** reads every PDF in the
vault on this device. Scanned pages are read with OCR. It writes:

- **one note per paper** in `Literature review/`, with five fields as
  properties: question, method, sample, findings and limitations. Under each
  value are the quotes it came from, each with a link to its page and line;
- **`Literature review.base`**, which shows the notes as a table, one row per
  paper and one column per field (Obsidian Bases format). It has two views:
  **All papers** and **Verified only**, which lists only the papers where
  every field is verified.

## Argument map

Give notes `type: claim` (טענה) or `type: evidence` (מקור, a source), and
link them with `supports:`, `contradicts:` or `qualifies:` (each a list of
`[[links]]` to claims). Mark the end points with `conclusion: true`. An
`argument-map` block draws them:

```argument-map
folder: research/wages     # optional
```

- Sources sit in the first column (on the right in Hebrew), then the claims
  they lead to, then the conclusions. Green lines support, red dashed lines
  contradict, yellow dotted lines qualify.
- A claim that no source reaches through "supports" or "qualifies" is
  marked **no source**.
- "Show as a list" gives the same map as a nested list: each claim with the
  notes that support, contradict or qualify it. On the map, **Tab** to it,
  then the arrow keys go from note to note and **Enter** opens one.
- "Save as a canvas" writes the map to `canvases/` as a JSON Canvas (opens
  in Obsidian) and as an Excalidraw drawing.
- The two types are built in, so they show in the type list, the type's
  Base and the properties form like your own types.

## No value without a quote

For each field, the passages that search finds go to the local model. The
model answers with quotes copied from those passages. Each quote is then
looked up in its passage and located on its page:

- A value is kept only when at least one of its quotes is found.
- Quotes that were made up, or that cite the wrong passage, are dropped. If
  none is left, the field shows "No value with a verified quote" instead of
  a guess.

The model is the local one in AI settings (Ollama or the browser model). A
cloud model is used only if your AI policy allows it.

## Competing hypotheses (ACH)

An `ach` block weighs evidence against competing explanations, the way
Richards Heuer's Analysis of Competing Hypotheses does:

```ach
title: Who leaked the report?
hypotheses:
  H1: Someone inside
  H2: A contractor
evidence:
  - text: The file names an office laptop
    weight: 3
    marks: { H1: CC, H2: I }
  - text: The contractor's own blog post
    deceptive: true
    marks: { H1: N, H2: C }
```

- Each mark is **CC** (very consistent), **C**, **N** (neutral; an empty
  cell is N), **I** (inconsistent) or **II**; `++ + 0 - --` work too. A
  weight is a whole number (default 1).
- Hypotheses are ranked by the **least** weighted inconsistency
  (I = 1, II = 2 per weight): evidence rules hypotheses out more than it
  proves them. Ties go to the most consistency.
- The block also says which rows don't tell the hypotheses apart, which
  single row the verdict rests on (a linchpin), and whether the leader
  holds without the rows marked `deceptive`.
- "Copy as a table" copies the matrix as a Markdown table. It is a research
  instrument, not a verdict.

## How it is measured

`eval/probes/lit-review.json` has five short papers (English and Hebrew).
For each field it records the right page and a phrase from it.

- `src/__tests__/litReview.test.ts` runs retrieval and verification on
  them with a stand-in model. Retrieval finds the right passage for 24 of
  the 25 fields, and every kept citation is on the right page. It also
  checks that a model that makes quotes up has nothing kept.
- `npm run eval:lit-review` runs the real model and reports the share of
  fields that are right.
- The acceptance set is 20 real papers, which the owner provides in the same
  file format. The plan's targets: 85% of fields right, every citation on the
  right page.
