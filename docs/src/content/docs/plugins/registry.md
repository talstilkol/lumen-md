---
title: Plugin registry and the built-in ten
description: The ten plugins in Lumen's plugin gallery, what each one may do, and how the static registry is built and scanned.
type: how-to
tasks: ["W12.S6", "W10.B3", "W6.35"]
---

The **Sandboxed plugins** section of the Plugin Gallery lists plugins from a
static registry that ships with Lumen. There is no plugin server: the registry
is a folder of files, and every version in it passes the safety scan before it
is listed.

## The ten plugins

These are modelled on the kinds of Obsidian plugins people download most
(templates, task boards, calendars, tables, linting, tags, spaced repetition,
refactoring, dates, sorting). Each is written for Lumen's sandbox: none of them
uses the network, so they all work under the **local-only** AI policy.

| Plugin | What it does | Permissions |
| --- | --- | --- |
| **Templates** | Inserts a note from your `Templates` folder, filling `{{date}}`, `{{date:DD/MM/YYYY}}`, `{{time}}`, `{{title}}`, `{{selection}}`, `{{weekday}}` and `{{hebrewWeekday}}`. | commands, read the vault, read and change the open note, panel, settings |
| **Kanban board** | Draws a ` ```kanban ` block (a `## heading` per column, a `- item` per card) as columns, and copies the board as a Markdown table. | code-block renderer, commands, read and change the open note, clipboard, notifications |
| **Calendar** | A month view of your daily notes (`YYYY-MM-DD.md`). Days that have a note link to it. The week starts on Sunday, or on Monday if you choose. | commands, panel, read the vault, settings |
| **Table formatter** | Lines up the columns of every table and sorts a table by the column under the cursor. Hebrew niqqud takes no width. | commands, read and change the open note |
| **Markdown tidy** | Fixes trailing spaces, extra blank lines, heading spacing, mixed bullets and a missing final newline. It never touches code or front matter. | commands, read and change the open note, notifications, settings |
| **Tag manager** | Lists every `#tag` in the vault, Hebrew tags included, and renames a tag and its nested tags everywhere at once. | commands, panel, read and change the vault, notifications |
| **Flashcards** | Turns `question :: answer` lines into cards and schedules reviews with SM-2. The note itself is never changed. | commands, read the open note, panel, storage |
| **Note refactor** | Moves the selection into a new note and leaves a `[[link]]` in its place, or splits a note into one note per heading. | commands, read and change the open note, read and change the vault, notifications, settings |
| **Natural dates** | Turns “tomorrow”, “next Friday”, “in 3 days”, “מחר”, “יום שישי הבא” or 12/11/2026 (day first) into `[[2026-11-13]]`. | commands, read and change the open note, notifications, settings |
| **Sort lines** | Sorts the selected lines A→Z, Z→A or by length, reverses them, or removes duplicates. Sub-items stay with their item. Hebrew sorts by letter (final letters sort with their regular forms), and numbers sort by value. | commands, read and change the open note, notifications |

Install one from **Plugin Gallery → Sandboxed plugins → Install…**. The
permission screen lists everything the plugin asks for and why. Once a plugin is
installed, its card shows **Remove**, which stops the plugin and deletes the
settings and data it stored.

The plugins write their labels in English and Hebrew, because the plugin API
does not tell a plugin which language the app is in.

## How the registry is built

```
public/plugins/examples/
  index.json          ← built: every plugin, its versions, the SHA-256 of each version's code and manifest
  index.json.sig      ← the owner's Ed25519 signature over index.json (written by --sign)
  scan.json           ← built: the safety scan of every version
  kanban/             ← one folder per version
    lumen-plugin.json
    main.js
```

```sh
node scripts/build-plugin-registry.mjs           # rebuild index.json and scan.json
node scripts/build-plugin-registry.mjs --check   # fail if either is out of date, a version fails, or index.json.sig no longer matches
```

The build does the following:

- validates every manifest;
- refuses stray files in a plugin folder (only the manifest, its entries, a `LICENSE` and a `README` are allowed);
- refuses an id and version that appear twice;
- writes `index.json`;
- scans every version (`scripts/scan-plugins.mjs`).

A new version goes in a folder of its own, for example `kanban@1.1.0`.

When you install a plugin, the app scans the downloaded code again. It refuses
the code if its SHA-256 differs from the hash in the registry scan.

Check that the registry is current (this example runs in the docs check):

```sh run
node scripts/build-plugin-registry.mjs --check
```

## The signed registry

The owner signs the exact bytes of `index.json` with an Ed25519 key that stays
on the owner's machine. Because `index.json` lists the SHA-256 of every
version's code and manifest, that one signature covers every file a user can
install.

```sh
node scripts/build-plugin-registry.mjs --keygen ~/keys      # once: a new key; prints the VITE_PLUGIN_TRUSTED_KEYS value
LUMEN_PLUGIN_SIGNING_KEY=~/keys/lumen-plugin-registry.pem node scripts/build-plugin-registry.mjs --sign
```

Set the printed `VITE_PLUGIN_TRUSTED_KEYS` in the build's environment. The app
trusts only that key, or a key you trusted yourself under Settings. The public
key written in `index.json.sig` is never trusted on its own.

When a folder has `index.json.sig`, **Install** takes the signed path
(`src/plugins/install.ts`), and each step can refuse the install:

1. `index.json` and `index.json.sig` are downloaded. The downloads are listed
   in the privacy ledger.
2. The signature over `index.json` must verify against a trusted key. One
   changed byte anywhere in `index.json` fails here.
3. The manifest and the code are downloaded, and each SHA-256 must match the
   signed `index.json`.
4. The code is scanned. Then it runs in its QuickJS sandbox with the
   permissions the manifest declares, as listed on the permission screen.

**Remove** stops the sandbox, deletes what the plugin stored and deletes its
install record and permissions.

A registry from another site is installed only through this path, and an
unsigned one is refused. Only the folder that ships with the app
(`/plugins/examples`), served from the app's own origin, falls back to the
SHA-256 check against its scan when it has no `index.json.sig`.

## Themes tested in RTL (W12.S6)

Every theme in the gallery (`public/themes/examples/`) is reviewed like a
plugin version with only a stylesheet (the review on the
[Security](/security/) page: licence, public source, no remote CSS), and then
checked for right-to-left use. `node scripts/themes/rtl-check.mjs` writes its
scorecard to `public/themes/examples/scorecards/<id>@<version>.json`;
`--check` fails when one is stale, and `--css <file>` checks one stylesheet.

- **Physical CSS.** `margin-left`, `padding-right`, `left:`/`right:`,
  one-sided borders and corners, `float`, `clear` and `text-align` with
  `left`/`right` break a Hebrew layout. Each one is reported with the
  logical property to use instead (`margin-inline-start`, `text-align:
  start`, …). A rule scoped to one direction (`[dir="rtl"] …`, `:dir(ltr)`)
  is allowed.
- **Contrast** (WCAG 2.2, 1.4.3): the theme's text colours against its
  backgrounds, 4.5:1, in light and in dark. The app's own colours fill in
  whatever the theme leaves unset.
- **Screens.** Eight screens (editor, preview, table, lists, callouts, code
  inside Hebrew, Bases, settings) are captured in RTL and in LTR by a
  browser run, merged with `--screens <results.json>`.

A failing RTL check is a warning on the scorecard, not a delisting: each
finding costs the score what any review warning costs (10 points). The
**Tested in RTL** badge is given only when all three pass, so it waits for
the browser run. There are no user ratings: ratings need accounts and
moderation, and the scorecard and the badge do that job.

## A registry site of its own

The same registry can be published as a static site of its own on Cloudflare
Pages, the second host. A developer outside the project can then get a plugin
listed with a pull request, without waiting for an app release.

```sh
npm run registry:site                 # builds dist-registry/ (it first checks that index.json and scan.json are current)
npm run registry:verify -- dist-registry
npx wrangler pages deploy dist-registry --project-name lumen-md-plugins --branch main
npm run registry:verify -- https://lumen-md-plugins.pages.dev
```

The site holds:

- `v1/index.json`: every plugin and every version that passed its scan, with
  its permissions, its scan grade and findings, and the SHA-256 and size of
  each file. A version that failed its scan is left out.
- `v1/plugins/<id>/<version>/`: the files. They are served as text and never
  rewritten, so they can be cached forever.
- `SHA256SUMS`, in the format `sha256sum -c` reads.
- `index.html`: the list, in Hebrew and English, with no scripts.
- `_headers`: `nosniff`, read-only CORS, and a CSP that allows nothing to run.

`registry:verify` recomputes every hash and **scans every version again**
on your machine. A host that changed a file, or that lists a version the scan
would refuse, fails the check. The site fits the free plan with room to
spare: 40 files of the 20,000 allowed, 4 header rules of the 100 allowed.

The app still reads the registry it ships (`/plugins/examples`). Reading this
site from the app is a separate step, because the app's CSP would need its
address.

## Not yet

- The registry that ships with the app is **not signed yet**: signing it needs
  the owner's key (`--keygen`, then `--sign`, above), so its cards still show
  the “unsigned” note. See also [Plugin signing keys](/plugins/signing/).
- The registry site (`npm run registry:site`) does not publish `index.json.sig`
  yet, and the app does not read that site yet.
