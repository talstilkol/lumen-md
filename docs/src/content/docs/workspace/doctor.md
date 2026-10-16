---
title: Vault Doctor
description: Find broken links, orphans and near-duplicate notes across the workspace, without AI.
---

Command: `🩺 Vault Doctor: Check Workspace` (`⌘K`).

Vault Doctor reads every Markdown note in the open workspace folder and
opens a report in a new tab. The report links to every note it mentions,
so you can click straight through to fix things. It runs entirely on
your device and makes no AI calls.

| Check | What it finds |
|---|---|
| Broken wiki links | `[[Note]]` where there is no such note and no such heading in the same note. When exactly one note name is close (same words, or at most two typos), the report suggests it. |
| Missing headings | `[[Note#Heading]]` or `[[#Heading]]` where the heading doesn't exist. |
| Broken Markdown links | Relative links to `.md` files that don't exist. `../` and `%20` are resolved. |
| Ambiguous names | Two notes with the same file name. `[[name]]` can only open one of them. |
| Near-duplicates | Notes whose text overlaps by about 80% or more (MinHash over 5-word shingles). |
| Images without alt text | `![](…)` and `<img>` with no `alt`. |
| Empty notes | Nothing besides front matter. |
| Orphans | Notes that no other note links to. `index`, `README`, `home` and `welcome` don't count as orphans. |

Links inside code blocks and inline code are ignored.

## Applying the suggested fixes

Command: `🩺 Vault Doctor: Apply Suggested Link Fixes`.

This rewrites every broken wiki link that has a single suggestion, for
example `[[Projct Plan]]` → `[[Project Plan]]`. Labels and `#heading`
parts are kept. You get a list of the changes to confirm first. Notes
that are open in a tab are skipped, so unsaved edits are never
overwritten.
