# Spike: Obsidian plugins in Lumen's sandbox (W13.L3)

<!-- Numbers from research/obsidian-shim-spike.json; src/__tests__/obsidianShimSpike.test.ts checks they agree. -->

**Question.** Lumen could load community Obsidian plugins through a compatibility layer. How many would load and work?

**Setup.**
- The layer is `packages/lumen-obsidian-shim` (MIT; written from Obsidian's public API documentation, with no Obsidian code). It is an `obsidian` module over Lumen's own capability-checked plugin API:
  - `Plugin`, `Notice`, `Modal`, `Setting`, `PluginSettingTab`, `Vault`, `MetadataCache`, `Workspace`, `Editor`, `FileManager.processFrontMatter`, `moment`;
  - an element tree in place of the DOM.
- Each plugin's real bundle (`main.js`) ran in Lumen's QuickJS sandbox with the default limits, against a test note and vault. The plugin was given the open note, the vault, commands, toasts and storage, and no network.
- The 71 plugins are every distinct community plugin installed in the public vaults on disk in this environment. The list could not be chosen from the community list, because the network to GitHub was refused. The same refusal is why licences are mostly unverified (see below).

**Result: 10 of 71 work (14%), 17 more load (24%), and 44 fail (62%).**
- **Works:** the plugin loads, its `onload` finishes, it adds a command or processor, every command runs on the test note, and its settings tab draws.
- **Loads:** `onload` finishes, but nothing runnable was added or a command failed.
- **Higher limits** (256 MB, 10 s) give the same counts: 10 / 17 / 44. The sandbox limits are not what stops these plugins.
- **MIT subset:** licences were verified only where the licence text is on disk. 2 plugins are verified MIT, and 0 of them work.

Why the others do not work:

| Reason | Plugins |
| --- | --- |
| an Obsidian or DOM API the layer lacks | 20 |
| CodeMirror 6 editor extensions (require('@codemirror/…')) | 14 |
| Node or Electron (fs, path, child_process, …): desktop-only | 13 |
| adds no command or processor (views, sidebars, CSS only) | 6 |
| engine: the bundle does not parse or run in this QuickJS build | 6 |
| a vault operation Lumen keeps from plugins (rename, delete) | 1 |
| other | 1 |

## Decision

**Do not ship Obsidian compatibility as a product feature now. Keep the layer as a porting aid, and decide again with the numbers below.** The plan's bar was about 30% working, and 14% work today. The groups are not equal:
- **Cannot move in a sandbox: 27 plugins.**
  - CodeMirror 6 editor extensions (14) need the live editor, and a sandboxed plugin never touches it. Opening that would undo the plugin security model (W1.20, W11.S14).
  - Node and Electron plugins (13) are desktop-only by design.
- **Could move: 20 plugins with an API gap**, often deep access to Obsidian's own workspace DOM (`getElementById`, `cssRules`, `viewByType`), plus 6 that do not parse or finish loading on this environment's QuickJS 0.23.
- **The ceiling** with every movable plugin fixed is 44 of 71 (62%). That is enough to justify a re-measure, but not to promise compatibility.
- **What works today** is one kind of plugin: commands over the note and the vault, settings, notices and modals. Those are easy to port by hand onto Lumen's API.

So:
1. `packages/lumen-obsidian-shim` stays as a developer tool: run an Obsidian plugin's bundle to see what it needs (the "missing" list names every API it reached).
2. No "install from the Obsidian community" button in the app.
3. Go/no-go again after two changes: the QuickJS 0.32 build, and triage of the API-gap group. **Go** if at least 30% of a verified-MIT list of 50 works.

## Owed
- **Licence verification.** Check each plugin's licence on its repository, with network, and re-run with an MIT-only list of 50 from the community list: `OBSIDIAN_SPIKE_LIST=<file of plugin folders> OBSIDIAN_SPIKE_WRITE=1` on the spike test.
- **Engine version.** Re-run on QuickJS 0.32, which the app pins. 5 plugins fail here only because this environment's 0.23 build does not parse or run them.

## The table

| id | name | version | bundle KB | licence | verdict | commands ok | reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| advanced-canvas | Advanced Canvas | 6.0.1 | 360 | GPL-3.0 | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| advanced-cursors | Advanced Cursors | 0.5.1 | 782 | unverified | loads | 4/11 | 7/11 commands failed: open-regex-match-modal: TypeError: not a function |
| ai_llm | AI LLM | 1.1.3 | 31 | unverified | fails | 0/0 | evaluate: Error: require('fs') is not available in Lumen's sandbox |
| buttons | Buttons | 0.9.13 | 186 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| calendar | Calendar | 1.5.10 | 138 | unverified | loads | 1/3 | settings tab: TypeError: not a function |
| calendar-bases | Calendar Bases | 0.2.8 | 421 | unverified | fails | 0/0 | evaluate: TypeError: cannot read property 'cssRules' of undefined |
| cm-editor-syntax-highlight-obsidian | Editor Syntax Highlight | 0.1.3 | 4197 | unverified | fails | 0/0 | evaluate: ReferenceError: 'CodeMirror' is not defined |
| cmdr | Commander | 0.5.4 | 137 | unverified | works | 1/1 | — |
| cooklang-viewer-and-editor | Cooklang | 0.1.0 | 465 | unverified | works | 3/3 | — |
| customjs | CustomJS | 1.0.12 | 23 | unverified | loads | 0/0 | adds nothing runnable |
| darlal-switcher-plus | Quick Switcher++ | 2.0.4 | 242 | unverified | loads | 8/8 | settings tab: TypeError: cannot read property 'viewByType' of undefined |
| dataview | Dataview | 0.5.41 | 2287 | MIT | fails | 0/0 | onload: ReferenceError: 'atob' is not defined |
| doc-preview | Doc Preview | 1.0.15 | 2125 | unverified | fails | 0/0 | evaluate: Error: require('child_process') is not available in Lumen's sandbox |
| dynamic-outline | Dynamic Outline | 1.19.0 | 37 | unverified | loads | 0/1 | 1/1 commands failed: toggle-dynamic-outline: TypeError: not a function |
| editing-toolbar | Editing Toolbar | 4.1.10 | 811 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/language') is not available in Lumen's sandbox |
| file-explorer-note-count | File Explorer Note Count | 1.2.4 | 33 | unverified | loads | 0/0 | adds nothing runnable |
| file-explorer-plus | File Explorer++ | 1.3.1 | 115 | unverified | loads | 2/4 | 2/4 commands failed: toggle-global-pin-filters: TypeError: not a function |
| folder-notes | Folder notes | 1.8.26 | 324 | unverified | loads | 14/15 | 1/15 commands failed: create-folder-note: Error: renaming files is not available to Obsidian plugins in Lumen |
| frontmatter-links | Frontmatter Links | 1.2.7 | 58 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/language') is not available in Lumen's sandbox |
| frontmatter-modified-date | Update modified date | 1.5.2 | 14 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| graph-banner | Graph Banner | 2.3.0 | 10 | unverified | loads | 0/0 | adds nothing runnable |
| heatmap-calendar | Heatmap Calendar | 0.7.1 | 16 | unverified | loads | 0/0 | adds nothing runnable |
| highlightr-plugin | Highlightr | 1.2.2 | 146 | unverified | fails | 0/0 | onload: ReferenceError: 'addEventListener' is not defined |
| homepage | Homepage | 4.4.0 | 58 | unverified | fails | 0/0 | evaluate: TypeError: parent class must be constructor |
| hot-reload | Hot Reload | 0.1.8 | 4 | unverified | fails | 0/0 | evaluate: Error: require('fs') is not available in Lumen's sandbox |
| hotkeysplus-obsidian | Hotkeys++ | 0.2.7 | 55 | unverified | loads | 10/11 | 1/11 commands failed: toggle-readable-length: TypeError: not a function |
| image-converter | Image Converter | 1.4.3 | 2669 | unverified | fails | 0/0 | evaluate: Error: require('path') is not available in Lumen's sandbox |
| journals | Journals | 3.6.0 | 2291 | unverified | fails | 0/0 | load: plugin obsidian.journals failed to load: SyntaxError: invalid escape sequence in regular expression |
| js-engine | JS Engine | 0.3.3 | 241 | unverified | fails | 0/0 | load: plugin obsidian.js-engine failed to load: InternalError: unconsistent stack size: 2 3 (pc=191) |
| local-media-embedder | Local Media Embedder | 0.1.4 | 120 | unverified | fails | 0/0 | evaluate: Error: require('fs') is not available in Lumen's sandbox |
| longform | Longform | 2.0.1 | 1159 | unverified | loads | 12/13 | 1/13 commands failed: longform-show-view: TypeError: not a function |
| meld-calc | Meld Calc | 1.0.2 | 1001 | unverified | works | 1/1 | — |
| metadata-menu | Metadata Menu | 0.8.11 | 980 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/state') is not available in Lumen's sandbox |
| metaedit | MetaEdit | 1.8.4 | 171 | unverified | fails | 0/0 | evaluate: Error: require('fs') is not available in Lumen's sandbox |
| obsidian-admonition | Admonition | 9.0.3 | 1325 | unverified | works | 4/4 | — |
| obsidian-banners | Banners | 1.3.3 | 147 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| obsidian-contextual-typography | Contextual Typography | 2.2.5 | 16 | unverified | works | 0/0 | — |
| obsidian-dynamic-toc | Dynamic Table of Contents | 0.0.27 | 10 | unverified | works | 1/1 | — |
| obsidian-excalidraw-plugin | Excalidraw | 1.7.8 | 2010 | AGPL-3.0 | fails | 0/0 | timed out while loading |
| obsidian-excel-to-markdown-table | Excel to Markdown Table | 0.4.0 | 7 | unverified | works | 1/1 | — |
| obsidian-icon-folder | Iconize | 2.14.7 | 399 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| obsidian-image-toolkit | Image Toolkit | 1.4.3 | 146 | unverified | fails | 0/0 | evaluate: Error: require('crypto') is not available in Lumen's sandbox |
| obsidian-jupyter | Jupyter plugin | 0.8.1 | 282 | unverified | fails | 0/0 | evaluate: Error: require('child_process') is not available in Lumen's sandbox |
| obsidian-kanban | Kanban | 1.3.11 | 676 | unverified | fails | 0/0 | onload: TypeError: not a function |
| obsidian-latex | Extended MathJax | 0.3.0 | 32 | unverified | fails | 0/0 | onload: ReferenceError: 'MathJax' is not defined |
| obsidian-meta-bind-plugin | Meta Bind | 1.4.6 | 1292 | unverified | fails | 0/0 | load: plugin obsidian.obsidian-meta-bind-plugin failed to load: InternalError: unconsistent stack size: 2 3 (pc=150) |
| obsidian-minimal-settings | Minimal Theme Settings | 8.2.1 | 31 | unverified | fails | 0/0 | onload: TypeError: not a function |
| obsidian-reminder-plugin | Reminder | 1.1.12 | 1438 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/state') is not available in Lumen's sandbox |
| obsidian-show-file-path | Show Current File Path | 0.5.2 | 40 | unverified | fails | 0/0 | evaluate: Error: require('path') is not available in Lumen's sandbox |
| obsidian-sortable | Sortable | 0.3.1 | 18 | unverified | loads | 0/0 | adds nothing runnable |
| obsidian-style-settings | Style Settings | 1.0.9 | 151 | unverified | fails | 0/0 | onload: TypeError: not a function |
| obsidian-tasks-plugin | Tasks | 1.11.0 | 296 | MIT | fails | 0/0 | evaluate: Error: require('@codemirror/view') is not available in Lumen's sandbox |
| obsidian-zotero-desktop-connector | Zotero Integration | 3.2.1 | 977 | unverified | fails | 0/0 | evaluate: Error: require('node:process'): unknown module |
| omnisearch | Omnisearch | 1.32.0 | 710 | unverified | fails | 0/0 | load: plugin obsidian.omnisearch failed to load: SyntaxError: invalid property name |
| open-vscode | Open vault in VS Code | 1.4.2 | 8 | unverified | fails | 0/0 | evaluate: Error: require('child_process') is not available in Lumen's sandbox |
| oz-clear-unused-images | Clear Unused Images | 1.1.1 | 8 | unverified | works | 2/2 | — |
| oz-image-plugin | Ozan's Image in Editor Plugin | 2.1.3 | 148 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/state') is not available in Lumen's sandbox |
| pdf-plus | PDF++ | 0.40.31 | 1063 | unverified | fails | 0/0 | evaluate: TypeError: out-of-bound numeric index |
| periodic-notes | Periodic Notes | 0.0.17 | 176 | unverified | loads | 0/0 | settings tab: TypeError: not a function |
| pexels-banner | Pixel Banner | 3.6.18 | 1114 | unverified | loads | 10/10 | settings tab: TypeError: cannot set property 'type' of null |
| quick-latex | Quick Latex for Obsidian | 2.3.3 | 280 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/state') is not available in Lumen's sandbox |
| quickadd | QuickAdd | 2.12.0 | 4165 | unverified | loads | 3/3 | settings tab: TypeError: cannot read property 'getElementById' of undefined |
| recent-files-obsidian | Recent Files | 1.7.6 | 53 | unverified | fails | 0/0 | onload: TypeError: not a function |
| scales-chords | Scales and Chords | 1.0.1 | 38 | unverified | works | 0/0 | — |
| simple-canvasearch | Simple CanvaSearch | 1.0.2 | 6 | unverified | works | 1/1 | — |
| table-editor-obsidian | Advanced Tables | 0.17.3 | 2706 | unverified | fails | 0/0 | evaluate: Error: require('@codemirror/state') is not available in Lumen's sandbox |
| tag-many | TagMany | 0.2.7 | 3 | unverified | loads | 0/0 | adds nothing runnable |
| tag-wrangler | Tag Wrangler | 0.5.3 | 1034 | unverified | fails | 0/0 | onload: TypeError: not a function |
| tasknotes | TaskNotes | 4.16.0 | 4246 | unverified | fails | 0/0 | load: plugin obsidian.tasknotes failed to load: SyntaxError: invalid escape sequence in regular expression |
| templater-obsidian | Templater | 1.12.0 | 217 | AGPL-3.0 | fails | 0/0 | evaluate: Error: require('child_process') is not available in Lumen's sandbox |
| text-extractor | Text Extractor | 0.7.0 | 2967 | unverified | fails | 0/0 | evaluate: Error: require('os') is not available in Lumen's sandbox |
