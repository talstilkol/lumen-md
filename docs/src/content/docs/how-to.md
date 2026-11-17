---
title: "How-to guides"
description: "Recipes for one task each: what to do to get a result."
type: reference
---

Recipes for one task each: what to do to get a result.

193 pages.

## Account

- [Organization settings](/account/organization/) — Name your organization, restrict e-mail domains, check SSO and members.
- [Signing in](/account/sign-in/) — What each sign-in status means and how to fix the common errors.
- [Single sign-on (SSO)](/account/sso/) — Sign in with your company's identity provider through WorkOS.

## AI

- [Auto-tag + link suggestions](/ai/agents/) — AI assistants that read your workspace and propose structure.
- [AI-written text](/ai/authorship/) — Text the AI wrote is shown lighter until you edit it — in the editor, saved per note, and optionally in the export.
- [Local autocomplete (FIM)](/ai/autocomplete/) — Completions as you type from a coding model on this device — Ollama with qwen2.5-coder, or the in-browser model — with no cloud route at all.
- [Batch jobs — pause, resume, progress](/ai/batch/) — Run tags, summaries or translations over a folder on this device, watch the progress live, and pause, resume or cancel the job — also after a reload.
- [AI cost — usage meter and answer cache](/ai/cost/) — See what your AI requests cost, and avoid paying twice for the same answer.
- [Data analyst](/ai/data-analyst/) — Ask a question about a table in your note; a short Python program answers it on this device, checked by a second run.
- [DictaLM 3.0 (Hebrew)](/ai/dictalm3/) — Dicta's Hebrew–English model in the local model catalogue — what is verified, what waits for a check, and when it may become the default.
- [AI doctor](/ai/doctor/) — One check of the whole local-AI stack, from Ollama to the on-device engines, with the exact fix for each row.
- [Choosing the Hebrew search model](/ai/embedding-competition/) — How Lumen picks the model behind semantic search and suggested links. It runs a competition on a hard Hebrew question set, and the default changes only for a clear, measured gain.
- [External OCR benchmark (HebOCRBench)](/ai/hebocrbench/) — How Lumen's OCR is measured on HebOCRBench, an outside Hebrew benchmark whose answers only its organisers hold, and where the scores are published.
- [Hebrew dictation, models and accuracy](/ai/hebrew-dictation/) — Which speech model Lumen uses for Hebrew in the browser and on phones, how each sentence is re-read by Whisper, and how accuracy (WER) is measured.
- [Image descriptions on this device](/ai/image-captions/) — Alt text for pasted and attached images — OCR, a local vision model, or a captioning model in the browser. Nothing is sent to the cloud.
- [Image search by description](/ai/image-search/) — Find an image in your notes by describing it, in Hebrew or English, on this device.
- [Train a model on your style, on this machine](/ai/local-fine-tune/) — A LoRA adapter trained on your own notes on a Mac or NVIDIA computer and used in Ollama. Nothing is uploaded.
- [Local LLM (web-llm + WebGPU)](/ai/local-llm/) — Run AI prompts entirely on your device — private, offline-capable, no per-token cost.
- [Meeting notes on this device](/ai/meeting-notes/) — Record a meeting, transcribe it on this device, and get its decisions, tasks with owner and date, and open questions — tasks in the task panel, dates in a calendar file.
- [Meeting transcripts with speakers](/ai/meeting-speakers/) — Transcribe a meeting recording on this device with who said what, name each speaker once, and get the meeting notes on top.
- [Model credits](/ai/model-credits/) — Where Lumen credits the models it ships or downloads, ivrit.ai and Dicta first, with each licence's requirements.
- [Models day on a free cloud GPU](/ai/models-cloud/) — One command runs the real models day, held-out sets included, on a free Kaggle GPU and brings back the signed report. Tal's Mac is only the backup.
- [Hebrew niqqud on this device](/ai/nikud/) — Add or remove vowel points (niqqud) in Hebrew text with a model that runs in your browser.
- [On-device OCR (Hebrew, English, columns)](/ai/ocr/) — How Lumen reads text from images and scanned PDF pages on your device — Latin words inside Hebrew lines, multi-column pages, and the reading order of the result.
- [Organize the vault](/ai/organizer/) — Missing links, tags, duplicates to merge and maps of content for your whole vault — each one a change you approve, with its confidence, reason and a quote.
- [Personal data before the cloud](/ai/pii-redaction/) — When your AI policy lets a request leave this device, Lumen hides e-mails, phone numbers, ID numbers, cards, IBANs, plates and birth dates on the device first, and puts them back in the answer.
- [Read aloud (Hebrew included)](/ai/read-aloud/) — Listen to a note on this device — the word being read is highlighted, the position is kept, and you choose the speed and voice.
- [Search reranking — measured](/ai/reranker/) — What the search reranker adds on Lumen's retrieval golden set, the decision that follows, and how to measure the model yourself.
- [Screenshot to note](/ai/screenshot-note/) — Turn a screenshot into Markdown you can edit — tables, lists, code and error messages — with a vision model on your own computer.
- [Speculative decoding in Ollama](/ai/speculative-decoding/) — Ollama 0.34 speeds up some models by guessing several tokens at once. Lumen measures it per model, keeps it only where it helps, and turns it off for reproducible evals.
- [English spelling on this device](/ai/spelling/) — Spell-check English notes with a dictionary that ships with Lumen — no LanguageTool account, no request leaves the device.
- [Structured output and Chrome's built-in model](/ai/structured-output/) — How Lumen's local AI returns JSON that always matches what the feature asked for, on Ollama, the in-browser model or Chrome's built-in model — and when the built-in model is used with no download.
- [Local translation](/ai/translation/) — Translate a document on this device, in three layers — Chrome's built-in translator, Opus-MT for Hebrew ⇄ English, M2M100 for the rest — with code and links kept exactly.
- [Voice commands, on this device](/ai/voice-commands/) — Say "new note", "search…" or "add task…" in Hebrew or English. Lumen recognises the speech and the command locally, and asks before anything that deletes.
- [Hebrew Whisper on the desktop](/ai/whisper-desktop/) — Transcribe long Hebrew recordings on your computer with ivrit.ai's Whisper in whisper.cpp — one sentence per line, each time a link into the audio.

## Blocks

- [Math inside Hebrew text](/blocks/math-in-hebrew/) — Formulas in a right-to-left sentence keep their order in the editor, the preview, PDF and Word.
- [Sheet block](/blocks/sheet/) — A small spreadsheet inside a note, stored as CSV, with A1 formulas on the app's formula engine.

## Collaboration

- [Encrypted live sharing](/collab/e2ee-sharing/) — Share a note live through a server that stores and relays only ciphertext, names and cursors included.
- [End-to-end encryption for collab](/collab/encryption/) — Add a room password and no relay, signaling server or sync server can read your document.
- [Live canvas](/collab/live-canvas/) — Draw on one canvas together during a collab session — edits and pointers appear as they happen, over the same encrypted room as the note.
- [The public server](/collab/public-server/) — A free live-share server for everyone that stores only encrypted rooms, deletes idle rooms after 90 days and keeps no IP addresses in its logs.
- [Encrypted share link](/collab/share-link/) — Share a read-only copy of one note as a link that carries the note itself, encrypted. No server, no account.
- [Sharing, roles and comment threads](/collab/sharing/) — Share a note to view, comment or edit with a link that expires; revoke it; comment threads with mentions.
- [Suggestions and named versions](/collab/suggestions-versions/) — Suggest edits that change nothing until someone accepts them, accept or reject one person's suggestions at a time, see who wrote what (the AI included), and name versions to compare word by word.
- [Real-time WebRTC collaboration](/collab/webrtc/) — Multi-cursor editing over a peer-to-peer mesh — no server account, no central log of your doc.

## Contributing

- [Budgets that only go down](/contributing/budgets/) — The bundle budgets and the performance gate's FCP and LCP limits are lowered after every train to what the train measured plus 2 %, and never raised. Exceptions carry an expiry date and fail once it has passed.
- [Checks on every branch (Vercel)](/contributing/checks/) — Lumen's gates run in the Vercel build of every branch, without GitHub Actions — what runs, what a red status means, and where the old CI checks went.
- [Code checks: strings, coverage, vault backends](/contributing/code-checks/) — Three checks a contributor meets in the code itself — no user-visible string outside t(), test coverage over all of src/, and one contract suite every vault backend passes.
- [Design system](/contributing/design-system/) — Lumen's tokens for colour, space, radius, type, elevation and motion, the rules the code is held to, and the shared components.
- [The open Hebrew voice (recording kit)](/contributing/hebrew-voice/) — How to record, check and train the first neural Hebrew voice released as CC0, so read-aloud in Hebrew is open to every app.
- [Independent review](/contributing/independent-review/) — Every change to a sensitive path needs a review receipt for its head commit from a reviewer that did not write it, with attack tests, before it is merged — integration trains included.
- [Compiling the native code offline](/contributing/native-check/) — How Lumen's Rust, Java and Swift code is compiled without crates.io, the Android SDK or Xcode — what the check proves, what it cannot, and what still needs a Mac.
- [Nightly runs and receipts](/contributing/nightly/) — npm run nightly runs the flake hunt, the perf checks, the review triage and the weekly health on your own machine, and writes a signed report for each, without GitHub Actions.
- [The PR check](/contributing/pr-check/) — npm run pr:check is the local PR gate that replaces Danger.js and size-limit. It reports bundle size against the base, PR body sections, [skip ci] commits, unregistered network calls, licences and the domain rule.
- [Before main, WebKit and Safari](/contributing/promotion/) — npm run promote:check refuses to promote main to a commit without a signed WebKit receipt and a signed Safari receipt for that commit. WebKit runs on the verification factory, real Safari on BrowserStack's open-source plan.
- [Nightly redaction fuzz](/contributing/redaction-fuzz/) — Every night the second host feeds 20,000 generated notes to the preview and the export, and any passage the preview shades but the export keeps becomes a permanent test.
- [Second maintainer](/contributing/second-maintainer/) — Onboarding for Lumen's second maintainer — access, the local checks, how to review a sensitive change and add the human-reviewed label, security reports, and what only the owner holds today.
- [Skipped tests](/contributing/skipped-tests/) — Every skipped test says why, for which task and until when; npm run hygiene fails on one that does not, and npm run skips lists them all.
- [Every PR on the train head](/contributing/train-base/) — A pull request is based on the current train or on main, never on another PR's branch. pr:check fails a stacked base and a stack deeper than 1, warns about an older train and about drift, and fails an old merge base or a criss-cross. scripts/restack.mjs prints how to move a stacked PR onto the train.
- [The weekly train](/contributing/train/) — How Lumen's integration trains are built, checked and promoted, every week. npm run train:build merges the PRs and resolves what it can, npm run train:status shows the ledger and the gates, and main moves at least once a week.
- [Translation drafts](/contributing/translation-drafts/) — npm run i18n:draft drafts new UI strings in all seven languages with a local model; drafts stay "needs review" until a person approves them.
- [Languages in beta, and how to help](/contributing/translations/) — English and Hebrew are Lumen's full languages; the other six were translated by machine and are marked Beta (machine translation, awaiting native review). How to report a translation issue from inside the app.
- [Visual regression](/contributing/visual-regression/) — npm run test:visual compares ten surfaces in English and Hebrew, light and dark, with their pixel baselines — locally, no CI needed.
- [Translating on Weblate](/contributing/weblate/) — Review and fix Lumen's six machine-translated languages on Hosted Weblate, in the browser, with every change coming back to the repository as a pull request.

## Editor

- [Accessibility](/editor/accessibility/) — Keyboard use, screen readers, contrast and reduced motion in Lumen — and how each is checked.
- [Arabic (beta)](/editor/arabic/) — Write Arabic next to Hebrew and English in one note. Each line takes its own direction, tashkeel can be hidden or removed, search ignores it, and Arabic spelling runs on this device.
- [Direction marks (bidi)](/editor/direction-marks/) — See the invisible characters that set text direction, clean the ones that do nothing, fix reversed brackets, and catch Trojan Source text.
- [Handwriting and ink](/editor/handwriting/) — Write or draw with a pen, an Apple Pencil, a finger or a mouse inside a note. The ink is saved as SVG in the Markdown file, so the note still opens in Obsidian and other editors.
- [Hebrew dictionary and synonyms](/editor/hebrew-dictionary/) — Definitions, synonyms and the niqqud of a word, from Hebrew Wiktionary, offline inside the editor.
- [Hebrew grammar and style](/editor/hebrew-grammar/) — Hebrew grammar and style checks that run on this device, beyond spelling, with three writing levels and a short explanation for each suggestion.
- [Hebrew typography](/editor/hebrew-typography/) — Gershayim, geresh, maqaf, Hebrew quotation marks and numbers, fixed as you type or for a whole note. Each rule can be turned off.
- [Hebrew and right-to-left](/editor/hebrew/) — Writing in Hebrew (and Arabic) in Lumen — direction per line, the interface in Hebrew, search that ignores niqqud and prefixes, spelling on this device, and exports that keep the direction.
- [Images, attachments, copy and backlinks](/editor/images-attachments-backlinks/) — Resize an image by dragging, reset it with a double-click, delete a note's own attachments with it, copy as formatted text, and search the backlinks.
- [Legal citations (Israel)](/editor/legal-citations/) — Rulings, laws, bills, books and articles by the Israeli uniform citation rules, and a citation from a case number in the note.
- [Markdown fidelity](/editor/markdown-fidelity/) — How closely Lumen follows the CommonMark and GFM specs, and the promise that opening and saving a file in either editor gives you back the same bytes.
- [Messages, empty states and undo](/editor/messages/) — How Lumen talks when something fails, when a panel is empty, and before it deletes anything — and the guide for writing those messages.
- [Editor modes](/editor/modes/) — Source / Split / Preview / WYSIWYG — pick the one that fits the task.
- [Outline mode and block operations](/editor/outline-mode/) — Fold headings and lists, zoom into one block, and move, indent, duplicate or delete whole blocks — on a plain Markdown file, in both editors.
- [Pasting from Word, Google Docs and the web](/editor/paste/) — Paste from Word, Google Docs, Wikipedia, news sites or Gmail, in Hebrew or English, and get clean Markdown that keeps the structure and drops the styling.
- [Hebrew pasted from a PDF](/editor/pdf-paste/) — Hebrew copied out of a PDF often comes out backwards or with the wrong final letters. Lumen notices and offers the fix.
- [Reading aids](/editor/reading-aids/) — Niqqud for reading that never changes the note, a dyslexia-friendly layout, and read-aloud that highlights each word.
- [Reading views](/editor/reading-views/) — Source, preview and outline side by side with linked scrolling, and the keyboard between the columns.
- [Screen reader protocol](/editor/screen-reader-protocol/) — The fixed Hebrew journey run with NVDA, VoiceOver and TalkBack before a release, and its results.
- [Testing with screen reader users](/editor/screen-reader-testers/) — The kit for sessions with three Hebrew screen reader users — who to ask, the invitation, consent, the tasks, how a session is scored, and what happens to each barrier.
- [Smart Insert (⌘⇧V)](/editor/smart-insert/) — Paste anything into one dialog — Lumen detects the type and wraps it in the right block.
- [Themes and CSS snippets](/editor/themes/) — Five built-in themes, among them one for Hebrew reading, theme files on the documented tokens, and CSS snippets from the vault that can never reach the network.
- [Writing tools](/editor/tools/) — Theme settings, voice memos and dictation, the canvas, sync conflicts and the app's dialogs.
- [Touch and phones](/editor/touch/) — Using Lumen with a finger or a pen — dragging, touch targets, the notch and the outline sheet — and how each is tested.
- [Widgets, Shortcuts and Siri](/editor/widgets/) — A Lumen widget on the home screen, Siri and Spotlight on iPhone, App Shortcuts on Android, and "Add to inbox" from the Shortcuts app — plus the steps to build them.
- [Yiddish and Ladino](/editor/yiddish-ladino/) — Write Yiddish in YIVO spelling and Ladino in Latin or Hebrew letters — language tags, direction, spelling, and transliteration both ways, on this device.

## Getting started

- [Beta channel and feature flags](/getting-started/beta/) — Try new features before everyone else, on the web or in the desktop app, and turn any beta feature on or off on your own device.
- [The desktop app](/getting-started/desktop-app/) — Windows, tabs you drag between them, the tray with quick capture, opening .md files from Finder or Explorer, and lumen:// links.
- [Desktop app updates](/getting-started/desktop-updates/) — How the Lumen desktop app checks for, verifies and installs updates, and what it sends.
- [Send feedback](/getting-started/feedback/) — Report a bug, an idea or a question as a GitHub issue or as text to copy. Lumen has no feedback server, and nothing is sent until you click.
- [Moving from Bear](/getting-started/from-bear/) — Export Bear notes as Markdown and bring them, with their images, into Lumen.
- [Moving from Evernote](/getting-started/from-evernote/) — Get your notebooks out of Evernote and into Lumen as Markdown, with their images and attachments.
- [Moving from Google Docs](/getting-started/from-google-docs/) — Turn Google Docs into Markdown notes in Lumen — one document, or a whole Drive folder.
- [Moving from Notion](/getting-started/from-notion/) — Export a Notion workspace and bring its pages, links and attachments into Lumen.
- [Moving from Obsidian](/getting-started/from-obsidian/) — Bring an Obsidian vault into Lumen — notes, attachments, links and Bases — and what changes on the way.
- [Install with a package manager](/getting-started/install-packages/) — Install the Lumen desktop app with Homebrew, winget, Flatpak or the AUR, and where those packages come from.
- [Install Lumen](/getting-started/install/) — Lumen in the browser, as an installed web app, on the desktop (macOS, Windows, Linux) and on iOS / Android — and what each one stores where.
- [Leaving Evernote or Notion?](/getting-started/leaving/) — How to take your notes out of Evernote, Notion, Apple Notes, Google Keep, OneNote or Obsidian, and bring them into Lumen in one step, with one click to take it back.
- [Quickstart](/getting-started/quickstart/) — Get to your first beautiful Lumen document in 60 seconds.
- [Welcome to Lumen](/getting-started/welcome/) — Why we built Lumen, and what makes it different from Obsidian, Notion, Typora, Bear.

## Plugins

- [Developing a plugin](/plugins/develop/) — Scaffold a sandboxed plugin with create-lumen-plugin, run it with hot reload in developer mode, test it in Node with the test kit, and see what it does in the Developer panel.
- [Plugin registry and the built-in ten](/plugins/registry/) — The ten plugins in Lumen's plugin gallery, what each one may do, and how the static registry is built and scanned.
- [Plugin sandbox and permissions](/plugins/sandbox/) — How Lumen runs plugins with no access by default — QuickJS for logic, UI as data, a capability list the user grants.
- [Plugin signing keys](/plugins/signing/) — Decide which publishers' plugins Lumen trusts.
- [Templates](/plugins/templates/) — Start a note from a template — the built-in ones, the gallery, and the ones you install — and where an installed template lives.

## Project

- [The beta programme](/project/beta-programme/) — Join the beta from inside Lumen, send feedback as a prefilled GitHub issue, and — only if you ask — a weekly report of counts. Nothing leaves without your click.
- [Hebrew in notes, measured](/project/hebrew-benchmark/) — Lumen on public Hebrew benchmarks — bidi, dictation, niqqud, handwriting — next to Obsidian, Notion and Apple Notes where they were measured too.
- [Issue triage](/project/issue-triage/) — How new GitHub issues are labelled, checked for duplicates and linked to the plan within 24 hours.
- [Owner session command](/project/owner-session-command/) — One command per owner session. It prints exactly what to do in the browser, runs the commands for you after asking, verifies the result through the APIs, records a signed receipt per step and resumes where you stopped.
- [Owner sessions](/project/owner-sessions/) — Everything only the owner can do — accounts, GPU runs, golden data, devices — in three sittings ordered by dependency, with the time and the exact command for each, and free cloud devices instead of owning test phones.
- [Open PR triage](/project/pr-triage/) — One decision table for every open pull request — in main, in a train, superseded, dependabot, or still needed — and the commands that close each category with a comment.
- [Releasing a version](/project/releasing/) — One local command builds, signs and checks a release, and with --publish puts it on GitHub Releases with signed desktop updates. No GitHub Actions.
- [Usability tests with Hebrew speakers](/project/usability/) — How Lumen is tested with people who write in Hebrew — the ten tasks, SUS, the consent-first session recorder that keeps no note text, and the analysis.

## Security and privacy

- [Allowed image hosts](/security/image-hosts/) — See which sites may always load images in your notes, and revoke one or all of them.
- [Monitoring and web vitals](/security/monitoring/) — Error reports are off by default and sent only with your consent; web vitals never leave your device.
- [Mutation testing](/security/mutation-testing/) — How Lumen checks that the tests of its security-critical code, such as encryption, the keyring, sync merges and the privacy ledger, really catch bugs.
- [Photo metadata](/security/photo-metadata/) — Photos you paste or drop into a note lose their GPS position, time, device and text metadata before they are stored.
- [The e2e test surface](/security/test-surface/) — window.__lumen.agentReview exists only in development and tests.
- [Trusted repositories](/security/trusted-repos/) — Let agents propose changes in a git repository you own without the extra outside-content question.
- [Usage on this device](/security/usage-metrics/) — Lumen counts starts, commands and errors on your device only. The weekly report is off until you turn it on, and you send it yourself. Nothing leaves without your click.
- [Vault encryption at rest](/security/vault-encryption/) — Encrypt the whole vault where it is stored — OPFS, a real folder or the desktop folder — with a passphrase, a recovery key and auto-lock.
- [Secrets and encryption](/security/vault/) — How Lumen stores API keys and tokens, and how to encrypt a document.

## Self-hosting

- [CI on Buildkite, without GitHub Actions](/self-hosting/buildkite/) — Buildkite Free schedules lumen-md's gates on our own machines (the verification factory's host and a Mac) and posts a commit status for every gate on every PR, plus a signed receipt.
- [Moving production to another host](/self-hosting/cut-over/) — The runbook for moving Lumen's production from Vercel Hobby to Cloudflare Pages in under an hour, before the first payment. It covers the new address, the users' notes that stay with the old one, the redirect, the checks and the way back.
- [Self-hosting with Docker](/self-hosting/docker/) — Run Lumen on your own infrastructure with the docker-compose bundle.
- [Where Lumen runs](/self-hosting/hosting/) — What works on which host — Cloudflare Pages, Netlify, Vercel and the Docker image — and how each one is configured.
- [Android and iOS builds](/self-hosting/mobile/) — How the Android APK and iOS IPA are built on every pull request, what is unsigned until the store accounts exist, and which secrets sign them.
- [Native builds on free hosts](/self-hosting/native-builds/) — How the desktop app, the Android AAB and the iOS IPA are really compiled without GitHub Actions — a Linux script for the second host, Codemagic's free macOS minutes, and a robo run on Firebase Test Lab or BrowserStack.
- [Performance gate](/self-hosting/perf-gate/) — npm run perf:gate measures FCP, LCP, TBT, TTI and CLS of a production build in Chromium, on desktop and a throttled phone, and fails on the error thresholds, without GitHub Actions.
- [A second host and tests without Vercel](/self-hosting/second-host/) — Why Cloudflare Pages is Lumen's second host next to Vercel Hobby, what each free tier allows, how to deploy the same build there, what to do when a quota runs out, and how to run the whole test pipeline in Docker.
- [The verification factory](/self-hosting/verification-factory/) — A free second machine that runs every test of every verify/* head each night in Chromium, Firefox and WebKit, signs a receipt per commit and posts the result to GitHub as commit statuses, without GitHub Actions.

## Sync and publishing

- [Private classroom](/sync/classroom/) — A teacher hands out a template, students hand in sealed work, and the teacher's comments come back. Only the teacher reads a student's work, and the server reads nothing.
- [Sync providers](/sync/cloud/) — Where the encrypted vault can live — WebDAV, S3-compatible storage, Dropbox, Google Drive — how to connect each, what each server must support, and how notes from the old plain-text sync are moved into the vault.
- [Keys, rotation and revocation](/sync/e2ee-keys/) — Argon2id, age interop, key rotation without re-uploading, removing a lost device, and the public protocol spec.
- [Encrypted sync (E2EE)](/sync/e2ee/) — The end-to-end encrypted sync protocol — what is encrypted, what the sync service sees, rollback protection and its trust-on-first-use limit.
- [Git sync](/sync/git/) — Clone, pull and push a git repository from Lumen — safely. A pull merges, never deletes, and never overwrites a note you are editing.
- [Sync on the local network](/sync/lan/) — Sync two devices directly over your own network, end-to-end encrypted, with no cloud and no internet.
- [Automatic merging](/sync/merge/) — When the same note changed in two places, Lumen merges the two edits itself and asks only when both changed the same words — the same way for encrypted sync, git and edits made outside Lumen.
- [Publish to your own site](/sync/own-site/) — Turn the notes you pick into a website with navigation, search and right-to-left pages, on your own GitHub Pages or as a .zip for any static host.
- [Read-mode publishing](/sync/publish/) — Publishing a note as a read-only web page — what exists today, the server it needs, and what is not built yet.
- [Real servers and conditional writes](/sync/real-servers/) — Which WebDAV and S3 servers keep compare-and-swap, measured against the real servers, and how to run the same check against yours.
- [The share servers on Cloudflare](/sync/relay-server/) — Deploy the live-share server and the encrypted sync relay to Cloudflare Workers with one command, then check the delay, the limits and that no note text is kept.
- [Family and classroom vaults (roles)](/sync/role-vaults/) — One encrypted vault shared by a family or a class, with reader, writer and admin roles, and no accounts. The relay accepts a change only with a writer's signature.
- [Publish to Bluesky and the fediverse](/sync/standard-site/) — Publish a note as a Standard.site document in your own AT Protocol account, so Bluesky shows it with a rich preview, readers like Leaflet show it in full, and Bridgy Fed can bring it to Mastodon.

## Workspace

- [Israeli academic calendar](/workspace/academic-calendar/) — Semesters, Moed A and Moed B, breaks and make-up days of your institution in the daily note, and the year as an ICS file.
- [Backups to a second drive](/workspace/backups/) — A daily backup of the whole vault to another drive or folder, plain or encrypted with age, kept 7 days, 4 weeks and 6 months, and a restore you can check.
- [Ben-Yehuda library (offline)](/workspace/ben-yehuda-library/) — Download the public-domain works of Project Ben-Yehuda once, then search, read, quote and highlight Hebrew literature with no network.
- [Writing a book](/workspace/book/) — Chapters as notes in order, word goals per chapter and per book, today's words and a streak, and the book assembled into a Hebrew EPUB 3 and a print-ready PDF.
- [Calendar sync (CalDAV and ICS)](/workspace/caldav/) — Keep the vault's dated tasks in sync with a CalDAV calendar (Fastmail, Nextcloud, iCloud), and see subscribed calendars' events in the daily note.
- [Note cards and image export](/workspace/canvas-cards/) — Put vault notes on the canvas as live cards, edit them in place, and export the canvas as PNG, SVG or PDF with Hebrew intact.
- [Diagrams on the canvas (Mermaid and "draw me")](/workspace/canvas-diagrams/) — Turn Mermaid into shapes you can edit on the canvas, or describe a diagram and let a model on this device draw it.
- [Canvas (Excalidraw)](/workspace/canvas/) — The whiteboard — on Excalidraw, saved as open .excalidraw files in your vault, fully on your device — and what happens to your old tldraw canvases.
- [WhatsApp and Telegram chats into notes](/workspace/chat-import/) — Import an exported WhatsApp or Telegram chat into notes, one per day or one per chat, with its media, entirely on this device.
- [Contacts (vCard)](/workspace/contacts/) — Import a .vcf from your phone or Google into person notes, merge it with people already in the vault, and export people back as vCard 4.0.
- [Database views](/workspace/database-views/) — Editable Table / Cards / Kanban / List / Calendar views over your YAML frontmatter.
- [Vault Doctor](/workspace/doctor/) — Find broken links, orphans and near-duplicate notes across the workspace, without AI.
- [Embedded queries and saved searches](/workspace/embedded-queries/) — A ```query block lists the notes that match a search, a ```dataview block runs common Obsidian Dataview queries, and saved searches sit in the sidebar. All of them update as the vault changes.
- [Entity graph](/workspace/entity-graph/) — People, places, organisations, events, laws, sources and concepts found in your notes, each relation backed by an exact quote from a paragraph, reviewed by you before anything is written.
- [EPUB reader and reading mode](/workspace/epub-reader/) — Read EPUB books in the vault (Hebrew right-to-left included), highlight them like PDFs, and read clipped pages in a calm reading mode.
- [Export and import](/workspace/export-import/) — Take the whole vault out as a .zip or a folder, bring in an Obsidian vault or a Notion export, and convert single files to and from many formats.
- [Notebooks, data files and maps](/workspace/file-viewers/) — Jupyter notebooks, CSV/TSV/JSON/YAML/XLSX files and GeoJSON/GPX tracks open in a viewer of their own, without converting them.
- [Text formats: what survives a round trip](/workspace/format-roundtrip/) — Measured results for Markdown → Org, AsciiDoc, LaTeX, OPML, RST and Jupyter → Markdown on the 652 CommonMark spec examples and 50 Hebrew notes.
- [Government data (data.gov.il, CBS)](/workspace/government-data/) — Put a table or a chart of open government data in a note. The rows are kept as a CSV in your vault, the attribution is written for you, and a refresh shows what changed.
- [Graph and local graph](/workspace/graph/) — The knowledge graph of the whole vault — 10,000 notes and 50,000 links — and the local graph of the open note, with filters, colour groups and full keyboard use.
- [Daily notes and the Hebrew calendar](/workspace/hebrew-calendar/) — The calendar's holidays, fasts and weekly Torah portion, for Israel or the diaspora, and the {{holiday}} and {{parasha}} placeholders of the daily note.
- [Import highlights (Kindle, Kobo, Readwise, Zotero)](/workspace/highlight-import/) — Bring your highlights from Kindle, Kobo, Readwise and Zotero into the vault, one note per book, with no duplicates when you import again.
- [Import from other apps](/workspace/import/) — Bring notes from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq or OneNote — into a new folder, with a report, undone in one click.
- [JSON Canvas (Obsidian .canvas)](/workspace/json-canvas/) — Open Obsidian canvases in Lumen's Excalidraw canvas and write them back as .canvas files. JSON Canvas is an open, MIT-licensed format.
- [Laws and Knesset records](/workspace/knesset-sources/) — Cite a law by its name, a bill and a committee protocol from the Knesset's open data, keep laws for offline use, and ask the laws you saved.
- [Large vaults and long notes](/workspace/large-vaults/) — How Lumen stays fast with 10,000 notes and with a single 2 MB note — and how that is measured.
- [Academic LaTeX export (Hebrew)](/workspace/latex-export/) — Export a note as a LaTeX project — Hebrew right to left with babel, math, Pandoc-style [@key] citations from the vault's BibTeX, and images — that compiles with LuaLaTeX or XeLaTeX.
- [Links, embeds and block references](/workspace/links/) — Link notes with [[ and its completion, preview a link by hovering, turn plain mentions into links, embed a note or one of its sections, and link to a single paragraph with ^id.
- [Audio and video with a transcript](/workspace/media-transcripts/) — Embed a recording, read its WebVTT or SRT transcript beside the player, and click a line to jump there.
- [The vault in a folder on your phone](/workspace/mobile-vault-folder/) — In the iOS and Android apps, keep the vault in a real folder — the Files app on iOS, a folder you pick on Android — and see edits made there.
- [Obsidian Bases (.base files)](/workspace/obsidian-bases/) — Open, embed and edit Obsidian Bases files — what is supported, what is not, and how the golden set is checked.
- [Side panels](/workspace/panels/) — The file tree, outline, backlinks, tags, comments, trash and version history — what each side panel shows and how to use it.
- [Note properties](/workspace/properties/) — The note's front matter as typed fields — text, number, date, list, checkbox and link — where an edit changes only that value.
- [Quick capture (inbox)](/workspace/quick-capture/) — Add a thought, task or link to inbox.md in two steps, from the keyboard, the home screen or the share sheet.
- [Reading list](/workspace/reading-list/) — Sources (books, articles, sites) with a reading status, progress that the PDF and EPUB readers keep up to date, and a kanban by status.
- [Related notes while writing](/workspace/related/) — The notes closest to the paragraph you are writing, and the notes it mentions without a link — on this device, without slowing typing.
- [Daily review (spaced repetition)](/workspace/review/) — Review your highlights and question::answer cards a few minutes a day, scheduled by FSRS, with everything kept in the vault.
- [Search operators and #tags](/workspace/search-operators/) — Narrow a search with tag:, path:, "phrases", /regex/ and -exclusions; tags written in the text count like front-matter tags.
- [Workspace search (BM25 + Smart)](/workspace/search/) — Fast keyword search by default, semantic embeddings on demand.
- [Slides from notes and the canvas](/workspace/slides/) — Present a note or a canvas as slides, right to left when it's Hebrew, with speaker notes, a presenter view on a second screen, and PDF export.
- [Tasks across the vault](/workspace/tasks/) — Checklist items with dates and priorities in any note, gathered by queries, a Today panel and reminders. Same syntax as the Obsidian Tasks plugin.
- [Typst export (Hebrew)](/workspace/typst-export/) — Export a note as Typst source that typesets Hebrew right to left, and compile it to PDF with typst.
- [Very large vaults](/workspace/vault-100k/) — How Lumen stays fast with 100,000 notes. The search index holds one copy of the text, is kept between sessions, and is updated one note at a time, and big embedding indexes are stored compactly.
- [Your vault in a folder](/workspace/vault-folder/) — Keep your notes in a real folder on your computer, in the browser or the desktop app, move them there and back without losing a byte, and see changes other programs make.
- [Voice notes into the inbox](/workspace/voice-capture/) — Record a voice note from the capture box; it is transcribed on this device and added to inbox.md, with the recording attached if you want.
