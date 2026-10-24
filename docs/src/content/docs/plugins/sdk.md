---
title: Plugin SDK
description: Build a Lumen plugin with create-lumen-plugin — a manifest, one JavaScript file, a bundle you can install or sign.
---

A Lumen plugin has three parts:

- a manifest, `lumen-plugin.json`
- one JavaScript file that runs in Lumen's sandbox
- a bundle file, `.lumenplugin.json`, that users install

There is no build step and no framework.

## Start

```bash
npx create-lumen-plugin my-plugin     # or: node packages/create-lumen-plugin/bin.js my-plugin
cd my-plugin
npm run pack                          # → dist/<id>-<version>.lumenplugin.json
```

To try it, open Lumen → **Plugins** → **Install from file…**, pick the bundle, and tick the permissions it needs.

## The manifest

```json
{
  "schema": 1,
  "id": "dev.example.my-plugin",
  "name": "My plugin",
  "version": "0.1.0",
  "description": "…",
  "author": "You",
  "license": "MIT",
  "main": "main.js",
  "capabilities": [
    { "id": "document:read", "reason": "To count the words of the open note" },
    { "id": "commands", "reason": "Adds the “My plugin” command" }
  ]
}
```

Ask only for what the plugin needs. The user sees every capability with your reason, and each one starts unticked.

## The code

```js
await lumen.commands.register({ id: "run", label: "My plugin" }, async () => {
  const text = await lumen.document.getText();
  await lumen.notifications.show(`${text.length} characters`);
});
```

The code is an ES module running in QuickJS. It has no `fetch`, no DOM and no `import`. Panels and rendered blocks are trees of elements that Lumen draws. The full surface is in [Plugin API](/plugins/api/), and the rules are in [Sandbox and permissions](/plugins/sandbox/).

## Signing

`npm run pack:signed` signs the bundle with your Ed25519 key. Users who trust your key (see [Plugin signing keys](/plugins/signing/)) see the plugin as verified. An unsigned bundle installs only after an "unverified" warning.

## Examples

`public/plugins/examples/` holds three examples:

- `word-stats`: a command, a panel and settings
- `outline`: a panel that edits the note
- `callout`: a code-block renderer that uses storage

`node scripts/build-plugin-registry.mjs` packs them into the first-party registry.
