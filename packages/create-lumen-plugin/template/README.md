# __PLUGIN_TITLE__

A [Lumen](https://github.com/talstilkol/lumen-md) plugin.

- `lumen-plugin.json` — the manifest: id, version, and the **capabilities** the plugin asks for, each with a reason the user sees before granting it. Nothing is allowed by default.
- `main.js` — the plugin. It runs in Lumen's sandbox (QuickJS): no `fetch`, no DOM, no `import`; only the `lumen` API. UI is a tree of elements Lumen renders (no HTML).

```bash
npm run pack          # → dist/<id>-<version>.lumenplugin.json
```

In Lumen: **Plugins → Install from file…**, pick the file, tick the permissions.

Sign it (optional) with an Ed25519 key, so users who trust your key see it as verified:

```bash
openssl genpkey -algorithm ed25519 -out ed25519-private.pem
openssl pkey -in ed25519-private.pem -pubout        # publish this public key
npm run pack:signed
```

Docs: *Plugins → Plugin API* and *Sandbox and permissions*.
