---
title: Local agents
description: Every AI command runs through one local agent runtime — the model proposes, tools execute, validators decide, and an improvement agent steps in when there is no answer.
---

Lumen's AI commands are **agents**: a definition of what to ask the
model, which tools it may call, what shape the answer must have and how
to check it. One runtime (`src/agents/runtime.ts`) runs every definition
against the first available **executor**, on this device whenever it
can:

| Executor | Where it runs | Tool calling | JSON output |
|---|---|---|---|
| Ollama | a local Ollama server | native (`tools`) | native (`format`) |
| web-llm | your browser, on the GPU | JSON-ReAct protocol | JSON mode |
| `chat()` | whatever provider you selected | JSON-ReAct protocol | prompt |

The **AI policy** (`⌘K → "AI: Local or Cloud Policy"`) decides whether a
cloud provider may ever be contacted. The default on a fresh install is
*local only*.

## What a run does

1. Picks the first available executor in the agent's preference order.
2. Sends the system and user prompts. When the agent has tools and the
   executor cannot call them natively, the prompt teaches the JSON-ReAct
   protocol: the model answers `{"tool": …, "args": …}` or
   `{"final": …}`, one JSON object per turn.
3. Executes each tool call. The arguments are checked against the tool's
   JSON Schema first. Tools that write or reach the network need a
   permission the command grants explicitly, and even then a write tool
   only **proposes** a change you approve, and a network tool goes out
   only when the AI policy or your consent allows it (see
   [Tools](#tools)).
4. Parses the final answer (JSON when the agent declares a schema) and
   runs the agent's **validators** — a Mermaid diagram must compile, an
   ECharts option needs series and axes, tags must exist, offsets must
   fall inside the text.
5. When there is no usable answer, the **improvement agent** (the
   critic) diagnoses the failure and proposes one change for a retry —
   temperature 0 with the validator's error fed back, then a larger
   model tier — up to two retries. If that still fails, the run ends
   with **suggestions** you can act on: start Ollama, allow the app's
   origin (`OLLAMA_ORIGINS`), pull a model, split the document, try
   another executor, or allow the cloud.
6. When the retries are used up, a small local model (the tiny tier)
   reads the failure and may add one or two suggestions in plain
   language. The suggestions panel opens on its own; pressing a
   suggestion does it (pulls the model, switches the executor, changes
   the policy) and runs the command again.

Every run is recorded on this device: `⌘K → "AI: Recent Agent Runs"`
shows the executor, model, tool calls, retries and failures of the last
50 runs.

## Tools

Every tool declares a JSON Schema for its arguments and a scope. The
runtime refuses a call whose arguments do not match (numbers and
booleans sent as strings are accepted), and every call — with its
outcome — is in the run's trace.

| Scope | Tools | What the runtime does |
|---|---|---|
| read | `read_file`, `list_files`, `file_exists`, `search_workspace`, `get_frontmatter`, `list_tags`, `get_document`, `get_selection`, `get_headings`, `validate_mermaid`, `validate_echarts`, `validate_json`, `git_diff`, `extract_quotes`, `csv_parse` | Always allowed. |
| write | `write_file`, `set_frontmatter`, `replace_range` | Needs the run's `write` grant. The tool never writes: it **stages** the change (`src/agents/staging.ts`) and the run lists the staged ids. Only approving a change writes it — and only if the file or the text it was computed from has not changed since; otherwise it is marked as a conflict. A cancelled run withdraws what it staged. |
| network | `search_web`, `fetch_page` | Needs the run's `network` grant. Both go through the research service (a local SearXNG or the research worker) — never a direct request to a web page — and send only the query or the page address. The agent writes that query itself, possibly from your notes, so text from them can be in it. Under **local only** every call asks you first: the prompt names the tool, the host and shows exactly what is sent, all of it, and the call then goes out with exactly the service and settings it named, and a one-time consent you gave to web research does not count for agents. Without your yes the call is refused before anything is sent, and the refusal is recorded. Every request is recorded in the privacy ledger, marked when it went out on consent. |

`git_diff` shows the unified diff of a cloned repository: HEAD against
the working copy by default (what the next commit records), or against
the index with `staged`. `set_frontmatter` edits YAML frontmatter
through the `yaml` document model, so comments and the other keys stay
as they were. `extract_quotes` checks quotes word for word against a
page read in the same run, a workspace file or the open document, and
returns the exact text with its offsets. All tools stop when the run is
cancelled.

### Outside content (prompt injection)

Web pages, search results, clipped pages (the `Library` / `ספרייה`
folder or a `source: https://…` frontmatter), notes that came from a git
clone or pull, notes with `untrusted: true` in their frontmatter, and the
notes that Research writes (they carry that frontmatter, because they are
built from pages and quotes) are **outside content**. Someone else wrote them, and they may contain
instructions planted for the agent. The runtime (`src/agents/untrusted.ts`)
handles them like this:

- **Delimited.** The model gets such text between `⟪untrusted id=…⟫` and
  `⟪/untrusted id=…⟫` markers. The id is random, so the content cannot
  close the block itself. The system prompt says that text inside the
  markers is data and never instructions.
- **Cleaned, never silently.** Unicode tag characters (invisible ASCII)
  are decoded and shown. Zero-width characters and bidi controls are
  removed, and their count is printed on the block. HTML comments and
  CSS-hidden elements are shown as hidden. Instruction-like passages in
  English and Hebrew ("ignore previous instructions", "התעלם מכל
  ההוראות", role tokens, "send this note to …") stay in the text inside
  a visible `⟦flagged …⟧` marker.
- **Approval.** Once a run has outside content in its context, every
  write tool and every network call asks you first. The prompt names the
  tool, what it would do and where the outside content came from. Under
  **local only**, a network call's own prompt carries the same warning.
  Without your yes nothing is staged or sent. Approving a staged change
  is still a separate step.

The rules are deterministic, so they work the same in Hebrew and English
and need no model. They do not catch a politely worded request ("please
also save a copy as …"). The approval step is what stops those. An
optional English classifier (ProtectAI v2) for the desktop app is a
follow-up.

### Every AI command is an agent

All AI commands run through the agent runtime: the executors (local first), the AI policy, the quota, the injection guard and the trace. That includes the ones that used to call the model directly: ghost text and the inline suggestion (`completer`), AI Rewrite (`rewriter`, which also follows your style profile), Ask Workspace (`answerer`), the voice-memo summary (`memo-summarizer`), the builder's architecture / tests / README stages, and batch jobs (`batch`, on the job's local model, charged once when the job is submitted). A test checks the source: nothing outside the executors calls the model directly.

### Which agent uses which tools

| Agent | Tools |
|---|---|
| tagger | `list_tags` |
| linker | `list_files`, `search_workspace` |
| outliner | `get_document`, `get_headings` |
| tasker, translator, proofreader | `get_document` |
| diagrammer | `validate_mermaid` |
| charter | `csv_parse`, `validate_echarts` |
| committer | `git_diff` (subject and a short body) |
| writer, templater | `get_selection` |
| builder | `list_files` |
| stylist | `list_files`, `read_file` |

What an agent always needs — the workspace's tags for the tagger, the
note list for the linker, the parsed table for the charter, the diff
for the committer — the runtime fetches through the same tool path
before the model starts, so the model sees it as its own call and can
ask for more. The daily digest reads the vault the same way.

On a small model, every turn is held to a JSON Schema (Ollama's
`format`, web-llm's grammar): a call to one of the agent's own tools
with valid arguments, or the final answer in the agent's format. A
streaming agent (writer, templater) gets its tools' results before it
starts, and its answer still streams.

The builder writes the whole project at once, when every file is done:
if one fails, none is written.

## AI settings

`⌘K → "AI: Settings (local agents)"` gathers everything in one panel:

- the AI policy;
- **who runs the agents** — automatic (Ollama → browser → chat provider)
  or one executor first, with a live *available / not available* check
  for each;
- the Ollama address and model, with the models already installed;
- the in-browser model, the device card (WebGPU, f16, a VRAM budget
  estimate) and the catalogue, with models too large for this device
  disabled;
- the grammar (LanguageTool) and research (SearXNG worker) addresses;
- your writing-style profile on/off;
- the last ten agent runs.

The panel writes the same settings the runtime reads; nothing is stored
twice. The VRAM budget is a heuristic from the browser's coarse hints,
not a measurement.

## Transcription and embeddings on this device

Speech recognition and text embeddings do not go through a chat model:
they run in a second worker on
[transformers.js](https://github.com/huggingface/transformers.js) with
ONNX Runtime (WebGPU when the GPU is usable, wasm otherwise). The ONNX
Runtime files are served from this app's own origin (`/ort/`), so no CDN
is contacted; the models come from Hugging Face and are cached in the
browser.

| Task | Model | Size | Notes |
|---|---|---|---|
| Voice memo (`🎙 Voice memo`) | `onnx-community/whisper-small` | ≈ 250 MB | WebGPU; multilingual (Hebrew included) |
| Voice memo on a strong GPU | `onnx-community/whisper-large-v3-turbo` | ≈ 800 MB | WebGPU, ≥ 6 GB budget |
| Voice memo without WebGPU | `onnx-community/whisper-tiny` | ≈ 40 MB | wasm, slower |
| Smart search embeddings | `Xenova/multilingual-e5-small` | ≈ 120 MB | 384 dimensions, ~100 languages |

Under *local only* the cloud Whisper API is never used; under *local
first* it is the fallback when the local path fails; under *cloud* it is
used directly.

## Ollama from the hosted app

A page served from `https://lumen-md.vercel.app` may only call your
local Ollama when Ollama allows that origin:

```
OLLAMA_ORIGINS=https://lumen-md.vercel.app ollama serve
```

(on macOS: `launchctl setenv OLLAMA_ORIGINS https://lumen-md.vercel.app`
and restart Ollama). Without it Ollama answers `403` and the improvement
agent suggests exactly this fix. The desktop app and `localhost`
development builds need no change.

## Research, grammar and search on this machine

`docker/local-ai.yml` starts three services:

| Service | Port | What it does |
|---|---|---|
| SearXNG | 8888 | Metasearch, no API key |
| research service | 8787 | The same worker Lumen deploys (`edge-workers/research`), run with `wrangler dev`: page extraction plus SearXNG search |
| LanguageTool | 8010 | Grammar and spelling checks |

```
docker compose -f docker/local-ai.yml up -d
```

Then `⌘K → Research: Settings → SearXNG on this machine` and enter
`http://localhost:8787`. Research questions are planned and answered by
your local model; quotes are still verified word for word against the
pages. Under *local only* a research service off this machine or network
is refused. On a fresh install with the *local only* policy, SearXNG is
the default research provider.

## Evaluating a local model

`npm run eval:agents` runs twelve fixed cases — most of them in Hebrew —
through the real agent runtime against your Ollama, and writes a report
to `eval/results/`:

```bash
ollama pull qwen2.5:7b
npm run eval:agents -- --model qwen2.5:7b
npm run eval:agents -- --model llama3.1:8b --only tagger-he,tasker-he
```

In CI the same cases run against a **fake Ollama server**
(`npm run fake-ollama`, `scripts/fake-ollama.mjs`) over real HTTP: the
runtime, the Ollama executor, the parsers and validators are exercised on
every pull request without a GPU. Only model quality needs the live run.

Every check is deterministic (Hebrew share of the letters, required and
forbidden words, list lengths, length limits, a pattern), so two models
or two prompt versions can be compared on the same numbers. The report
lists each case with pass/fail, attempts (retries the improvement agent
asked for) and time. The reference answers in
`src/agents/eval/fixtures.ts` run in CI through each agent's own parser
and validators, so a broken fixture is caught before a long GPU run.
