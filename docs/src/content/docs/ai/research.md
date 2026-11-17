---
title: Research and citation checks
description: Ask a question and get a note with a quoted source for every claim; check the citations in any note.
type: reference
tasks: ["R12.11", "W10.E36", "7.6", "R12.9", "5.4"]
---

## Research: Ask a Question

Command: `🔎 Research: Ask a Question…`.

Lumen searches the web, reads the sources and writes a new note. The
note starts with a short summary, followed by sections, and every claim
carries a footnote. Each footnote holds the passage from the source
that supports the claim:

```md
Roses are pruned in early spring.[^1]

[^1]: [Rose guide](https://example.org/roses) — “Prune roses in early spring, when buds swell.”
```

Choose how Lumen searches with `🔎 Research: Settings…`:

| Search | Needs | How it works |
|---|---|---|
| **Claude web search** (default) | AI provider set to Claude (Anthropic) | One request: Claude searches (up to 5 searches), reads and answers. The quotes are copied word for word from the pages by Anthropic. Anthropic bills the searches separately from tokens. |
| **SearXNG** / **Brave Search** / **Tavily** | The research service on this deployment (a local SearXNG needs no key; Brave and Tavily need yours) | The **researcher agent** runs on your AI model, local first, in a tool loop. It searches (`search_web`), reads the pages it chooses (`fetch_page`), and copies the passages it cites (`extract_quotes`). Then Lumen runs the **cite-or-delete gate**, outside the model (see below). If fewer than half of the quotes are in their pages, the agent tries once more and is told to quote word for word. |

Under the **local only** AI policy:
- **With a remote research service:** the same agent answers from your **clip library** (`Library/`, `ספרייה/`) and nothing leaves the device.
- **With a research service on this machine:** every search and every page read asks you first. Only the search query, or the page address, is sent.

### Cite or delete (researcher agent)

Every sentence of the agent's answer must be tied to an exact quote from a source it read in this run, or it is **deleted**:

- The model only says which source a sentence rests on (`[^n]`). **Lumen picks the quote**: a passage of that source, found at exact character offsets. The model's own quote is one candidate, and it is used only when it is really in the page.
- A passage backs a sentence when it holds at least 3 of every 4 of the sentence's content words (Hebrew prefix letters such as ו־, ה־, ל־ are tolerated), every number the sentence states, and the same polarity. A "not", "never", "לא" or "אסור" on one side only is a contradiction, not support.
- What you see in quotation marks is the source's own text at those offsets, never the model's. Niqqud, final letters, quote marks and emphasis are the only differences forgiven.
- The note's first line always says how many sentences were removed, for example "2 sentences were removed: no exact quote in the sources backs them." Headings with nothing left under them go too; a code block is removed, because nothing quotes code at offsets.
- For a library note, the footnote links the paragraph when it has a `^id`.

The gate was measured on a **synthetic** set of 30 questions (15 English, 15 Hebrew; `eval/synthetic/cite-gate`), each answer mixing true sentences with planted lies. Result in `eval/cards/cite-gate.json`: 0 shown quotes that are not in the source. It is tagged `dev`: it shows how the gate treats known lies, not quality on real answers.

### Paragraph → claims

Command: **AI: Paragraph → Claims**. It works on the paragraph that holds the cursor:

1. **Selection (rules):** questions, opinions and hedges ("I think", "maybe", "לדעתי", "אולי", "should") and sentences with fewer than three content words or numbers are left out.
2. **The local model** resolves pronouns ("She moved…" → "Dana Levi moved…") and splits each sentence into atomic claims. It may use only words the paragraph has; a claim with any other word is dropped as invented.
3. **The cite-or-delete gate** picks each claim's quote from the paragraph at exact offsets. A claim without one is dropped.

The candidates appear under the paragraph in a `[!claims]` callout. Each one has its quote, and the callout says how many were dropped. Nothing is recorded as a fact; Undo removes the callout. Each candidate keeps its note, paragraph anchor, offsets, paragraph hash, extractor version, model and date for the review queue.

The Claude web search route is not gated this way: Anthropic returns its own verbatim quotes but not the page text, so Lumen has nothing to align offsets against. Its unsupported passages are still flagged.

Every page is outside content: the agent gets it cleaned and delimited, and instructions planted in it are flagged (see Local agents → Outside content). The note is saved with `untrusted: true` in its frontmatter.

Pages the research read but didn't cite are listed under "Also read".
Every model call appears in `AI: Usage & Cost This Month`. A research
run counts as one prompt against your plan's AI quota.

## Research: Verify Citations in This Note

Command: `🔎 Research: Verify Citations in This Note`.

This works on any note, not only research output. Lumen reads the
footnotes that link to web pages and checks each one:

| Result | Meaning |
|---|---|
| ✅ quote found | The quoted passage is on the page. Quote marks, dashes, case and spacing don't need to match exactly. |
| 🟡 found approximately | At least 85% of the quote's words appear close together on the page. A quote longer than 200 words is scored on samples, so it is "approximate" unless it is on the page word for word. |
| ❌ quote not found | The page is reachable, but the passage isn't on it. |
| 💀 dead link | The page returned an HTTP error. |
| ⚠️ couldn't read | The address was blocked, the page isn't HTML or text, or the request timed out. |
| 🔗 reachable | The footnote has no quote, so only the link was checked. |

Footnotes can be written as `[^1]: [Title](url) — “quote”`, as
`[^1]: url "quote"`, or as just a link.

## Research: Search the Library by Meaning

Command: `🔎 Research: Search the Library by Meaning`.

The library panel searches your clips by what they are about, not only by
their words. "Cranes resting in the valley" finds a clip about bird
migration over the Hula even when it never uses those words.

- **Clips only.** A note is a clip when it is in the library folder
  (`Library/`, `ספרייה/`) or its frontmatter has `clipped:`, which every
  clip template writes. Your other notes are not in this index; smart search
  covers them.
- **Indexed on this device**, with the same embedding model as smart search:
  Ollama if it has an embedding model, otherwise the built-in multilingual
  model. A cloud model is used only under the cloud AI policy.
- **When it is built.** The first time you open the panel, it indexes the
  clips already in the vault. The first build may download the embedding
  model, so it happens only when you ask. After that, a clip is indexed when
  you save it. If smart search has already built its index on this device,
  new clips are indexed from the start.
- Opening the panel also catches up with clips you changed or deleted.
- In an encrypted vault the index is stored encrypted, like smart search's.

## The research service

Reading pages and Brave / Tavily searches go through a small worker that
your deployment runs (`edge-workers/research`, set with
`VITE_RESEARCH_ENDPOINT`). Browsers can't fetch other sites directly.

- It only reads public http(s) pages, never internal addresses.
- It reads at most 2 MB per page.
- It forwards no cookies.
- Your search key is passed through for each request and is never
  stored.
- It only answers your app's own origins.
- It requires a shared token (`RESEARCH_TOKEN`). You enter it under AI
  settings → Research token; it is kept in the app's secret store and is
  never built into the app. A token entered there is sent only to the
  research address that was in use when you saved it. Without a token
  configured, the service refuses every request.

Claude web search doesn't need the service.

## Known limitations — status

| Id | Limitation | Status |
|---|---|---|
| A7 | Approximate quote matching is a heuristic with a compute budget | Decision: kept. The check runs on your device, so a long quote is scored on up to 5 samples of 200 words. A quote is ✅ only when it is on the page word for word; a full score on the samples alone is 🟡 "checked on samples". |
| A8 | No real authentication without accounts | Fixed in part. The token is now required: a service without one refuses everything. In a public web app the token ships in the app, so it only stops casual reuse. To restrict who may use it, put the service behind Cloudflare Access and add a rate-limiting rule. |
