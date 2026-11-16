# App Store privacy label — draft (W11.S13)

<!-- Written by scripts/privacy/store-labels.mjs from store/privacy-labels.json. Do not edit by hand. Submission: W11.O7. -->

**Data used to track you:** None

**Data collected:** **Data Not Collected**. The developer receives nothing with the default settings: With the default settings (no cloud key, no sync provider, no crash-reporting key in the build) nothing leaves the device: the local-only audit shows 0 non-local requests.

## The one optional collection

| Category | Type | Linked to you | Tracking | Only when |
|---|---|---|---|---|
| Diagnostics | Crash Data | No | No | Only in a build made with a crash-reporting key (VITE_SENTRY_DSN), and only after the user turns error reports on (Settings; off by default, refused under the local-only policy). A report holds the error's class name and where in the code, never its message, note text, titles, paths or the page address (src/lib/telemetry.ts). |
| Diagnostics | Performance Data | No | No | Only with an error tracker (VITE_SENTRY_DSN, or one the user sets) and only after the user turns performance reports on (Settings → Security; off by default, a separate switch from error reports, plan W11.S19). One report per session with counts of web-vitals ratings per metric; no timings, no page address. |

If the build is made without `VITE_SENTRY_DSN`, the label is "Data Not Collected" with no exceptions.

## What the user can send, by their own choice, to a service they chose

Everything under optionalFeatures is sent by the user's own choice to the service the user set up (their own key or account); the developer receives none of it, except error reports, which go to whoever runs the error tracker the build names (VITE_SENTRY_DSN).

| Feature | Sends | Turned on by | Ledger routes |
|---|---|---|---|
| Cloud AI (OpenAI, Anthropic, Google Gemini, Mistral) | The text you send to the AI | Your own API key and the cloud or local-first AI policy; refused under local-only | `OpenAI`, `Anthropic (Claude)`, `Google Gemini`, `Mistral`, `Ollama on a remote server`, `LM Studio on a remote server` |
| Cloud grammar check (LanguageTool) | The text being checked | A policy other than local-only; refused under local-only | `LanguageTool grammar check` |
| Research service | Your search query | Running a research command with a research service configured; refused under local-only | `Research service`, `Agent tool`, `Zotero Web API (your library; writes only the PDF highlights you send)`, `OpenAlex: the references of a DOI (citation graph, only when you turn it on)`, `CrossRef DOI lookup: the DOI you asked for only` |
| Canvas (tldraw) licence check | The page address | Opening a canvas in a production build; refused under local-only | — |
| Model and dictionary downloads (Hugging Face, GitHub) | Nothing of yours (a download) | Choosing a local model or a dictionary | `Model download (Hugging Face)`, `Model download (Lumen's mirror)`, `Dictionary / OCR model download (GitHub)`, `webR (R runtime) download` |
| Canvas fonts, icons and translations | Nothing of yours (static files) | Opening a canvas | — |
| Error reports (Sentry / GlitchTip) | The error's class name and where in the code it happened; no error message, note text, titles, paths or page address | Turning error reports on in Settings (off by default), in a build made with VITE_SENTRY_DSN; refused under local-only | `Error report (Sentry / GlitchTip), content removed` |
| Plugins' network requests | Whatever the plugin's request carries, to the destination the plugin names | Installing a plugin and granting it network access; refused under local-only | `Plugin`, `Plugin registry download (signed index, manifest, code); no user data` |
| Outside MCP servers you add | A request for the list of that server's tools; what a tool call sends is listed as the agent's tool request | Adding and enabling a remote MCP server in Settings → MCP servers, then "Show tools" or an agent run that uses it; not in airplane mode, and refused under local-only | `MCP server` |
| Other requests in audit mode | Whatever that request carries; listed so an audit can compare | Audit mode only (lumen.privacy.audit) | `Other request (audit mode)` |
| Encrypted sync (WebDAV, S3, Dropbox, Google Drive) | Ciphertext only, to the storage you chose | Connecting a sync provider | `Sync storage: your Dropbox (audit mode)`, `Sync storage: your Google Drive (audit mode)` |
| Backups to your WebDAV server | The vault archive, encrypted (age) or plain as you choose, to the server you set; a plain one is readable there | Setting up a WebDAV backup in Backups (encrypted is the first choice); a plain backup is refused under local-only | `Plain backup to your WebDAV server (the vault archive, not encrypted)` |
| Diagrams (PlantUML, rendered by kroki.io) | The diagram's source | Confirming the first time a diagram would be sent; refused under local-only | `PlantUML rendering (kroki.io)` |
| Read aloud and dictation with the browser's speech service | The text read aloud, or your voice | Choosing a network voice, or dictation under the cloud policy after a confirmation; refused under local-only | `Read aloud (`, `Dictation through the browser's speech service`, `Browser speech recognition (Web Speech API)` |
| Public sources (Sefaria, the Knesset, government data) | Only the reference or search words you asked for; nothing from your notes | Searching one of these sources, after you agree to that search; under local-only too, listed as consented in the ledger | `Jewish sources (Sefaria): the reference only`, `Knesset records (OData): the law or bill name only`, `Government data (data.gov.il, CBS): the search words or dataset id only` |
| Wikidata (entity linking) | The name of the entity you asked to link; nothing from your notes | Searching Wikidata, after you agree (this once, or always on this device); refused under local-only, whatever you agreed | `Wikidata search: the entity name only` |
| Web clipper | A request for the page you clip | Clipping a page; refused under local-only | `Web clipper — fetches the page you clip` |
| Publishing to Bluesky (Standard.site) | The note you publish, publicly, and your login for that session | Confirming a publish; refused under local-only | `Publish to the AT Protocol (Standard.site), your PDS`, `AT Protocol identity lookup (plc.directory)` |
| Calendar connections (CalDAV, ICS) | Your tasks and credentials to your calendar server; a read request for a subscription | Setting up a connection; refused under local-only | `CalDAV task sync (your calendar server)`, `Calendar subscription (ICS, read only)` |
| Themes and CSS snippets | A request for a file the stylesheet names | Installing a theme or snippet; refused under local-only | `A stylesheet (theme or CSS snippet) loaded it` |
| Desktop update check | The app version and platform only | Running "Check for updates" in the desktop app; not under local-only | `Desktop update check (app version and platform only)` |
| CDN requests that should not happen | A file request; listed as a warning so a stray request is visible | Nothing: each is a bug when it appears | `jsDelivr CDN (only the webR download is expected)`, `Excalidraw font fallback CDN (not needed: fonts are served locally)` |
