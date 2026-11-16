# Press kit (M3, English)

> Draft for the owner, who decides whom to send it to. Each claim carries its
> receipt, `[^id]`, from `claims.json`. Screenshots: the list in
> `launch/press-kit.md`, made-up notes only.

## One line

Lumen is a free, open-source Markdown editor built for Hebrew and right-to-left, local-first, with sandboxed plugins.[^mit][^plugin-no-access]

## One paragraph

Most note apps treat Hebrew as an afterthought. Lumen starts from it: direction is set per line,[^rtl-per-line] search finds a word through niqqud and prefixes,[^hebrew-search] and the interface mirrors in Hebrew and Arabic.[^ui-languages] Notes stay on the device as plain Markdown files,[^md-files] no account is needed, and with the default settings nothing leaves the device.[^no-account] Plugins run with no access unless the user grants it,[^plugin-no-access] and AI can run on the device itself.[^local-ai]

## Facts

- Open source, MIT licence.[^mit]
- Works offline as an installed web app;[^offline] a desktop app too.[^desktop]
- Interface in 8 languages.[^ui-languages]
- Plugin logic in QuickJS inside its own Web Worker, with no fetch, DOM or storage.[^plugin-quickjs]
- A public review scorecard with a privacy label for each listed plugin.[^plugin-scorecards]
- Optional vault encryption at rest with AES-256-GCM,[^vault-encryption] and a passphrase key from Argon2id.[^argon2id]
- Imports from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq and OneNote.[^importers]

## What to say about security

- Lumen has **not** had an external security audit.[^no-external-audit] Please describe its cryptography as not audited and not certified.[^no-external-audit]
- Every open security finding is listed in public.[^findings-public]

## Name and logo

- The name is **Lumen**, in Latin letters, in Hebrew text too.
- Use the icon in `public/icons/` as it is.

## Contact

OWNER: a press contact address.

<!-- launch-kit:sources -->

## Sources

[^mit]: Open source under the MIT licence. Receipt: `LICENSE`.
[^plugin-no-access]: Every plugin runs with no access by default. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^rtl-per-line]: Direction is set per line, from its first strong letter. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^hebrew-search]: Search folds niqqud, final letters and the prefix letters. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^ui-languages]: The interface is in 8 languages, six of them in beta (machine-translated); Hebrew and Arabic mirror the layout. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^md-files]: Notes are plain Markdown; the whole vault exports as a .zip or a folder. Receipt: `docs/src/content/docs/workspace/export-import.md`.
[^no-account]: No account; with the default settings nothing leaves the device. Receipt: `docs/src/content/docs/security/privacy-report.md`.
[^local-ai]: AI can run entirely on the device (WebGPU), with no per-token cost. Receipt: `docs/src/content/docs/ai/local-llm.md`.
[^offline]: Works offline as an installed web app. Receipt: `docs/src/content/docs/getting-started/install.md`.
[^desktop]: There is a desktop app for macOS, Windows and Linux. Receipt: `docs/src/content/docs/getting-started/desktop-app.md`.
[^plugin-quickjs]: Plugin logic runs in QuickJS, a separate engine in its own Web Worker, with no fetch, DOM or storage. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^plugin-scorecards]: Each listed plugin has a public review scorecard with a privacy label. Receipt: `docs/src/content/docs/security/index.md`.
[^vault-encryption]: Optional vault encryption at rest, with AES-256-GCM. Receipt: `docs/src/content/docs/security/vault-encryption.md`.
[^argon2id]: The passphrase key is derived with Argon2id. Receipt: `docs/src/content/docs/security/vault-encryption.md`.
[^importers]: Imports from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq and OneNote. Receipt: `docs/src/content/docs/workspace/import.md`.
[^no-external-audit]: Lumen has not had an external security audit, so its cryptography must not be called audited. Receipt: `docs/src/content/docs/security/index.md`.
[^findings-public]: Every open security finding is listed in public. Receipt: `docs/src/content/docs/security/index.md`.

<!-- /launch-kit:sources -->
