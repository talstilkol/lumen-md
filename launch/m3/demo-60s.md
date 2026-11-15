# The 60-second demo (M3)

> A script for the owner; the recording is W10.M9. Made-up notes only (the
> sample vault). Each shot names the claim it shows, `[^id]`, so the video
> shows nothing the kit can't back. The timecodes add up to 60 seconds.

| Time | Shot | Says (EN) | אומר (HE) |
|---|---|---|---|
| 0:00–0:06 | The editor, a Hebrew note with an English term and a number | "Notes in Hebrew and English, in one line." | „עברית ואנגלית באותה שורה.” [^rtl-per-line] |
| 0:06–0:14 | Typing an English word inside a Hebrew sentence; the line keeps its order | "Direction is set per line." | „הכיוון נקבע לכל שורה.” [^rtl-per-line] |
| 0:14–0:22 | Search for בית finds והבית and הַבַּיִת | "Search sees through niqqud and prefixes." | „החיפוש רואה דרך ניקוד ותחיליות.” [^hebrew-search] |
| 0:22–0:30 | Airplane mode on; keep writing; the privacy panel shows no request | "No account, no network needed." | „בלי חשבון, בלי רשת.” [^no-account][^offline] |
| 0:30–0:40 | Install a plugin; the permission prompt; the plugin's panel | "Plugins start with no access." | „תוספים מתחילים בלי הרשאות.” [^plugin-no-access] |
| 0:40–0:48 | Local AI summarises the note, the network panel still empty | "AI on your device." | „AI על המכשיר.” [^local-ai] |
| 0:48–0:55 | Export the vault as a folder; the .md files in the file manager | "Your notes are plain files." | „הפתקים הם קבצים רגילים.” [^md-files] |
| 0:55–1:00 | The logo, the address, "MIT" | "Free and open source." | „חינם וקוד פתוח.” [^mit] |

<!-- launch-kit:sources -->

## Sources

[^rtl-per-line]: Direction is set per line, from its first strong letter. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^hebrew-search]: Search folds niqqud, final letters and the prefix letters. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^no-account]: No account; with the default settings nothing leaves the device. Receipt: `docs/src/content/docs/security/privacy-report.md`.
[^offline]: Works offline as an installed web app. Receipt: `docs/src/content/docs/getting-started/install.md`.
[^plugin-no-access]: Every plugin runs with no access by default. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^local-ai]: AI can run entirely on the device (WebGPU), with no per-token cost. Receipt: `docs/src/content/docs/ai/local-llm.md`.
[^md-files]: Notes are plain Markdown; the whole vault exports as a .zip or a folder. Receipt: `docs/src/content/docs/workspace/export-import.md`.
[^mit]: Open source under the MIT licence. Receipt: `LICENSE`.

<!-- /launch-kit:sources -->
