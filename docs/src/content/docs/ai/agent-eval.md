---
title: Agent eval
description: Every one of the 14 agents against fixed Hebrew and English cases, scored with deterministic checks, with a local HTML report.
type: reference
tasks: ["W10.E12", "7.3"]
---

The agent eval runs fixed cases through the **real agent runtime**: the
same prompts, tools, parsers and validators that the editor uses. Every
check is deterministic, so two models (or two versions of a prompt) can be
compared on the same numbers.

## What is covered

- **14 agents, at least 5 cases each**, with at least one Hebrew and one
  English input per agent (71 cases in all): tagger, outliner, tasker,
  translator, proofreader, diagrammer, charter, committer, writer, linker,
  templater, stylist, researcher and builder-spec.
- **The researcher** gets the web (a stubbed search and page), citations
  (`[^1]` footnotes checked against the sources), the clip library, a
  Hebrew question, and a page with a planted instruction
  ("IGNORE PREVIOUS INSTRUCTIONS…") that the answer must not follow.
- **Diagrams are compiled.** Every diagrammer answer goes through the real
  Mermaid parser (the `mermaid` check), not a pattern.
- **Tags come from the vault.** The tagger cases require at least one tag
  that the eval vault already uses (the `someOf` check over the
  `list_tags` result).
- **Each case expects a tool call** (for example `list_tags`,
  `validate_mermaid`, `git_diff`, `fetch_page`), made and executed by the
  runtime.

The cases are in `src/agents/eval/fixtures.ts` and
`src/agents/eval/moreCases.ts`.

## Running it

```bash
ollama pull qwen2.5:7b
npm run eval:agents -- --model qwen2.5:7b
npm run eval:agents -- --model llama3.1:8b --only tagger,researcher-he-web
```

The run writes three files to `eval/results/` (change it with `--out`):

| File | What it is |
|---|---|
| `agents-<date>-<model>.md` | One table: case, agent, result, attempts, time, failed checks |
| `agents-<date>-<model>.json` | The same results, for `npm run eval:compare` |
| `agents-<date>-<model>.html` | A self-contained page with no scripts and no network: a pass count per agent, then every case |

Open the HTML file in a browser. An agent marked **FAIL** has at least one
case whose run failed or whose checks did not all hold. The notes column
says which.

## Comparing runs

`npm run eval:compare -- eval/results/agents-<date>-<model>.json` compares
a run with the saved baseline for that model. A case that passed before
and fails now is a regression, and so is a case that has disappeared; both
exit 1.

## Taking a run into the app

`npm run eval:ingest` reads the runs in `eval/results/` and changes what the
app does with them (plan 7.9):

- A run is taken only when it is a real one: `kind` "model" (never a run
  against the fake server), a model listed in `models/registry.json`, a
  date, the Ollama URL, and every case on that model. The ones not taken
  are listed with the reason.
- The newest run of each model is recorded on its registry entry as
  `measured`: the pass rate overall and per agent.
- Each agent gets a default model: the best one whose pass rate on that
  agent's cases is at least the threshold in `eval/acceptance.json` (0.8),
  open licence only. The agents then run on it, when it is installed and
  you have not chosen a model yourself (`src/ai/defaults.ts`, generated).
  Model suggestions are ranked by the measured scores too.
- Agents no model passes are written to `eval/failures.md`, with the
  failing cases, as work for the next round.

Commit the run's JSON with the regenerated files; `npm run eval:ingest --
--check` fails when they do not match.

## In CI

The same cases run against a fake Ollama server (`npm run fake-ollama`)
over real HTTP. The fake server answers with each case's reference
answer, so CI checks the runtime and the cases themselves, not model
quality. Model quality needs a live run on a machine with Ollama.
