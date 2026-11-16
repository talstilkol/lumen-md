# Show HN (M3)

> Draft for the owner. Nothing here is posted. Post on a weekday morning, US
> time, and answer every comment for the first hours (R6.11). Each claim
> carries its receipt, `[^id]`, from `claims.json`; `npm run launch:kit`
> checks them.

## Title

Show HN: Lumen – local-first Markdown notes for Hebrew, with sandboxed plugins

## Link

https://lumen-md.vercel.app

## Text

I write mostly in Hebrew, and most editors treat right-to-left as an afterthought. Lumen starts there: direction is set per line, from its first strong letter,[^rtl-per-line] and search folds niqqud, final letters and the one-letter prefixes.[^hebrew-search] The interface is in 8 languages, and Hebrew and Arabic mirror it.[^ui-languages]

What may interest HN more is the extension model. Every plugin runs with no access by default.[^plugin-no-access] Its logic runs in QuickJS, a separate JavaScript engine compiled to WebAssembly in its own Web Worker, with no fetch, DOM or storage.[^plugin-quickjs] Its interface is not HTML: it sends a tree of known elements that Lumen draws.[^plugin-ui-data] Each listed plugin has a public review scorecard with a privacy label.[^plugin-scorecards]

It's local-first: no account is needed, and with the default settings nothing leaves the device.[^no-account] It works offline as an installed web app,[^offline] there's a desktop app for macOS, Windows and Linux,[^desktop] and notes are plain Markdown that export as a .zip or a folder.[^md-files] AI can run entirely on the device, through WebGPU.[^local-ai] It is MIT-licensed.[^mit]

What it isn't yet: the cryptography has not had an external security audit.[^no-external-audit] Every open security finding is on a public page.[^findings-public] The comparison page lists what Lumen still lacks next to Obsidian, Notion and Google Docs.[^compare]

Coming from Obsidian? Real public vaults are opened and saved byte-identical in the test suite,[^obsidian-corpus] and the importer also reads Notion, Evernote, Bear, Apple Notes, Keep, Logseq and OneNote.[^importers]

Source: https://github.com/talstilkol/lumen-md

<!-- launch-kit:sources -->

## Sources

[^rtl-per-line]: Direction is set per line, from its first strong letter. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^hebrew-search]: Search folds niqqud, final letters and the prefix letters. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^ui-languages]: The interface is in 8 languages, six of them in beta (machine-translated); Hebrew and Arabic mirror the layout. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^plugin-no-access]: Every plugin runs with no access by default. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^plugin-quickjs]: Plugin logic runs in QuickJS, a separate engine in its own Web Worker, with no fetch, DOM or storage. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^plugin-ui-data]: A plugin's interface is a tree of known elements, not HTML. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^plugin-scorecards]: Each listed plugin has a public review scorecard with a privacy label. Receipt: `docs/src/content/docs/security/index.md`.
[^no-account]: No account; with the default settings nothing leaves the device. Receipt: `docs/src/content/docs/security/privacy-report.md`.
[^offline]: Works offline as an installed web app. Receipt: `docs/src/content/docs/getting-started/install.md`.
[^desktop]: There is a desktop app for macOS, Windows and Linux. Receipt: `docs/src/content/docs/getting-started/desktop-app.md`.
[^md-files]: Notes are plain Markdown; the whole vault exports as a .zip or a folder. Receipt: `docs/src/content/docs/workspace/export-import.md`.
[^local-ai]: AI can run entirely on the device (WebGPU), with no per-token cost. Receipt: `docs/src/content/docs/ai/local-llm.md`.
[^mit]: Open source under the MIT licence. Receipt: `LICENSE`.
[^no-external-audit]: Lumen has not had an external security audit, so its cryptography must not be called audited. Receipt: `docs/src/content/docs/security/index.md`.
[^findings-public]: Every open security finding is listed in public. Receipt: `docs/src/content/docs/security/index.md`.
[^compare]: An honest comparison with Obsidian, Notion and Google Docs, with a source for every claim and what Lumen still lacks. Receipt: `docs/src/content/docs/project/compare.md`.
[^obsidian-corpus]: Real public Obsidian vaults are opened and saved byte-identical in the test suite. Receipt: `src/__tests__/obsidianCorpus.test.ts`.
[^importers]: Imports from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq and OneNote. Receipt: `docs/src/content/docs/workspace/import.md`.

<!-- /launch-kit:sources -->
