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
3. Executes each tool call. Tools that write or reach the network need a
   permission the command grants explicitly; a model can never write
   where you did not expect.
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

Every run is recorded on this device: `⌘K → "AI: Recent Agent Runs"`
shows the executor, model, tool calls, retries and failures of the last
50 runs.

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
