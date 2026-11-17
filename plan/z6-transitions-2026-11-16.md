# Z6: per-id transitions, audit 14.11 (audit/merged.json) → r2 16.11 (audit/r2-all.json)

Lane B2c (W10.Z6): the verdict of every P0 and P1 id in the 14.11 audit against the r2 re-audit of 16.11, both outside the repo (the audit lanes' merged.json and r2-all.json). Of the 112 "DONE → PARTIAL", 85 name a run that has not happened (e2e, a real model or device, the Mac, a receipt, the owner); the other 27 name something else (for example 4.11: a test red in the shim), so read their row. Only the ids whose verdict changed are listed.

P0/P1 ids in both: 281 ({'P0': 88, 'P1': 193}). P0/P1 ids in r2 not in merged.json: 324.

| from → to | ids |
|---|---|
| PARTIAL → PARTIAL | 130 |
| DONE → PARTIAL | 112 |
| DONE → DONE | 27 |
| NOT DONE → NOT DONE | 7 |
| NOT DONE → PARTIAL | 2 |
| PARTIAL → DONE | 1 |
| FAKED → PARTIAL | 1 |
| PARTIAL → NOT DONE | 1 |

| id | priority | 14.11 | 16.11 | r2 missing |
|---|---|---|---|---|
| 0.13 | P0 | DONE | PARTIAL | 'A new agent does the next step from the doc alone' is untested. |
| 0.14 | P0 | DONE | PARTIAL | Acceptance (20 PRs, 0 CI failures ci:local would catch) never measured; W4.36 counter has no data. |
| 0.2 | P0 | DONE | PARTIAL | 'startup chunks did not grow' has no before/after receipt for this task (startup is now 225,877 B gz, far below the pre-split number). |
| 0.20 | P1 | DONE | PARTIAL | e2e playground in WebKit not run here; 'worker with an endpoint not blocked on Vercel' and webR-in-preview never verified on a deployment. |
| 0.4 | P0 | DONE | PARTIAL | `npm run lint` is NOT in vercel-build PREVIEW_GATES; the CI job exists only in .buildkite/pipeline.yml with no run receipt (Actions archived |
| 1.3 | P0 | DONE | PARTIAL | 'Offline dictation after downloading Whisper' only against a mocked Whisper; real model run owed (plan itself says W10.G8). |
| 1.4 | P0 | DONE | PARTIAL | Regression: pass AbortSignal in the 9 new call sites; e2e ai-cancel not run. The ✅ is stale. |
| 1.9 | P0 | DONE | PARTIAL | 'Network measurement documented' rests on e2e/canvas-excalidraw.spec.ts which has not run (Excalidraw package not installed in the offline o |
| 10.2 | P0 | DONE | PARTIAL | Full journey on the two devices (e2e) not run. |
| 11.5 | P1 | DONE | PARTIAL | No signed build, no auto-update ever exercised (owner 15.7); package version still 0.1.0. |
| 12.4 | P1 | DONE | PARTIAL | web-vitals package not used (own implementation); Sentry/GlitchTip choice (15.6) owner; e2e not run. |
| 13.2 | P1 | DONE | PARTIAL | Playground e2e on Netlify not run; Docker image size claim not measured here. |
| 13.4 | P1 | DONE | PARTIAL | 'Tag -> release without a manual step' never exercised; no GitHub release exists; version 0.1.0. |
| 14.1 | P1 | DONE | PARTIAL | 'New user to first note <60 s' is an e2e (e2e/first-run.spec.ts) not run here. |
| 14.3 | P1 | DONE | PARTIAL | 'New issue triaged within 24 h' requires a scheduled run — none exists (issue-triage.yml archived). |
| 2.3 | P0 | DONE | PARTIAL | Acceptance 'security.spec green in 3 browsers' has no run on the current train (no e2e receipts in reports/); ✅ rests on a unit proxy. |
| 2.4 | P0 | DONE | PARTIAL | Full local-only journey e2e (0 non-local requests) not run in a browser. Acceptance 'full journey 0 non-local requests' is an e2e — not run. |
| 2.5 | P0 | DONE | PARTIAL | 'keychain tests green on macOS and Windows' — keychain.yml is archived (docs/archive/workflows); no current run. Storage scan after login no |
| 3.2 | P0 | DONE | PARTIAL | historyComplete (the real acceptance test) cannot run offline (fake-indexeddb not installed: 0/16 load as stubs), so ≤10% over 1,000 version |
| 3.3 | P0 | DONE | PARTIAL | gitPull could not run here; e2e data-safety 'git pull' (part D) not run. |
| 3.5 | P1 | DONE | PARTIAL | '2 browsers via mock WebDAV: 0 loss' e2e (e2e/sync-providers.spec.ts) not run; webdav/aws4fetch libs replaced by own code. |
| 3.6 | P0 | DONE | PARTIAL | e2e two browsers / leave-and-return not run; signaling health check after deploy not running (no CI); Z7 M4 (backup purge wiping all rooms)  |
| 4.10 | P1 | DONE | PARTIAL | Acceptance '100 notes in kanban: 0 unwanted file changes' is an e2e (e2e/database-edit.spec.ts) not run; react-big-calendar not used (own ca |
| 4.11 | P1 | DONE | PARTIAL | databaseFormulaView fails in the shim (9 pass / 10 fail: role=link not found) — also red in the train-7 lane runs; jsep/formula.js not used; |
| 4.12 | P0 | DONE | PARTIAL | e2e daily-notes not run in a browser. Acceptance 'e2e: today's note created and opened' not run. |
| 4.13 | P1 | DONE | PARTIAL | e2e/vault-tasks.spec.ts (part of the dod) not run; 1,000-task <100 ms only in unit timing. |
| 4.19 | P0 | DONE | PARTIAL | 0 network requests from the canvas (ledger) is an e2e not run; excalidraw is absent from the offline node_modules overlay, so excalidrawFile |
| 4.3 | P0 | DONE | PARTIAL | cargo test never run in this audit (vault-rust.yml archived); 'edit in Lumen visible in Obsidian' (15.8) owed; plan ✅ overstates. |
| 4.5 | P0 | DONE | PARTIAL | e2e he/en (e2e/wiki-autocomplete.spec.ts) not run in a browser. Acceptance explicitly requires e2e in he/en — not run. |
| 4.7 | P0 | DONE | PARTIAL | Quartz ofm.ts port not present (own implementation); e2e/embeds.spec.ts not run. |
| 4.8 | P1 | DONE | PARTIAL | Acceptance is an e2e (e2e/block-refs.spec.ts: survives rename+move) that has not run here. |
| 5.1 | P1 | DONE | PARTIAL | search_web/fetch_page only vs mocked network. |
| 5.11 | P1 | DONE | PARTIAL | Acceptance 'agent change not written without approval' is an e2e (e2e/agent-review.spec.ts) not run. |
| 5.2 | P1 | DONE | PARTIAL | bm25Golden '10,000 notes < 100 ms' FAILED in my run (160.96 ms; slow 2-CPU box, but not shown green); nDCG on Tal's queries (7.1 owner part) |
| 5.4 | P1 | DONE | PARTIAL | '≥90% claims with verified citation' needs a real model (15.3) — not run. |
| 5.5 | P0 | DONE | PARTIAL | Acceptance '0 bypassing calls' is false on HEAD; route the 3 callers through the runtime (and pass signals, see 1.4); quality with a real mo |
| 5.6 | P1 | DONE | PARTIAL | Live Ollama check never run; each suggestion type 'performs an action' verified only against mocks. |
| 5.8 | P1 | DONE | PARTIAL | aiBatchCommands FAILS 'reports a job state it couldn't save and writes nothing' (it writes a.md) — red in train-7 lane runs too; dod e2e bat |
| 6.0 | P1 | DONE | PARTIAL | No conversion ever ran: models/registry.json has 0 entries with sha256 and 0 'measured'; '4 converted models load in transformers.js in CI'  |
| 6.10 | P0 | DONE | PARTIAL | recall ≥90% gated only on the in-repo set; nspell in browser worker not exercised. |
| 6.17 | P0 | DONE | PARTIAL | dod e2e local-only-all-commands not run; Z7 M3 showed a consent path (Wikidata) that bypassed local-only until #941 — the audit of 'all rout |
| 6.4 | P1 | DONE | PARTIAL | chrF on NTREX per layer not measured (needs the 6.0 converted models). |
| 6.5 | P0 | DONE | PARTIAL | Tatoeba ≥95% (8 languages) not measured (plan says after 15.9). |
| 6.6 | P1 | DONE | PARTIAL | Real models never run; 50-image owner rating (15.15) not done. |
| 6.8 | P1 | DONE | PARTIAL | ≥85% correct with real model (15.17) not run; e2e/pdf-chat.spec.ts not run. |
| 6.9 | P1 | DONE | PARTIAL | p50 <300 ms on Ollama not measured (15.17); e2e/fim.spec.ts not run. |
| 7.1 | P0 | DONE | PARTIAL | The held-out test split is built only by golden-sets.yml (archived) with GOLDEN_SEED — never built; owner part (15.11) open; ✅ overstates. |
| 7.10 | P1 | DONE | PARTIAL | Plan ✅ text itself says 11/12 (meetings from owner 15.11); meeting recordings are owner-made. |
| 7.3 | P0 | DONE | PARTIAL | Report against a live model never produced (eval/results/ does not exist). |
| 7.4 | P1 | DONE | PARTIAL | 'At Tal: all green' and empty-machine e2e not run. |
| 7.5 | P1 | DONE | PARTIAL | 'Runs on every PR' false (no running CI); CER ≤5%/≤12% not measured on the train. |
| 7.7 | P1 | DONE | PARTIAL | 'Since last visit' deferred to a product decision (15.16). |
| 8.4 | P1 | DONE | PARTIAL | dod e2e/perf-vault.spec.ts (10k notes, 2 MB doc) not run; 16 ms/frame typing is nightly-only and never ran. |
| 9.2 | P1 | DONE | PARTIAL | Only dev set measured (recall 75%, FP 2.5-3.9%); held-out test is with the owner (15.11). |
| 9.3 | P1 | DONE | PARTIAL | stylelint-use-logical not used; hygiene could not run in my overlay (postcss missing) — not independently confirmed green. |
| 9.7 | P1 | DONE | PARTIAL | Acceptance '30/30 in 3 browsers' is an e2e not run. |
| 9.8 | P0 | DONE | PARTIAL | 'Opens correctly aligned in real Word' (owner 15.12) not done. |
| W1.12 | P1 | DONE | PARTIAL | 10,000 rows ≥55 fps not measured in a browser; calendar drag round-trip e2e not run; react-big-calendar not used. |
| W1.19 | P1 | DONE | PARTIAL | Server-side tests exist but two-browser and RTL cursor checks not run; Z7 L6 found the delete path over-trusts the token on the Node server. |
| W1.2 | P1 | DONE | PARTIAL | Corpus is repo .md + spec sections, not 200 real Markdown files; Milkdown ≥196/200 round-trip not shown; 'gate runs in Vercel Sandbox on eve |
| W1.20 | P1 | DONE | PARTIAL | Install-screen e2e on the 3 sample plugins not run; Z7 M1 showed the CSS scan missed var() remote loads until #939; public/plugins/registry. |
| W1.21 | P1 | DONE | PARTIAL | axe AA contrast on 5 themes he/en and <100 ms switch measured only in unit/lane runs, not e2e. |
| W1.23 | P1 | DONE | PARTIAL | Journey with NVDA/VoiceOver/TalkBack never done; 400% reflow e2e not run. |
| W1.31 | P1 | DONE | PARTIAL | grep of a real production build not done here (no build offline). Acceptance is a grep of the production build; I could not build offline. |
| W1.34 | P1 | DONE | PARTIAL | Real download/install in a browser never exercised. |
| W1.8 | P1 | DONE | PARTIAL | 10,000 notes + 1 GB benchmark <10 min not run; mobile background sync not implemented/verified; conflict-in-panel e2e not run. |
| W1.9 | P1 | DONE | PARTIAL | Static 'same engine for 3 paths' check not confirmed by a test I ran; property test numbers (459/500) taken from status. |
| W2.12 | P1 | DONE | PARTIAL | 20 Dataview blocks are from fixtures, not real vaults; <100 ms update only unit-timed. |
| W2.13 | P1 | DONE | PARTIAL | RTL/LTR e2e for 10 actions in both editors not run. |
| W2.14 | P1 | DONE | PARTIAL | ≥85% correct fields on 20 golden pages and <10 s on a 3B model need a real model. |
| W2.3 | P1 | DONE | PARTIAL | <300 ms stdio search on 10,000 notes not measured; connection guides untested against Claude Desktop/Code. |
| W2.8 | P1 | DONE | PARTIAL | '100% of shortcuts work in Hebrew layout' is an e2e (hebrew-layout.spec) not run. |
| W2.9 | P1 | DONE | PARTIAL | Ctrl+Z restores original char only shown in unit test; e2e (9/9 per status) not run here. |
| W3.1 | P1 | DONE | PARTIAL | I could not re-run design-audit offline; 'documented component library' thin. |
| W4.13 | P1 | DONE | PARTIAL | WER ≤9.5% eval-whatsapp / ≤6.0% eval-d1 never measured; p95 ≤2 s on WebGPU not measured. |
| W4.15 | P1 | DONE | PARTIAL | Acceptance e2e (embeds and images still work) not run. |
| W4.25 | P1 | DONE | PARTIAL | 0 participants; SUS ≥75 and ≥12 participants unmet. |
| W4.31 | P1 | DONE | PARTIAL | ≥95% valid calls on qwen2.5:7b and gemma3:12b and BFCL v4 vs real models never run — only the mock. |
| W4.36 | P1 | DONE | PARTIAL | 0 nights run: no reports/nightly/; 0.5/0.11/0.14 measurements absent. |
| W4.4 | P0 | DONE | PARTIAL | secretsScanLive FAILS on HEAD: VITE_CONTENT_FRAME_URL is read by the app but missing from security/vite-env-allowlist.json; live scan report |
| W4.6 | P0 | DONE | PARTIAL | Never run by the owner: no single report with real scores; eval/results/ absent. |
| W4.8 | P1 | DONE | PARTIAL | Not deployed: two browsers on two networks, p95 <300 ms from Israel, $0/month all unproven. |
| W5.10 | P1 | DONE | PARTIAL | 20 KB note opening in Safari/Chrome/Firefox not run. |
| W5.12 | P1 | DONE | PARTIAL | 20 golden papers with a real model (≥85% fields) not done. |
| W5.14 | P1 | DONE | PARTIAL | PDF and 3-browser verification not run. |
| W5.28 | P1 | DONE | PARTIAL | nDCG@10 ≥0.8 held-out with the real model never measured (only BM25 0.175) |
| W5.4 | P1 | DONE | PARTIAL | 'Cleaning keeps visual order on 9.7's 30 lines' checked in Chromium per status, not re-run by me. |
| W5.6 | P1 | DONE | PARTIAL | Test with 3 dyslexic readers (W4.25) not done; no licensed Hebrew neural voice (W2.6). |
| W5.8 | P1 | DONE | PARTIAL | Apple Books / Kindle Previewer RTL check not done; epubcheck run cited from status only. |
| W6.13 | P1 | DONE | PARTIAL | no second maintainer, no human reviewer, label missing |
| W6.17 | P0 | DONE | PARTIAL | no sealed set exists (recipient null); quality claims still dev-only |
| W6.18 | P0 | DONE | PARTIAL | no real model run, no signed report, 0 tasks moved from dodMock |
| W6.19 | P1 | DONE | PARTIAL | held-out WER never measured; phone WER 23.6% vs 15% |
| W6.20 | P1 | DONE | PARTIAL | session time ≤90 min unmeasured |
| W6.21 | P0 | DONE | PARTIAL | close commands not run; >40 PRs still open (open.json lists 781) |
| W6.25 | P0 | PARTIAL | DONE | — |
| W6.26 | P1 | DONE | PARTIAL | ratchet on a real train receipt never run; FCP unmeasured |
| W6.27 | P1 | DONE | PARTIAL | no real WebDAV/S3/Drive table with receipts |
| W6.28 | P1 | DONE | PARTIAL | Hebrew-speaker review |
| W6.30 | P1 | DONE | PARTIAL | VoiceOver/NVDA journeys and 3 users |
| W6.31 | P1 | DONE | PARTIAL | 12 tests, 50 testers, SUS |
| W6.33 | P1 | DONE | PARTIAL | 24/24 sha256 pins, deployed mirror, e2e with HF blocked |
| W6.38 | P1 | FAKED | PARTIAL | ≥30 REAL files per format for 8 formats — only Evernote is third-party |
| W6.44 | P1 | PARTIAL | NOT DONE | area board computed from receipts |
| W6.45 | P1 | DONE | PARTIAL | Playwright against the real app, BrowserStack, first baseline |
| W6.5 | P0 | DONE | PARTIAL | never ran on a real host; 7 nights, <60 min 3-browser e2e unmet by design (90–110 min) |
| W6.6 | P0 | DONE | PARTIAL | nothing enforces it (main took #432 with no receipt); no BrowserStack run |
| W6.9 | P1 | DONE | PARTIAL | same commit on both hosts with headers 10/10 never deployed (owner) |
| W7.1 | P1 | DONE | PARTIAL | eval of 6 skills on a local model never run; Claude Code 10/10 .base check absent |
| W7.15 | P1 | DONE | PARTIAL | Mac measurement with Ollama ≥0.34 |
| W7.17 | P1 | DONE | PARTIAL | manual Claude Code/Desktop check |
| W7.21 | P1 | DONE | PARTIAL | no Buildkite account/agents: 0 PRs have a status |
| W8.11 | P1 | DONE | PARTIAL | works only after --install per clone |
| W8.3 | P1 | DONE | PARTIAL | R2/B2 200/200 probe (owner) |
| W8.5 | P1 | DONE | PARTIAL | 5-user usability test |
| W9.4 | P0 | NOT DONE | PARTIAL | 100% receipts on the merged train head: STATE lists receipts + human-reviewed labels still owed for #932/#936/#937/#939–#943 |
| W9.9 | P0 | NOT DONE | PARTIAL | mutation red (18); 104 cited PR heads not ancestors (e.g. #645, #718, #719, #720, #723, #728, #746, #751, #758, #763, #766, #772, #805, #806 |
