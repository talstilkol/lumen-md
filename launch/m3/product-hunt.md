# Product Hunt (M3)

> Draft for the owner. Nothing here is posted. Launch a week after Show HN,
> at 00:01 PT, and stay in the comments for 6 hours (R6.11). Each claim
> carries its receipt, `[^id]`, from `claims.json`.

## Name

Lumen

## Tagline

Local-first Markdown notes, built for Hebrew and RTL

## Description

A free, open-source Markdown editor that starts from Hebrew and right-to-left.[^mit][^rtl-per-line] Notes stay on your device as plain files, plugins run sandboxed, and AI can run locally.[^no-account][^plugin-no-access][^local-ai]

## Topics

Productivity, Note taking, Open Source, Privacy

## First comment

Hi PH! I built Lumen because Hebrew and right-to-left were always an afterthought in note apps. Here direction is set per line,[^rtl-per-line] and search ignores niqqud and prefixes.[^hebrew-search] No account: with default settings nothing leaves your device.[^no-account] Plugins run with no access unless you grant it.[^plugin-no-access] It's MIT-licensed.[^mit] Honest about the gaps: no external security audit yet,[^no-external-audit] and the comparison page lists what's missing.[^compare] I'm here all day for questions.

## Gallery

The screenshots from `launch/press-kit.md` (made-up notes only), then the 60-second demo (`demo-60s.md`).

<!-- launch-kit:sources -->

## Sources

[^mit]: Open source under the MIT licence. Receipt: `LICENSE`.
[^rtl-per-line]: Direction is set per line, from its first strong letter. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^no-account]: No account; with the default settings nothing leaves the device. Receipt: `docs/src/content/docs/security/privacy-report.md`.
[^plugin-no-access]: Every plugin runs with no access by default. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^local-ai]: AI can run entirely on the device (WebGPU), with no per-token cost. Receipt: `docs/src/content/docs/ai/local-llm.md`.
[^hebrew-search]: Search folds niqqud, final letters and the prefix letters. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^no-external-audit]: Lumen has not had an external security audit, so its cryptography must not be called audited. Receipt: `docs/src/content/docs/security/index.md`.
[^compare]: An honest comparison with Obsidian, Notion and Google Docs, with a source for every claim and what Lumen still lacks. Receipt: `docs/src/content/docs/project/compare.md`.

<!-- /launch-kit:sources -->
