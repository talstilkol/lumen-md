---
title: Hebrew in notes, measured
description: Lumen on public Hebrew benchmarks — bidi, dictation, niqqud, handwriting — next to Obsidian, Notion and Apple Notes where they were measured too.
type: how-to
---

Every number here is measured on a public benchmark that anyone can download, and each comes with the command that reproduces it. The other apps get a number only where someone ran the same benchmark on them; otherwise their cell says “not tested”. Nothing is estimated.

| Benchmark | Lumen | Obsidian | Notion | Apple Notes |
|---|---|---|---|---|
| Unicode bidi conformance (BidiCharacterTest rows) (higher is better) | not measured yet | not tested | not tested | not tested |
| Dictation WER — ivrit.ai eval-whatsapp (lower is better) | not measured yet | not tested | not tested | not tested |
| Dictation WER — ivrit.ai eval-d1 (lower is better) | not measured yet | not tested | not tested | not tested |
| Dictation WER — FLEURS he_il (lower is better) | not measured yet | not tested | not tested | not tested |
| Niqqud word accuracy — Nakdimon test set (higher is better) | not measured yet | not tested | not tested | not tested |
| Handwriting median CER — ivrit.ai benchmark (lower is better) | not measured yet | not tested | not tested | not tested |

## Recorded: 12 Hebrew scenarios in five apps

Each cell is a screen recording, with the app's version and the day it was made (the script: docs/rtl-benchmark.md). Only what was recorded is shown.

No recordings yet.

The feature comparison: [Lumen, Obsidian, Notion and Google Docs](/project/compare/).

Generated from `eval/results/` and `launch/hebrew-benchmark.json` by `npm run eval:public -- page --write`. The benchmarks' manifests are in `eval/public/`.
