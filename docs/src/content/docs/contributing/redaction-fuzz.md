---
title: Nightly redaction fuzz
description: Every night the second host feeds 20,000 generated notes to the preview and the export, and any passage the preview shades but the export keeps becomes a permanent test.
type: how-to
---

Journalist mode promises that a `<redact>` passage the preview shades is gone
from every export. Reviews 6 and 8 found real leaks that the ordinary tests
missed, each time with a fuzz generator. Those generators now live in the
repository and run every night.

## What runs

`npm run fuzz:redaction` runs `tests/fuzz/redaction/redaction.fuzz.ts` with
20,000 cases, split across four generators:

| Generator | Origin | What it builds |
| --- | --- | --- |
| `tags` | review F-8 | `<redact>` tag variants inside comments, attributes, raw-text elements and CDATA |
| `blocks` | review 6 | notes of Markdown blocks: quotes and lists two deep, fences, indented code, math, tables, HTML blocks |
| `footnotes` | review 8 | `blocks` with footnotes and CriticMarkup suggestions between the blocks |
| `containers` | reviews 8 and R6 | a recursive CommonMark grammar: containers four deep, lazy lines, tabs, all seven HTML block kinds, setext headings, reference definitions, directives, tables, CRLF |

For each note, the oracle renders it the way the preview does
(`prepareCriticMarkup`, micromark with the preview's extensions, the browser's
HTML parser, and block by block where the preview would do that). It lists the
tokens inside `redact` elements, then checks the export door's text
(`prepareForExportSync`). A shaded token that the export keeps is a leak.

## The seed

The seed is the UTC date as a number, for example `20261114`. A night always
names the same notes, so you can reproduce one:

```sh
npm run fuzz:redaction -- --night 20261114
```

Use `--n` to change the case count, and `--no-save` to look without writing
anything.

## A leak becomes a test

Each leak is minimised: lines, then words, are deleted for as long as it
still leaks. The minimised note is added to
`tests/fuzz/redaction/regressions.json`, and the main suite replays every case
in `src/__tests__/redactionFuzzRegressions.test.ts`. So the suite fails until
the leak is fixed, and stays a test after that. With `--commit`, the host
commits the file on a new branch `fuzz/redaction-<night>` for a pull request.

The file starts with the 34 leaks that reviews 6 and 8 found in #473. All of
them leak on the reviewed commit, and none leaks now.

A leak that is known but not fixed yet carries an `open` field with its
finding's name. The suite then checks that it *still* leaks, so whoever fixes
it removes the field and the case stays a test. The first night (20261114)
found two such leaks in the `tags` generator: `W8.8-F1` (a carriage return
inside a tag) and `W8.8-F2` (a comment that opens inside a closing tag).
Both were fixed in #473, and they are now ordinary regression cases.

## On the second host

The nightly report goes to `reports/nightly/fuzz-redaction.json`. The second
host (W6.5) runs the step and seals the report into its receipt. Exit codes:
0 means no leak, 1 means leaks were found (and saved), and 2 means the run
broke.

## Scheduled

Two schedulers run it, and neither is GitHub Actions:

- **`npm run nightly`** has a `fuzz` kind that is due every night
  ([nightly runs](/contributing/nightly/)), on the machine whose launchd or
  cron starts the nightly. It runs without `--commit`, since that would
  switch branches under the kinds after it.
- **Buildkite's scheduled build.** `.buildkite/pipeline.yml` has a
  `fuzz-redaction` step with `if: build.source == "schedule"`. It runs on the
  Linux queue, reports the commit status `lumen/buildkite: fuzz-redaction`,
  and keeps `reports/nightly/fuzz-redaction.json` and `regressions.json` as
  artifacts. A PR build skips it, and it is not one of the receipt's gates.
  The schedule itself is set once in Buildkite: Pipeline → Settings →
  Schedules, cron `17 2 * * *` (UTC), branch = the current train.
