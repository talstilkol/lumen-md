# W9.8 ledger: the needs-code decisions of #618 (W10.E70–E74)

Every row of `plan/decisions-2026-11-14.md` with needs-code = y (48), against verify/train-7 at 063d3d2c82.
The commit is the one whose message names the step (`(2.12)`, `2.18:`) or the Codex comment id. It was found by `git log 063d3d2c82 --grep`. The tests are the test files that commit changed.
Rows that no commit message names say so. The commit for 2.17 is a merge.
The groups of W10.E70–E74:

- #372 (W10.E70) is 2.41.
- #469 (W10.E71) is 2.46.
- #316 (W10.E72) is 2.92.
- #483 (W10.E73) is 5.16.
- #602 (W10.E74) is 2.78.

I checked those five by hand in the tree.

**48 rows:**

- 22 have a commit.
- 15 are dependency rows that wait on a deps train. That train needs a real `npm install` / `cargo update`.
- 5 have no commit that names them, and need a manual check: 2.6 and 2.28–2.31.
- 6 others: 2.41 done, 2.46 open, 2.92 and 5.16 partly done, 2.78 is owner-act, 2.73 done.

| step | PR | finding | commit | tests in that commit | status |
|---|---|---|---|---|---|
| 2.9 | #235 | No write freeze between the move's final check and the switch; an auto | 2483bdca05 | historyVaultIdentity.test.ts, vaultLocation.test.ts | commit found by its message |
| 2.12 | #267 | Coordinate object: the first present alias wins, so {lat: "", latitude | d40c48b9f9 | databaseFormulaView.test.tsx | commit found by its message |
| 2.17 | #272 | Imported PDFs are decoded as text into the BM25/workspace and embeddin | 75d561f39b | — (no test file in the commit) | commit found by its message |
| 2.18 | #272 | The reader awaits getPage for every page before showing page 1 (433030 | f92ffe5f67 | pdfReviewFixes272.test.ts | commit found by its message |
| 2.19 | #272 | Renaming paper.pdf to paper.pdf.md moves the PDF onto its own companio | fa8cd877e5 | pdfReaderModal.test.tsx, pdfReviewFixes272.test.ts | commit found by its message |
| 2.20 | #272 | Leading whitespace in a generated wiki path is trimmed, so the link mi | fa8cd877e5 | pdfReaderModal.test.tsx, pdfReviewFixes272.test.ts | commit found by its message |
| 2.21 | #272 | The modal PDF reader does not trap focus; Tab reaches the hidden edito | f92ffe5f67 | pdfReviewFixes272.test.ts | commit found by its message |
| 2.22 | #272 | The annotation start marker is found anywhere, so a marker in the user | fa8cd877e5 | pdfReaderModal.test.tsx, pdfReviewFixes272.test.ts | commit found by its message |
| 2.23 | #272 | At <= 720px the sidebar (the only highlight list / note / delete UI) i | f92ffe5f67 | pdfReviewFixes272.test.ts | commit found by its message |
| 2.24 | #272 | With both draft#2.pdf and a literal draft%232.pdf, the generated link  | fa8cd877e5 | pdfReaderModal.test.tsx, pdfReviewFixes272.test.ts | commit found by its message |
| 2.25 | #272 | Close/switch waits only on the write queue captured at that moment; la | f92ffe5f67 | pdfReviewFixes272.test.ts | commit found by its message |
| 2.26 | #272 | The annotation validator accepts body: {} or a missing created, which  | fa8cd877e5 | pdfReaderModal.test.tsx, pdfReviewFixes272.test.ts | commit found by its message |
| 2.28 | #275 | P1: no conditional write in VaultBackend, so the local hash check and  | — | — | no commit names this step or its comment id; needs a manual check |
| 2.29 | #275 | Descendants of a held tree clash are encrypted and uploaded before the | — | — | no commit names this step or its comment id; needs a manual check |
| 2.30 | #275 | Resuming an interrupted create maps a transient provider failure in un | — | — | no commit names this step or its comment id; needs a manual check |
| 2.31 | #275 | FreshnessBanner reads freshness once; it can keep showing 'verified' a | — | — | no commit names this step or its comment id; needs a manual check |
| 2.38 | #277 | A saved Ollama address that the CSP blocks: getBaseUrl() falls back to | eae63aba62 | aiSettingsPanel.test.tsx, ollamaProvider.test.ts | commit found by its message |
| 2.79 | #235 | A vault move drops empty folders, and the preflight misses a file bloc | 2483bdca05 | historyVaultIdentity.test.ts, vaultLocation.test.ts | commit found by its message |
| 2.80 | #235 | Version history is keyed by relative path only; another vault with the | 2483bdca05 | historyVaultIdentity.test.ts, vaultLocation.test.ts | commit found by its message |
| 2.83 | #258 | Folder watcher: any list() failure counts as 'folder gone'; a root fai | aeb77482d4 | externalChanges.test.ts, vaultWatcher.test.ts | commit found by its message |
| 2.84 | #258 | Autosave dropped while the conflict dialog is open is not rescheduled  | aeb77482d4 | externalChanges.test.ts, vaultWatcher.test.ts | commit found by its message |
| 2.85 | #261 | Codex P2s on #261 (tracked in 15.16 item 12): setup treats a slow 'res | ba8c89c301 | onboarding.test.tsx | commit found by its message |
| 2.6 | #223 | Proposals for documents outside the workspace have no path and apply t | — | — | no commit names this step (the message match was unrelated); needs a manual check |
| 2.39 | #306 | Does /regex/ search need a time or size budget per note? | 73388182b8 | vaultSnapshotRound9.test.ts | commit found by its message |
| 2.41 | #372 | Placement of the allowed-image-hosts screen under Settings > Privacy w | af41127210 | src/__tests__/imageHosts.test.tsx | done: Settings → Privacy shows the allowed image hosts (src/ui/SettingsScreen.tsx `case "privacy"`), the palette entry stays |
| 2.46 | #469 | PRIVACY.he.md (#456) DPIA: the three actions are now in code; update t | — | — | open: PRIVACY.he.md does not state the 90-day retention / no IP logs / encrypted rooms only of the DPIA (grep on 063d3d2c82) |
| 2.47 | #499 | The 26 dependabot PRs target frozen main; apply the safe rows as one d | — | — | open: no deps train has run (needs a real npm install / cargo update; the npm registry is blocked in the cloud lanes) |
| 2.56 | #499 | #329 isomorphic-git 1.38.6 | — | — | not taken: lockfile has isomorphic-git 1.37.5 (deps train) |
| 2.57 | #499 | #328 `@astrojs/starlight` 0.42.8 (docs) | — | — | not taken: docs/package.json ^0.42.6 (deps train) |
| 2.58 | #499 | #327 astro 7.4.5 (docs) | — | — | not taken: docs/package.json ^7.4.0 (deps train) |
| 2.59 | #499 | #325 renderer vendors incl. katex 0.18 -> 0.19 | — | — | not taken: katex 0.18.10 in the lockfile (deps train) |
| 2.60 | #499 | #320 tauri-plugin-dialog 2.8.4 | — | — | not checked: Cargo.toml pins major "2" only; Cargo.lock decides (deps train, cargo update) |
| 2.61 | #499 | #296 tauri-build 2.7.4 | — | — | as 2.60 |
| 2.62 | #499 | #294 tauri 2.12.5 | — | — | as 2.60 |
| 2.63 | #499 | #167 `@tauri-apps/cli` 2.12.2 | — | — | not taken: @tauri-apps/cli 2.10.1 (deps train) |
| 2.64 | #499 | #264 dev tools: Playwright 1.64, testing-library, axe-core, fake-index | — | — | not taken: @playwright/test 1.59.1 (deps train) |
| 2.65 | #499 | #168 vue 3.5.44 (dev, exact pin) | — | — | not taken: vue 3.5.43 (deps train) |
| 2.66 | #499 | #162 yjs 13.6.33, y-codemirror.next 0.3.6 | — | — | not taken: yjs 13.6.30, y-codemirror.next 0.3.5 (deps train) |
| 2.67 | #499 | #161 milkdown 7.22.3 group | — | — | not taken: @milkdown/core 7.20.0 (deps train) |
| 2.68 | #499 | #160 codemirror group minors | — | — | not checked (deps train) |
| 2.69 | #499 | #154 `@y/websocket-server` 0.1.5 (optional relay) | — | — | not taken: @y/websocket-server not in the lockfile (deps train) |
| 2.73 | #499 | #153 `@types/node` 26 (mcp-server runs on Node 22) | — | — | done: .github/dependabot.yml ignores @types/node majors; owner-act: close #153 |
| 2.78 | #602 | Record the embeddings/reranker table and decisions; cross-lingual set  | — | — | owner-act: needs the models and a machine to run them (decision text) |
| 2.86 | #261 | Setup treats a slow 'restoring' vault as browser storage (4311616383) | ba8c89c301 | onboarding.test.tsx | commit found by its message |
| 2.87 | #261 | A vault move drops empty folders; preflight misses a file at a folder  | 2483bdca05 | historyVaultIdentity.test.ts, vaultLocation.test.ts | commit found by its message |
| 2.88 | #261 | Version history keyed by relative path only (4311163146) | 2483bdca05 | historyVaultIdentity.test.ts, vaultLocation.test.ts | commit found by its message |
| 2.92 | #316 | Web Clipper extension: add a receiver, or remove the extension | — | src/__tests__/clipperV2.test.ts (receiver) | partly: the receiver exists (`#clip=` and postMessage in src/hooks/useAppBootEffects.ts); the #316 page wording not checked |
| 5.16 | #483 | Public vault relay: run it on the sync-server host (fly.toml) or add t | — | — | partly: vault relay routes are in sync-server/ (vault-relay.js, vault-relay-roles.js); deploy + VITE_SYNC_RELAY_URL are owner-act |

