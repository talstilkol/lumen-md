---
title: AI cost — usage meter and answer cache
description: See what your AI requests cost, and avoid paying twice for the same answer.
---

Lumen calls the AI provider you choose with your own API key. Two
features keep that bill visible and small. Both run locally on your
device.

## Usage meter

Command: `AI: Usage & Cost This Month` (`⌘K`).

For the current month it lists requests, input and output tokens, and an
estimated cost per provider and model.

- **Exact counts** come from the provider whenever its API reports them:
  OpenAI, Claude (including prompt-cache reads and writes), Gemini and
  Mistral, both for regular and streamed answers.
- **Estimated counts** (about 4 characters per token) are used when the
  provider reports nothing, and are marked as estimated.
- **Local models** (Ollama, in-browser WebGPU) are counted at $0.
- **Prices** come from a built-in table of list prices, dated in the
  report. Treat them as an estimate; your provider's dashboard is the
  real bill. Models missing from the table are counted but not priced.

Usage stays in this browser's storage. It isn't synced and is never sent
anywhere.

## Answer cache

Command: `AI: Answer Cache…`.

Some commands transform a given text deterministically: auto-tag,
translate, diagram from text, action items, chart from data and heading
suggestions. When you run one of them again on exactly the same input
with the same provider and model, Lumen reuses the stored answer
instead of paying for a new one. Cache hits appear in the usage report.

- Change the text, the model or the provider and the request goes to the
  model again.
- Answers expire after 30 days. At most 500 are kept, and the oldest are
  dropped first.
- From the command you can turn the cache off (every request then asks
  the model) or clear it.
- Cached answers are stored in this browser's IndexedDB, on this device
  only.

## Claude prompt caching

With Claude, long system prompts and long documents sent as context
(about 8,000 characters or more) are marked for Anthropic's prompt cache.
A follow-up request on the same document within about five minutes reads
that prefix at roughly 10% of the normal input price. The usage report
shows these cache reads separately.
