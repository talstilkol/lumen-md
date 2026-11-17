# Google Play Data safety — draft (W11.S13)

<!-- Written by scripts/privacy/store-labels.mjs from store/privacy-labels.json. Do not edit by hand. Submission: W11.O7. -->

**Does your app collect or share any of the required user data types?** **No data collected or shared**

**Is all of the user data collected by your app encrypted in transit?** Yes

**Deletion:** Nothing is held by the developer; all data is on the device.

## Optional collection

| Data type | Optional | Only when |
|---|---|---|
| App info and performance: Crash logs | Yes | Only in a build made with a crash-reporting key (VITE_SENTRY_DSN), and only after the user turns error reports on (off by default, refused under the local-only policy). |
| App info and performance: Diagnostics | Yes | Only with an error tracker and only after the user turns performance reports on (off by default, separate from error reports): counts of web-vitals ratings per session, no timings. |

## To confirm at submission

Play counts data the app sends off the device. The routes below are each started by the user, go to a service the user chose (often with their own key or account), and send nothing to the developer. Whether each falls under Play's exceptions for user-initiated transfers to a third party the user chose is for the owner to confirm in the Play Console (W11.O7). If one doesn't, its row moves to "collected" or "shared" there.

| Feature | Sends | Turned on by |
|---|---|---|
| Cloud AI (OpenAI, Anthropic, Google Gemini, Mistral) | The text you send to the AI | Your own API key and the cloud or local-first AI policy; refused under local-only |
| Cloud grammar check (LanguageTool) | The text being checked | A policy other than local-only; refused under local-only |
| Research service | Your search query | Running a research command with a research service configured; refused under local-only |
| Canvas (tldraw) licence check | The page address | Opening a canvas in a production build; refused under local-only |
| Model and dictionary downloads (Hugging Face, GitHub) | Nothing of yours (a download) | Choosing a local model or a dictionary |
| Canvas fonts, icons and translations | Nothing of yours (static files) | Opening a canvas |
| Plugins' network requests | Whatever the plugin's request carries, to the destination the plugin names | Installing a plugin and granting it network access; refused under local-only |
| Outside MCP servers you add | A request for the list of that server's tools; what a tool call sends is listed as the agent's tool request | Adding and enabling a remote MCP server in Settings → MCP servers, then "Show tools" or an agent run that uses it; not in airplane mode, and refused under local-only |
| LaTeX to PDF with Tectonic (desktop) | Tectonic's own requests for TeX packages it has not cached: your IP address and the package names, never the document | Exporting a PDF from LaTeX in the desktop app with Tectonic installed, after allowing its downloads once; cache only (no request) in airplane mode and under local-only |
| Other requests in audit mode | Whatever that request carries; listed so an audit can compare | Audit mode only (lumen.privacy.audit) |
| Encrypted sync (WebDAV, S3, Dropbox, Google Drive) | Ciphertext only, to the storage you chose | Connecting a sync provider |
| Backups to your WebDAV server | The vault archive, encrypted (age) or plain as you choose, to the server you set; a plain one is readable there | Setting up a WebDAV backup in Backups (encrypted is the first choice); a plain backup is refused under local-only |
| Diagrams (PlantUML, rendered by kroki.io) | The diagram's source | Confirming the first time a diagram would be sent; refused under local-only |
| Read aloud and dictation with the browser's speech service | The text read aloud, or your voice | Choosing a network voice, or dictation under the cloud policy after a confirmation; refused under local-only |
| Public sources (Sefaria, the Knesset, government data) | Only the reference or search words you asked for; nothing from your notes | Searching one of these sources, after you agree to that search; under local-only too, listed as consented in the ledger |
| Wikidata (entity linking) | The name of the entity you asked to link; nothing from your notes | Searching Wikidata, after you agree (this once, or always on this device); refused under local-only, whatever you agreed |
| Web clipper | A request for the page you clip | Clipping a page; refused under local-only |
| Publishing to Bluesky (Standard.site) | The note you publish, publicly, and your login for that session | Confirming a publish; refused under local-only |
| Calendar connections (CalDAV, ICS) | Your tasks and credentials to your calendar server; a read request for a subscription | Setting up a connection; refused under local-only |
| Themes and CSS snippets | A request for a file the stylesheet names | Installing a theme or snippet; refused under local-only |
| Desktop update check | The app version and platform only | Running "Check for updates" in the desktop app; not under local-only |
| CDN requests that should not happen | A file request; listed as a warning so a stray request is visible | Nothing: each is a bug when it appears |
