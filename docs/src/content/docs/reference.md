---
title: "Reference"
description: "The facts: every key, setting, format, command and API, to look up."
type: reference
---

The facts: every key, setting, format, command and API, to look up.

58 pages.

## AI

- [Agent eval](/ai/agent-eval/) — Every one of the 14 agents against fixed Hebrew and English cases, scored with deterministic checks, with a local HTML report.
- [Airplane mode and the network monitor](/ai/airplane-mode/) — One switch that stops every network request Lumen can make, a live list of every attempt with where in the code it came from, and a certificate of the time it was on.
- [Cloud only by choice](/ai/cloud-routes/) — Every AI feature has an engine on this device; a cloud service is used only when you choose it. The full list of cloud routes and what each needs.
- [External agents (ACP)](/ai/external-agents/) — Host Claude Code, Codex or OpenCode on the desktop over the Agent Client Protocol. Every write they make waits in the same review queue as Lumen's own agents.
- [Held-out sets](/ai/heldout/) — Eval sets the feature authors never see — encrypted, scored by a separate evaluator that reports aggregates only, with a contamination check on the repo and every PR.
- [Local agents](/ai/local-agents/) — Every AI command runs through one local agent runtime — the model proposes, tools execute, validators decide, and an improvement agent steps in when there is no answer.
- [MCP and the lumen CLI](/ai/mcp/) — Let Claude Desktop, Claude Code or your IDE search and read your vault — off by default, with scopes per client, and every change waits for your approval.
- [Measuring the local models](/ai/model-bench/) — npm run bench:models runs every local engine on its golden set in a real browser, with WebGPU, and writes time, memory and quality into models/registry.json.
- [Where models download from](/ai/model-hosting/) — Every model file comes from Hugging Face, Lumen's mirror or your own copy, and is checked against its sha256 whichever source served it.
- [Real models day](/ai/models-day/) — One command that runs every real-model eval on a machine with Ollama and a GPU, resumes after a stop, and writes one sealed report.
- [Privacy and the AI policy](/ai/privacy/) — What stays on your device, the one setting that decides whether AI may ever use the cloud, and the ledger that records every AI network request.
- [Research and citation checks](/ai/research/) — Ask a question and get a note with a quoted source for every claim; check the citations in any note.
- [Agent skills](/ai/skills/) — Your own AI workflows as files in the vault — run them with "/" in the AI prompt or the command palette, with only the tools they declare and every change waiting for your approval.
- [Grounded summaries on this device](/ai/summarize/) — Summaries made on this device whose every sentence is copied from the text and checked against it — Chrome's Summarizer for English, a local model for Hebrew, and a model-free fallback.
- [Reliable tool calls on small local models](/ai/tool-calls/) — How Lumen keeps a 7–12B local model's tool calls valid. Every call is held to a JSON schema, common slips are repaired, and an invalid call gets one retry before Lumen asks you.
- [Translation review (the UI's seven languages)](/ai/translation-review/) — The agent that checks every translation of Lumen's interface against its English — missing variables, odd lengths, untranslated strings and, on this machine, a back-translation.

## Blocks

- [Citations (BibTeX)](/blocks/citations/) — A ```bibtex block becomes a reference list in APA 7, Chicago author-date or MLA 9 — in English or Hebrew, with nothing sent anywhere.
- [Dynamic blocks reference](/blocks/reference/) — The fenced code-block languages that Lumen renders as live, interactive previews.

## Collaboration

- [Havruta: study with a partner](/collab/havruta/) — A shared, end-to-end encrypted study room on a Sefaria reference. Your notes travel, the text stays on each device, and the room is deleted when you finish.
- [Persistent rooms](/collab/persistent/) — Keep a collaboration room alive when every peer has left, with a small y-websocket server you run yourself.

## Editor

- [Accessibility conformance report (ACR) — WCAG 2.2 and EN 301 549](/editor/acr/) — Every WCAG 2.2 level A and AA success criterion, with Lumen 0.1.0's status, remarks, evidence and remediation plan.
- [Citations with [@key]](/editor/citations/) — Cite from your BibTeX, CSL-JSON or Zotero library with pandoc's [@key, p. 10], in APA, Chicago, MLA or the Israeli APA, with a reference list in the preview, DOCX and PDF.
- [Lists, cursors and Vim](/editor/editing-keys/) — Smart lists, several cursors and column selection, and Vim mode — in the source editor, in Hebrew and in English.
- [Hebrew keyboard layout](/editor/hebrew-keyboard/) — Shortcuts that work with the Hebrew layout on, and search that understands text typed with the wrong layout.
- [Hebrew and right-to-left](/editor/hebrew-rtl/) — How Lumen decides the direction of every block — paragraphs, tables, lists, quotes and code — in the editor, the preview, WYSIWYG and the export.
- [Obsidian syntax](/editor/obsidian-syntax/) — Callouts, comments, coloured highlights, footnotes with hover, math and image sizes, written the way Obsidian writes them, so a vault moves to Lumen without changing a line.
- [Reading modes and the reading profile](/editor/reading-modes/) — One menu for every reading mode, and a reading profile per note — font, width, niqqud, aids, layout, voice and speed — kept in the note's frontmatter or on this device only.
- [Reading options and Hebrew fonts](/editor/reading/) — Choose the Hebrew font, size, line height and column width of the preview — for every note or one note — with spaced Hebrew and a dyslexia-friendly font for English. Fonts download only when chosen, from the app itself.
- [Screen readers, automated](/editor/screen-reader-automation/) — The Hebrew screen-reader journey run by Guidepup under VoiceOver and NVDA, and the accessibility-tree snapshots that run with every end-to-end test.
- [Settings](/editor/settings/) — One screen for every setting — tabs, search, and export / import of your choices.

## Getting started

- [Keyboard shortcuts](/getting-started/shortcuts/) — Every shortcut Lumen binds, where it works, and how to find the rest in the command palette.
- [What's new](/getting-started/whats-new/) — After an update, Lumen shows that version's release notes once, in your interface language.

## Plugins

- [Plugin API](/plugins/api/) — The lumen object a sandboxed plugin gets — every method, the capability it needs, its limits, and the UI elements.
- [Permissions and safety scan](/plugins/permissions/) — Before a sandboxed plugin installs, Lumen shows every permission it asks for in plain language; every version in the registry is scanned, and a version that fails is not shown.
- [Plugin SDK](/plugins/sdk/) — Build your own Lumen plugin in 60 seconds with create-lumen-plugin.
- [Web Clipper](/plugins/web-clipper/) — Save a web page as a clean Markdown note, from inside Lumen or with the browser extension, which hands the clip to the app. No clip server.

## Project

- [Checking Lumen against Obsidian](/project/obsidian-check/) — The owner's checklist for opening a vault Lumen saved in the real Obsidian (1.15 or later) and comparing every Bases view, row by row.

## Security and privacy

- [Data-safety drill](/security/data-safety-drill/) — Every way Lumen saves a note to a folder, driven through kill -9, a full disk, lost permissions and another program editing at the same time, with a report per release.
- [Journalist mode: redaction and locked notes](/security/journalist-mode/) — Text you redact is removed from every export, not covered. A note can be locked with a password of its own.
- [Supply chain](/security/supply-chain/) — Fuzzed decoders, a reproducible build, an SBOM and offline-signed checksums for every release — and how anyone can check them.

## Sync and publishing

- [Sync status, selective sync and time left](/sync/status/) — See what the encrypted sync is doing for every file, choose what each device syncs, and how long a round will take.
- [Sync in two clicks](/sync/two-clicks/) — A guided setup that picks the best place for your encrypted notes on this device, makes the key for you, and shows every file's state.

## Workspace

- [Academic submission (Word)](/workspace/academic-docx/) — Export a note as a Word file formatted to an Israeli university's written guideline, with a title page, a table of contents, page numbers, footnotes and a bibliography.
- [Fill properties with AI — with approval](/workspace/ai-autofill/) — A model proposes the missing properties of a folder's notes; every proposal waits in an approval queue, and nothing is written until you approve it.
- [Automations (when… then…)](/workspace/automations/) — Simple rules that file, tag and log your notes on this device — with a dry run that changes nothing, a log of every run, and undo.
- [Database formulas and map view](/workspace/database-formulas/) — Computed columns for the database block — syntax, every function, limits — and the map view for notes with coordinates.
- [All highlights](/workspace/highlights/) — Every highlight from PDFs, books and clipped pages in one place: search them, tag them, export them to a note with links back, or drag one into a note.
- [Version history and undoing a delete](/workspace/history/) — Every note keeps its earlier versions, shared sessions included, in little space; a delete is undone with Ctrl+Z or from the trash; and the history panel shows whether the browser may clear your storage.
- [Jewish sources from Sefaria](/workspace/jewish-sources/) — Quote a verse, a mishnah or a Talmud folio by its reference, with each text's licence. Keep a copy for offline use, and see every note that cites the same verse.
- [Literature review matrix](/workspace/literature-review/) — One table of every PDF in the vault, with question, method, sample, findings and limitations, and each value backed by a quote verified on its page. Runs on this device.
- [Mail and Google Takeout into notes](/workspace/mail-import/) — Import .eml and .mbox mail and a Google Takeout archive (Keep, Docs) into notes, from files only, with Hebrew mail in every old encoding.
- [Notion's formulas in Bases](/workspace/notion-formulas/) — Notion's formula functions (dates, text, numbers, lists with current and index, lookups through relations) inside .base formulas and filters, plus two for Hebrew.
- [Open sources](/workspace/open-sources/) — One search over Sefaria, the Knesset, data.gov.il and the CBS, and the Ben-Yehuda library, with the rights of every result and the right way to quote it.
- [Ask a PDF](/workspace/pdf-chat/) — Questions about a PDF answered on this device from its own pages — every answer with quotes you can open at their page and line.
- [PDF reader and highlights](/workspace/pdf-reader/) — Read PDFs in the vault, highlight text (Hebrew included), and keep every highlight as a W3C Web Annotation in a Markdown note that links back to the page.
- [Print and PDF](/workspace/print/) — Print a note or save it as a PDF the way a word processor would, with page numbers (Hebrew numerals too), a header and footer, a table of contents, clean page breaks and embedded fonts.
- [Student mode](/workspace/student-mode/) — Record a lecture, tap Important at the moments that matter, and get a transcript with a ▶ for every sentence, a summary taken from what was said, and review cards linked to their moments. All on this device.
- [Safe saves and the vault check](/workspace/vault-integrity/) — Every save lands whole, even if the app is killed half way; the vault check finds damaged files and repairs them with a backup first.
