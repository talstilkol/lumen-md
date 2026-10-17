---
title: Local LLM (web-llm + WebGPU)
description: Run AI prompts entirely on your device — private, offline-capable, no per-token cost.
---

Lumen routes every AI command through `chat()`. With `useLocalAi`
toggled on (and a WebGPU-capable browser), prompts go to a model
running in your tab via [web-llm](https://github.com/mlc-ai/web-llm) —
nothing leaves the machine.

## Switch on

```
⌘K → "Switch to local AI (WebGPU)"
```

The first prompt downloads the model weights (≈ 4 GB for
`Llama-3-8B-Instruct-q4f16_1`). Subsequent prompts are instant — the
model lives in WebGPU buffers until you close the tab.

A toast surfaces download progress at 5% intervals so you know the
first prompt is working, not stuck.

## When to use it

- You're on a plane / café / corporate network without API access.
- The note contains secrets you don't want to put into a hosted LLM.
- You want predictable cost — local inference is free after the
  one-time download.

## When not to use it

- Long-context tasks (>4k tokens) — the 8B model loses coherence.
- Latency-sensitive flows — local inference is ≈ 5–10× slower than
  GPT-4o-mini for the first token.
- Older laptops — the model needs ≥ 4 GB of GPU memory.

## How to fall back

What happens when WebGPU (or Ollama) isn't available depends on your
**AI policy** (`⌘K → "AI: Local or Cloud Policy"`):

- **Local only** (the default on a fresh install): nothing leaves the
  device. The command stops with a clear message and the agent's
  suggestions (start Ollama, pick a smaller model, use a WebGPU browser).
- **Local first**: `chat()` warns you and falls back to your cloud key.
  An installation that already had a cloud provider or key configured
  before policies existed keeps working this way until you choose.
- **Cloud**: the selected cloud provider is used directly.

See [Local agents](/ai/local-agents/) for how every AI command runs
through the local agent runtime.

## Pick a different model

```js
// Example only — UI exposure of the model picker comes in a follow-up.
import { chatLocal } from "lumen/ai/localLlm";
await chatLocal(messages, { model: "Phi-3-mini-4k-instruct-q4f16_1-MLC" });
```

Models registered in `@mlc-ai/web-llm` work without any changes — the
chat function takes the model id verbatim.

## Privacy claim

When `useLocalAi` is on AND `localLlmAvailable().available === true`,
prompts never leave your tab. The only network requests web-llm makes
are the initial weight downloads (from `huggingface.co` mirrors) plus
optional telemetry that you can disable. No prompt content is
transmitted.
