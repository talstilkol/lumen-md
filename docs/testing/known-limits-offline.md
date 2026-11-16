# Known limits of the offline test shim

What the offline shim (v4: Node + happy-dom, then headless Chromium) cannot run, so that a red file in an offline run is not read as a product bug, and the command that checks each one on the Mac (the real vitest + jsdom, `npm ci` done). Lane T8-shim classified every failing test and every load error of the shim run of verify/train-7 at 3100c18c43: 678 files, 601 green, 8,216 tests passed and 206 failed, 22 files that did not load.

Every failure is one of: **(a)** a product bug, **(b)** a test bug, **(c)** a limit of the shim or of working offline (a package not installed, a browser API, the network), **(d)** a flake. (a) and (b) were fixed in this round, with the failing test as the proof; this page lists what was fixed, then every (c) and (d) with its reason and the Mac command.

Run one file on the Mac with `npx vitest run <file>`, one case with `-t "<name>"`; the whole set with `npx vitest run`.

## Fixed in this round (a, b)

| File | Class | What was wrong | Branch |
|---|---|---|---|
| `GraphViewRender.test.tsx` | a | W1.10's WebGL GraphCanvas picked notes with the cursor's 10 px for every pointer: a finger's 22 px (plan 10.2.1) was lost. The tests were also stale (folder listing, click without pointerup). | fix/t8-shim-ui |
| `onboarding.test.tsx` | a | The first step focused the first radio (Hebrew, listed first), not the checked language. After the fix the case still stops at a jsdom-only assertion in Chromium (see below). | fix/t8-shim-ui |
| `modelHosting.test.ts` | a | models/registry.json: gkour/israeli_law (a download) named no hosting. | fix/t8-shim-ai |
| `publicRoadmap.test.ts` | a | The public roadmap published PR numbers and commit hashes from 39 task titles. | fix/t8-shim-tooling |
| `settingsSchema.test.ts` | a | 26 stored keys missing from the settings schema (export/import/search miss them); the scan missed keys written through a handed-in Storage. | fix/t8-shim-privacy |
| `storeSubmit.test.ts` | a | store/privacy-answers.md was not regenerated after 10 routes were added to store/privacy-labels.json. | fix/t8-shim-privacy |
| `syncExplained.test.tsx` | a | Unreadable sync rules showed 'Something went wrong' instead of where to fix them; the test also read an undefined `server` (b). | fix/t8-shim-privacy |
| `allThroughRuntime.test.ts` | a | Three modules called executor.chat() outside the runtime (plan 5.5.3). | fix/t8-shim-ai |
| `App.test.tsx` | b | Race with the lazy BacklinksPanel chunk (passes or fails by timing). | fix/t8-shim-ui |
| `ThemeSettingsPanel.test.tsx` | b | Fifth preset (Ktav, W1.21) not in the expected list. | fix/t8-shim-ui |
| `agentTools.test.ts` | b | Mock of indexedFiles() returned note text, not W2.22's summaries. | fix/t8-shim-ai |
| `e2eHooks.test.ts` | b | e2e/content-frame-origin.spec.ts imported /src/ in the page (fails on the e2e build). | fix/t8-shim-tooling |
| `i18nLazyCapture.test.ts` | b | SettingsScreen (W10.A10) not listed as a user of the lazy fine-tune English. | fix/t8-shim-tooling |
| `modelManagerPanel.test.tsx` | b | getByRole('status') found W3.2's EmptyState too; raw Ollama text expected on screen against W3.2. | fix/t8-shim-ui |
| `vaultWorker.test.ts` | b | Counted the .lumen/vault-id read (Y2) as a note read. | fix/t8-shim-privacy |
| `a11y.test.tsx` | b | Waited for a class W3.2's EmptyState replaced. | fix/t8-shim-ui |
| `rerankHard.test.ts` | b | Recorded dev evidence predates R12.16's BM25 change. | fix/t8-shim-ai |
| `mcpClient.test.ts` | b | Hidden behind the load error: the Sefaria server (W11.H17) not in the expected list. | fix/t8-shim-ai |

## A product bug not fixed here

- `tauriIsolation.test.ts` (2 tests): NOT FIXED: lib.rs registers vault_write_if / vault_remove_if, which src-tauri/isolation/index.js does not allow, and capabilities/default.json differs from its snapshot. Both are the desktop app's security boundary (the isolation allow-list and the reviewed capability snapshot), changed only after the owner's review, so this round leaves them as they are; until then a conditional vault write from the desktop app is refused by the isolation layer. Check: `npx vitest run src/__tests__/tauriIsolation.test.ts` after the review, and `node scripts/tauri-isolation.mjs --snapshot` once the capability change is accepted.

## Limits of the shim and of working offline (c)

Grouped by reason. *Load error* means the file did not load at all in either runner, so its tests were not counted. Each group's command runs exactly those files on the Mac.

### The plugin sandbox (QuickJS)

`quickjs-emscripten-core` (the plugin sandbox's WASM engine) is not installed offline.

Mac: `npx vitest run src/__tests__/pluginSignedInstall.test.ts src/__tests__/plugins-host.test.ts src/__tests__/plugins-sandbox.test.ts`

| File | Shim result | Test |
|---|---|---|
| `pluginSignedInstall.test.ts` | node pass 7 fail 1 | install → use → remove from a signed registry > downloads through the ledger, checks signature and hashes, runs the plugin in QuickJS, and removal clears its permissions and data |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > a method with no service in this app is refused, not silently ignored |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > a plugin that dies reports fatal and is terminated |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > delivers command events and counts refusals on the host side too |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > grants are capped by the manifest: a grant the plugin never asked for does nothing |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > keeps what the developer panel shows: calls, capability use, sandbox stats (W3.10) |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > runs a plugin, routes a granted call to the app's service and returns its answer |
| `plugins-host.test.ts` | browser pass 4 fail 7 | plugin host > validates UI trees: the exfiltration kinds are refused before the app sees them |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > a granted call reaches the host with JSON arguments and returns its value |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > a host refusal is a PluginDenied inside the plugin as well |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > a network grant covers its exact origin only — not another origin, a subdomain, or http |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > bases.query is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > bases.update is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > clipboard.writeText is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > commands.register is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > commands.unregister is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.getFileName is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.getSelection is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.getText is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.insertText is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.replaceSelection is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > document.setText is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > network.fetch is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > notifications.show is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > panel.close is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > panel.open is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > panel.render is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > renderer.register is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > renderer.result is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > settings.get is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > settings.set is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > settling a call frees its value: 600 granted and denied calls leave the plugin's heap as it was (W6.35) |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > storage.delete is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > storage.get is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > storage.set is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > vault.list is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > vault.read is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — default deny > vault.write is refused without its capability and never reaches the host |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > an infinite loop in an event handler is interrupted and reported as fatal |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > an infinite loop is interrupted by the CPU limit and ends the plugin |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > an uncaught error at load fails the load; after load it is fatal |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > console output is rate-limited and truncated |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > delivers command events to the handler registered with the command |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — events and limits > the heap limit stops a plugin that allocates without end |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — isolation > cannot import other modules |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — isolation > cannot redefine the lumen API or reach the call bridge after boot |
| `plugins-sandbox.test.ts` | browser pass 0 fail 39 | plugin sandbox — isolation > has no I/O: fetch, XMLHttpRequest, WebSocket, importScripts, indexedDB, document, window are all undefined |

### The render pipeline's remark/rehype plugins

The unified/remark plugins of the render pipeline (`remark-gfm`, `remark-frontmatter`, `remark-math`, `remark-directive`, `remark-rehype`, `rehype-slug`, …) are not installed offline; the shim's stand-ins throw when the pipeline runs.

Mac: `npx vitest run src/__tests__/embedsLive.test.tsx src/__tests__/hoverPreview.test.tsx src/__tests__/renderSnapshotDocs.test.ts src/__tests__/renderWorker.test.ts src/__tests__/vaultWorker.test.ts src/__tests__/viewportPreview.test.ts`

| File | Shim result | Test |
|---|---|---|
| `embedsLive.test.tsx` | node pass 1 fail 3 | live embeds > a missing target appears once the note is created |
| `embedsLive.test.tsx` | node pass 1 fail 3 | live embeds > reads an embedded image again when its version changes |
| `embedsLive.test.tsx` | node pass 1 fail 3 | live embeds > shows the embedded note's new text after it is saved |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | HoverCard > describes the link while it shows, and says when the note doesn't exist |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | previewMarkdown > from a heading (numbered like the preview), or just the block |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | renderPreview > renders the note, from cache the second time; well under 150 ms |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | review fixes (PR #250) > a block id: not one in code, and just the list item it marks |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | review fixes (PR #250) > a note saved since the last hover shows its new text |
| `hoverPreview.test.tsx` | browser pass 5 fail 6 | review fixes (PR #250) > the editor's hover skips [[links]] inside code |
| `renderSnapshotDocs.test.ts` | browser pass 0 fail 5 | render snapshots: the repository documents outside the 50-document set > MASTER_PLAN.md: every heading and every table row is rendered |
| `renderSnapshotDocs.test.ts` | browser pass 0 fail 5 | render snapshots: the repository documents outside the 50-document set > doc-privacy |
| `renderSnapshotDocs.test.ts` | browser pass 0 fail 5 | render snapshots: the repository documents outside the 50-document set > doc-release |
| `renderSnapshotDocs.test.ts` | browser pass 0 fail 5 | render snapshots: the repository documents outside the 50-document set > doc-release_notes_2026-05-01 |
| `renderSnapshotDocs.test.ts` | browser pass 0 fail 5 | render snapshots: the repository documents outside the 50-document set > doc-terms |
| `renderWorker.test.ts` | node pass 1 fail 10 | KaTeX once per formula (E2) > per formula with a cache gives the tree rehype-katex gives over the whole document |
| `renderWorker.test.ts` | node pass 1 fail 10 | KaTeX once per formula (E2) > renders each distinct formula once; an edit elsewhere renders nothing again — and the output is rehype-katex's |
| `renderWorker.test.ts` | node pass 1 fail 10 | hover cards in the worker (W10.E4) > the card is cut and rendered in the worker, the same as on the main thread, for the start, a heading and a block |
| `renderWorker.test.ts` | node pass 1 fail 10 | the protocol > a newer render on a channel makes the older one stale: the older rejects, the newer renders |
| `renderWorker.test.ts` | node pass 1 fail 10 | the protocol > a worker that cannot start, or that crashes mid-render, falls back to the main thread |
| `renderWorker.test.ts` | node pass 1 fail 10 | the protocol > a worker that reports an error: the main thread renders the same note |
| `renderWorker.test.ts` | node pass 1 fail 10 | the protocol > without a Worker, the main thread renders |
| `renderWorker.test.ts` | node pass 1 fail 10 | the render worker gives what the main thread gives > callout titles come translated in the request: Hebrew in the worker as on the main thread |
| `renderWorker.test.ts` | node pass 1 fail 10 | the render worker gives what the main thread gives > embeds render in the worker from the context's texts, and report the notes they used |
| `renderWorker.test.ts` | node pass 1 fail 10 | the render worker gives what the main thread gives > over every fixture document, light and dark — and nothing renders on the main thread meanwhile |
| `vaultWorker.test.ts` | node pass 27 fail 2 | the block-by-block preview > renders what the full pipeline renders, then only the changed block |
| `viewportPreview.test.ts` | browser pass 3 fail 4 | a long note renders the first screen first > a 2 MB note: the first block is shown before the note is done, and the end result is the full pipeline's |
| `viewportPreview.test.ts` | browser pass 3 fail 4 | a long note renders the first screen first > a 300 KB note: the viewport-first result is exactly the full pipeline's |
| `viewportPreview.test.ts` | browser pass 3 fail 4 | a long note renders the first screen first > an edit renders only the changed block, and a kept block whose heading ids moved is re-numbered, not re-rendered |
| `viewportPreview.test.ts` | browser pass 3 fail 4 | a long note renders the first screen first > the focus decides the first screen: a block in the middle comes before the top |

### window.location and Yjs

Chromium does not let a test redefine `window.location` (jsdom does), and `yjs` is not installed offline.

Mac: `npx vitest run src/__tests__/collabYjs.test.ts`

| File | Shim result | Test |
|---|---|---|
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > does not seed before synced or the fallback timeout |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > does not seed when remote content arrived before synced |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > ignores synced:false |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > keeps the room's own password on the session for later invite links, never a stored default |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > never auto-seeds an encrypted room it joins alone; seeds only on request |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > removes the synced listener and timer on destroy |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > seeds a new room synchronously |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > seeds on synced when still empty and alone, and cancels the fallback timer |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > seeds via the fallback timer when no peers ever appear |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > the share link's password wins over a stored default |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab join-time seeding > waits for synced instead of seeding on timeout when peers are connected |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > does not attach a saved persistent server when the plan doesn't include it |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > does not retain websocket provider when destroy happens before attach completes |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > does not seed content if the session is destroyed before timeout |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > password rooms attach providers to the ciphertext transport doc only |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > password rooms encrypt y-webrtc signaling (so presence only reaches password holders) |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > plain rooms sync the editor doc directly |
| `collabYjs.test.ts` | browser pass 4 fail 28 | connectCollab lifecycle > waits for a loading entitlement before deciding on the persistent server |
| `collabYjs.test.ts` | browser pass 4 fail 28 | readRoomFromHash > returns null when hash does not contain room param |
| `collabYjs.test.ts` | browser pass 4 fail 28 | readRoomFromHash > returns null when hash is empty |
| `collabYjs.test.ts` | browser pass 4 fail 28 | readRoomFromHash > returns room name when &room= appears in hash params |
| `collabYjs.test.ts` | browser pass 4 fail 28 | readRoomFromHash > returns the room name when #room= is in hash |
| `collabYjs.test.ts` | browser pass 4 fail 28 | seeding with a persistent (Hocuspocus) server > falls back to WebRTC-only seeding when the server never syncs (offline) |
| `collabYjs.test.ts` | browser pass 4 fail 28 | seeding with a persistent (Hocuspocus) server > seeds once the server reports an empty room |
| `collabYjs.test.ts` | browser pass 4 fail 28 | seeding with a persistent (Hocuspocus) server > waits for the server's sync before seeding, and doesn't seed over its history |
| `collabYjs.test.ts` | browser pass 4 fail 28 | snapshotPeers > puts self first in the returned list |
| `collabYjs.test.ts` | browser pass 4 fail 28 | snapshotPeers > returns empty array when awareness has no user states |
| `collabYjs.test.ts` | browser pass 4 fail 28 | snapshotPeers > returns peers with user info from awareness states |

### Yjs and the collaboration server packages

`yjs` (and `y-protocols`, `lib0`, `@hocuspocus/*`) is not installed offline: the shim stubs it, so `new Y.Doc()` / `class … extends Y.UpdateEncoderV1` fail.

Mac: `npx vitest run src/__tests__/collabE2eeCheckAttacks.test.ts src/__tests__/collabE2eeCheckCost.test.ts src/__tests__/collabQuota.test.ts src/__tests__/collabRoomSize.test.ts src/__tests__/commentThreads.test.ts src/__tests__/editorExtensions.test.ts src/__tests__/havrutaOffline.test.ts src/__tests__/havrutaRoom.test.ts src/__tests__/havrutaStudyScreen.test.tsx src/__tests__/z7/backupPurgeServer.test.ts`

| File | Shim result | Test |
|---|---|---|
| `collabE2eeCheckAttacks.test.ts` | browser load error | *load error* |
| `collabE2eeCheckCost.test.ts` | browser load error | *load error* |
| `collabQuota.test.ts` | browser load error | *load error* |
| `collabRoomSize.test.ts` | browser load error | *load error* |
| `commentThreads.test.ts` | browser pass 6 fail 5 | a comment on Hebrew text stays anchored > after 100 random edits around it, in another peer's document too |
| `commentThreads.test.ts` | browser pass 6 fail 5 | sidecar file > is written after a change, read back on start, and only by those who may edit |
| `commentThreads.test.ts` | browser pass 6 fail 5 | sidecar file > next to the note; round trip into a new room re-anchors on the quote |
| `commentThreads.test.ts` | browser pass 6 fail 5 | sidecar file > refuses files that aren't a sidecar; a deleted quote keeps its last text |
| `commentThreads.test.ts` | browser pass 6 fail 5 | threads > @mentions in Hebrew and English, not e-mail addresses; replies and resolve |
| `editorExtensions.test.ts` | browser pass 3 fail 2 | editor extension factories — contract > commentDecorations returns [] with no Y.Doc, real Extension with one |
| `editorExtensions.test.ts` | browser pass 3 fail 2 | editor extension factories — contract > multiple extension factories can be invoked in the same render cycle |
| `havrutaOffline.test.ts` | browser load error | *load error* |
| `havrutaRoom.test.ts` | browser load error | *load error* |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > a note on a segment appears in the partner's column; a copy of the text is refused |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > axe: no serious or critical violation |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > keyboard: one tab stop, ↑/↓/Home/End between segments, Enter to the note box, Escape back |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > niqqud is for display only: hiding it changes the screen, not the text |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > save to vault: one note with both partners' notes and the pointers, never the text |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > text and translation by segment, link-only versions as a link; the partner's presence shows |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > the partner's selection is drawn in their colour, and 'follow' moves with them |
| `havrutaStudyScreen.test.tsx` | browser pass 0 fail 8 | the study screen with two partners > what the relay passed is ciphertext: no word of the text or of a note |
| `z7/backupPurgeServer.test.ts` | browser load error | *load error* |

### CodeMirror commands

`@codemirror/commands` (history/undo) is not installed offline.

Mac: `npx vitest run src/__tests__/agentReviewApply.test.ts src/__tests__/agentReviewPanel.test.tsx`

| File | Shim result | Test |
|---|---|---|
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | a real run > stages replace_range with the run document's fingerprint; only the approval changes the live document |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > applies a change for an untitled document only to that document, even when another one holds the same text |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > applies a change for another open tab to that tab's text |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > applies it to the live text of an unsaved document, and Undo takes it back |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > finds a change again by its surroundings when the user's edits moved it; refuses it when they changed them |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > in suggesting mode, records the approval as a tracked change by the agent |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > maps offsets through earlier approvals, so one run's changes can be approved in any order |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > puts a write_file to the open document into its live text, and refuses it over unsaved edits |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > refuses a change for an untitled document that is no longer open, or that does not say which document it was for |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > refuses a change whose text moved underneath, with the reason |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > says when the edit went in without an undo history (Preview / WYSIWYG) |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > writes a change for a document that is not open to its workspace file |
| `agentReviewApply.test.ts` | browser pass 2 fail 13 | approving a change to the open document > writes nothing before approval, and nothing when the change is rejected |
| `agentReviewPanel.test.tsx` | browser pass 18 fail 1 | editorDocumentHost (the store and the editor) > goes through CodeMirror when the source editor shows the document, so Undo takes the change back |

### TanStack Table

`@tanstack/react-table` is not installed offline.

Mac: `npx vitest run src/__tests__/databaseFormulaView.test.tsx`

| File | Shim result | Test |
|---|---|---|
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > a formulas: value that isn't a map adds no columns (review #267) |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > editing a property recomputes its formulas and writes only the property |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > shows formula columns, read-only, with an error cell for a note they can't compute |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > the filter can use a formula column |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > the formula box checks as you type, then adds the column |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > with fields: in the spec, an added formula column still shows |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > with fields: in the spec, the spec's formulas: columns show after them, once |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > “Write with AI” also offers the formula columns already defined (review #267) |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — formulas > “Write with AI” runs the formulator agent with the database's properties |
| `databaseFormulaView.test.tsx` | browser pass 9 fail 10 | DatabaseBlock — map view > loads Leaflet only when the map is picked, with a marker per note that has coordinates |

### The MCP server package (.js → .ts specifiers)

`mcp-server/` imports its TypeScript siblings with `.js` specifiers (NodeNext style); vitest maps `.js` → `.ts`, the shim v4 Node loader does not (load error). With a copy of the shim that maps `.js` → `.ts` (lane T8-shim) every one of these files is green except mcpClient's Sefaria case, fixed in this round. The Chromium runner has no `node:crypto` `createHmac` / `node:http` either.

Mac: `npx vitest run src/__tests__/askVaultEval.test.ts src/__tests__/askVaultScope.test.ts src/__tests__/basesMcpCli.test.ts src/__tests__/mcpClient.test.ts src/__tests__/mcpProtocol2026.test.ts src/__tests__/mcpScope.test.ts src/__tests__/mcpServerSpec.test.ts src/__tests__/privacyMcpLedger.test.tsx src/__tests__/typesMcpCli.test.ts`

| File | Shim result | Test |
|---|---|---|
| `askVaultEval.test.ts` | browser load error | *load error* |
| `askVaultScope.test.ts` | browser load error | *load error* |
| `basesMcpCli.test.ts` | browser load error | *load error* |
| `mcpProtocol2026.test.ts` | browser load error | *load error* |
| `mcpScope.test.ts` | browser load error | *load error* |
| `mcpServerSpec.test.ts` | browser load error | *load error* |
| `privacyMcpLedger.test.tsx` | browser load error | *load error* |
| `typesMcpCli.test.ts` | browser load error | *load error* |
| `mcpClient.test.ts` | browser load error | *load error* |

### isomorphic-git

`isomorphic-git` is not installed offline (`isoGit.init` is the shim's stand-in).

Mac: `npx vitest run src/__tests__/agentToolsNew.test.ts`

| File | Shim result | Test |
|---|---|---|
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > carries the repository's provenance: a cloned or pulled repo's diff is outside content (plan 2.7) |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > counts a rewrite too large to diff line by line, and says so (review: #205) |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > diffs HEAD against the working copy (what the next commit records) |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > diffs the index with staged=true, and narrows to paths |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > names the repositories when the one asked for does not exist, and stops when cancelled |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > shows a file deleted or renamed in the workspace (review: #205) |
| `agentToolsNew.test.ts` | browser pass 27 fail 7 | git_diff > shows every file deleted when the repository's folder was emptied (review: #241) |

### Spying on an ES module export

The test replaces an export of an ES module (`vi.spyOn(module, …)` / assignment to a namespace). Vitest's module transform allows it; the shim loads real ES modules, whose namespaces are read-only (`Cannot assign to read only property` / `Cannot redefine property`).

Mac: `npx vitest run src/__tests__/a11y.test.tsx src/__tests__/perfVault.test.ts src/__tests__/searchOps.test.ts src/__tests__/workspaceIndexFreshness.test.ts`

| File | Shim result | Test |
|---|---|---|
| `a11y.test.tsx` | browser pass 16 fail 2 | axe a11y smoke > TemplateGallery (open, mocked registry) renders no blockers |
| `perfVault.test.ts` | browser pass 3 fail 1 | big vault (10,000 notes) > a save re-reads only the saved note (< 50 ms), not the vault |
| `searchOps.test.ts` | browser pass 39 fail 1 | regressions vs #232 restored in the worker core (S1 review on #306) > (b) an unchanged re-upsert re-tokenises nothing |
| `workspaceIndexFreshness.test.ts` | browser pass 0 fail 2 | workspace index freshness > keeps a change announced while the full build is reading, and applies it before returning |
| `workspaceIndexFreshness.test.ts` | browser pass 0 fail 2 | workspace index freshness > picks up unannounced writes after REVALIDATE_MS, re-reading only changed files |

### PostCSS

`postcss` is not installed offline (and the browser runner cannot bundle TypeScript's Node build).

Mac: `npx vitest run src/__tests__/logicalCss.test.ts`

| File | Shim result | Test |
|---|---|---|
| `logicalCss.test.ts` | node pass 3 fail 5 | hygiene: physical CSS in .prose-lumen / .cm-* rules > flags physical properties and values, and names the logical one |
| `logicalCss.test.ts` | node pass 3 fail 5 | hygiene: physical CSS in .prose-lumen / .cm-* rules > flags shorthands that set left and right differently, not symmetric ones (review: #219) |
| `logicalCss.test.ts` | node pass 3 fail 5 | hygiene: physical CSS in .prose-lumen / .cm-* rules > honours a justified hygiene-allow comment on the line or the line above |
| `logicalCss.test.ts` | node pass 3 fail 5 | hygiene: physical CSS in .prose-lumen / .cm-* rules > leaves logical properties and rules outside the preview and editor alone |
| `logicalCss.test.ts` | node pass 3 fail 5 | hygiene: physical CSS in .prose-lumen / .cm-* rules > the app's own stylesheets pass |

### Milkdown / ProseMirror

`@milkdown/prose` (ProseMirror) is not installed offline: `new PluginKey()` at module load fails.

Mac: `npx vitest run src/__tests__/bidiBlocks.test.ts src/__tests__/wysiwygAiAuthorship.test.ts src/__tests__/wysiwygAiRestore.test.ts src/__tests__/wysiwygWikiLinks.test.ts`

| File | Shim result | Test |
|---|---|---|
| `bidiBlocks.test.ts` | browser load error | *load error* |
| `wysiwygAiAuthorship.test.ts` | browser load error | *load error* |
| `wysiwygAiRestore.test.ts` | browser load error | *load error* |
| `wysiwygWikiLinks.test.ts` | browser load error | *load error* |

### vi.doMock with a throwing factory

`vi.doMock(path, () => { throw … })` — a factory that throws so the dynamic import rejects — is not reproduced by the shim (the error escapes the import), and the Chromium runner cannot bundle a `.json` import from a glob.

Mac: `npx vitest run src/__tests__/i18nLazy.test.ts`

| File | Shim result | Test |
|---|---|---|
| `i18nLazy.test.ts` | node pass 10 fail 3 | A7 lever 4 — only English ships eagerly > boot fallback updates the rehydrated store so App's mount effect can't re-apply RTL |
| `i18nLazy.test.ts` | node pass 10 fail 3 | A7 lever 4 — only English ships eagerly > initLocale() falls back to English (LTR) when the locale chunk can't load |
| `i18nLazy.test.ts` | node pass 10 fail 3 | A7 lever 4 — only English ships eagerly > switching to a locale whose chunk can't load keeps the UI English and LTR |

### import.meta.glob inside fixture strings

The shim expands every `import.meta.glob(` it finds in a file's text at load time, including the ones inside the test's own fixture strings, so the parser under test receives already-rewritten source.

Mac: `npx vitest run src/__tests__/unusedFiles.test.ts`

| File | Shim result | Test |
|---|---|---|
| `unusedFiles.test.ts` | node pass 12 fail 3 | findOrphans > a negative import.meta.glob pattern excludes its file, which is then an orphan (Codex P2, #266) |
| `unusedFiles.test.ts` | node pass 12 fail 3 | findOrphans > import.meta.glob marks every match as used |
| `unusedFiles.test.ts` | node pass 12 fail 3 | the parts > extracts every kind of specifier |

### XML in happy-dom

happy-dom's `DOMParser` for XML (WordPress WXR, iWork `index.apxl`, Evernote web clips) parses CDATA / namespaces differently from jsdom; the Chromium run passes these cases, and its remaining failure is a harness limit (no `zlib`, no `node:crypto`, no pdf.js worker).

Mac: `npx vitest run src/__tests__/importFormats.test.ts src/__tests__/iworkImport.test.ts`

| File | Shim result | Test |
|---|---|---|
| `importFormats.test.ts` | browser pass 36 fail 1 | pdfToMarkdown (real pdfjs-dist extraction) > extracts text from a real PDF (no CDN, local worker fallback) |
| `iworkImport.test.ts` | browser pass 23 fail 1 | iworkToMarkdown / fileToMarkdown > imports a legacy .key (gzipped index.apxl) |

### Web Animations API

happy-dom has no Web Animations API (`element.animate()` returns undefined → `.pause`); the Chromium harness cannot read `src/index.css` from disk.

Mac: `npx vitest run src/__tests__/toastEntranceRtl.test.ts`

| File | Shim result | Test |
|---|---|---|
| `toastEntranceRtl.test.ts` | node pass 0 fail 2 | toast entrance follows the writing direction > LTR: from +20px (the right edge) |
| `toastEntranceRtl.test.ts` | node pass 0 fail 2 | toast entrance follows the writing direction > RTL: from −20px (the left edge, where the toast sits) |

### CodeMirror autocomplete / Markdown language

`@codemirror/autocomplete` / `@codemirror/lang-markdown` are not installed offline (the module reads `completionKeymap` / calls `markdown()` at load).

Mac: `npx vitest run src/__tests__/wikiCompletePerf.test.ts src/__tests__/wikiLinkCompletion.test.ts`

| File | Shim result | Test |
|---|---|---|
| `wikiCompletePerf.test.ts` | browser pass 2 fail 1 | [[ completion over 10,000 notes > the source editor's completion source answers in < 50 ms |
| `wikiLinkCompletion.test.ts` | browser load error | *load error* |

### fake-indexeddb

`fake-indexeddb` is not installed offline (`new IDBFactory()` fails).

Mac: `npx vitest run src/__tests__/VersionHistoryPanel.test.tsx`

| File | Shim result | Test |
|---|---|---|
| `VersionHistoryPanel.test.tsx` | browser pass 0 fail 1 | <VersionHistory> > lists a collab version with its author and shows the storage state |

### Storage.prototype spies

`vi.spyOn(Storage.prototype, "setItem")` does not reach happy-dom's `localStorage` (jsdom routes it through the prototype). Green in Chromium once the shim's lucide stand-in has every icon (3/0).

Mac: `npx vitest run src/__tests__/aiBatchCommands.test.ts`

| File | Shim result | Test |
|---|---|---|
| `aiBatchCommands.test.ts` | node pass 2 fail 1 | AI: Check Batch Jobs > reports a job state it couldn't save and writes nothing |

### Excalidraw

`@excalidraw/excalidraw` is not installed offline: the test reads its `dist/prod/locales` folder.

Mac: `npx vitest run src/__tests__/canvasExcalidraw.test.ts`

| File | Shim result | Test |
|---|---|---|
| `canvasExcalidraw.test.ts` | node pass 9 fail 1 | the editor's language > every code it names ships as an Excalidraw locale |

### File snapshots

`expect(…).toMatchFileSnapshot()` is not implemented by the shim's `expect`.

Mac: `npx vitest run src/__tests__/commandIds.test.ts`

| File | Shim result | Test |
|---|---|---|
| `commandIds.test.ts` | node pass 1 fail 1 | command palette list (plan 0.2 split guard) > matches the snapshot in every scenario |

### Frames in happy-dom

happy-dom gives a frame no real `contentWindow` (frame loading is off), so `event.source === frame.contentWindow` never matches; in Chromium this case passes and the one left reads `security/policy.json` from disk, which the browser harness cannot.

Mac: `npx vitest run src/__tests__/contentFrameDom.test.ts`

| File | Shim result | Test |
|---|---|---|
| `contentFrameDom.test.ts` | browser pass 14 fail 1 | W10.D2: no Gist script at the app's origin > no policy of a page at the app's origin allows gist.github.com scripts |

### Icon stand-in and the per-file timeout

The Chromium runner's `lucide-react` stand-in lacks `GraduationCap` / `FlaskConical` (build error), and the Node run exceeds the shim's 300 s per-file timeout. With the two icons added the file is green in Chromium (1/0).

Mac: `npx vitest run src/__tests__/exportSnapshot.test.ts`

| File | Shim result | Test |
|---|---|---|
| `exportSnapshot.test.ts` | browser load error | *load error* |

### DOMPurify in happy-dom

DOMPurify under happy-dom drops `<table>` structure (and keeps what jsdom/Chromium remove); in Chromium the file fails to load because the harness cannot `readdirSync` the notebook fixtures.

Mac: `npx vitest run src/__tests__/fileViewers.test.tsx`

| File | Shim result | Test |
|---|---|---|
| `fileViewers.test.tsx` | node pass 15 fail 1 | notebook viewer (W12.F4) on 12 public notebooks > synthetic hostile notebook: <script>, onerror, javascript: and JS outputs run 0 times |

### toHaveProperty with a dotted key

Vitest's `toHaveProperty("canvas.autoSaved")` first checks for an own property with that exact (dotted) name; the shim's `expect` only reads it as a path a → b. In Chromium the harness cannot `readdirSync` the source tree, so the call-site scans see nothing.

Mac: `npx vitest run src/__tests__/i18nStrings.test.ts`

| File | Shim result | Test |
|---|---|---|
| `i18nStrings.test.ts` | node pass 3 fail 1 | i18n bundle integrity > the 8 α.6 cleanup keys are present in both bundles |

### Mutation receipt (Stryker)

The committed Stryker receipt is stale for 65 critical modules changed since 2026-11-12. Re-running mutation testing needs Stryker, which is not installed offline (the same known red as T7: the gate's 18). Not a test or product bug.

Mac: `npx vitest run src/__tests__/mutationReceipt.test.ts`

| File | Shim result | Test |
|---|---|---|
| `mutationReceipt.test.ts` | node pass 5 fail 1 | mutation receipt check (W4.17) > the committed receipt covers every critical module on its current source; shim samples count only as estimates |

### jsdom-specific environment assertions

The case asserts jsdom's environment: no `showDirectoryPicker`, so the folder choice is disabled. Chromium has the picker (the choice is enabled) and happy-dom's act/flush order differs for the reconnect case; each case passes in the other runner.

Mac: `npx vitest run src/__tests__/onboarding.test.tsx`

| File | Shim result | Test |
|---|---|---|
| `onboarding.test.tsx` | browser pass 14 fail 1 | FirstRun > is a labelled dialog that walks four steps; the language applies at once |

### vi.doMock of the Tauri core after resetModules

Node: the shim maps `@tauri-apps/api/core` to a fixed empty module, so `vi.doMock` of it after `vi.resetModules()` has no effect; Chromium: after `vi.resetModules()` the test's second `import()` of the toast store is a different instance from the one the module under test holds. Each case passes in the other runner.

Mac: `npx vitest run src/__tests__/quickCapture.test.ts`

| File | Shim result | Test |
|---|---|---|
| `quickCapture.test.ts` | browser pass 32 fail 1 | desktop global shortcut (feature check) > a shortcut another app holds is reported to the user, not swallowed (W10.C13) |

### node:crypto in the browser harness

The Chromium harness has no `node:crypto` `createHash` (sha256 of the corpus files); the Node run passes it.

Mac: `npx vitest run src/__tests__/realCorpus.test.ts`

| File | Shim result | Test |
|---|---|---|
| `realCorpus.test.ts` | browser pass 18 fail 1 | the corpus (manifest) > every file is the one the manifest names (sha256) |

### import.meta.env.DEV

`import.meta.env.DEV` is `false` under the shim (vitest sets it `true`).

Mac: `npx vitest run src/__tests__/testSurfaceGate.test.ts`

| File | Shim result | Test |
|---|---|---|
| `testSurfaceGate.test.ts` | browser pass 2 fail 1 | window.__lumen.agentReview only in development and tests (plan W1.31) > exists under vitest (false) and goes away on stop |

## Flakes (d)

- `App.test.tsx` › *backlinks open the linking note and reveal the workspace*: read the lazy BacklinksPanel's props before its chunk resolved, so it passed or failed by timing (green in the lane's own run of the same commit). Fixed as a test bug on fix/t8-shim-ui: the test waits for the chunk. No other failure changed between the runs of the same commit.

## Cases red in only one runner

The shim reports the better of its two runs, so these do not count above, but they show when a file is run with `V4=node` or `V4=browser`: `syncExplained.test.tsx` › *the activity panel shows a conflict while its dialog is still open* times out in Node (30 s, two simulated devices' key derivations) and passes in Chromium; `onboarding.test.tsx` › *a folder that needs permission again…* differs in Node's act/flush order and passes in Chromium; `vaultWorker.test.ts` › *a save reads and re-indexes only the saved note* is over its 50 ms in Chromium and passes in Node.

## Re-checking this page

Offline: the shim's `v4.sh <worktree> <file>`, one file at a time (it is not in the repository; the lanes keep it in their scratch space). On the Mac: `npx vitest run` over the files above; every (c) here is expected green there except `tauriIsolation.test.ts` (owner review) and `mutationReceipt.test.ts` until the mutation run (`npm run test:mutation`, then commit the receipt).
