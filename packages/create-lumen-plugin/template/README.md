# __PLUGIN_TITLE__

A Lumen plugin scaffolded with `create-lumen-plugin`.

## Develop

```bash
npm install
npm run dev
```

The bundler watches `src/` and rebuilds `dist/__PLUGIN_NAME__.js` on save.

## Try it in Lumen

Open Lumen → `⌘K` → **Plugin gallery** → **Load unpacked** → pick
`dist/__PLUGIN_NAME__.js`. Lumen reloads the plugin every time the file
changes — perfect for the dev loop.

## Customise

- **Add a new block type** → `src/block.tsx`. Lumen mounts your component
  whenever the user types ` ```your-language ` followed by source.
- **Add a command** → in `src/index.ts` register another
  `api.registerCommand({...})` — it shows up in `⌘K` and the palette.
- **Listen to document changes** → `api.onDocChange((content) => ...)`.
- **Read / write the workspace** is intentionally NOT exposed by default
  — request the `workspace-read` / `workspace-write` permissions in
  `lumen-plugin.json` and the user gets an explicit approval prompt.

## Publish to the registry

1. `npm run build`.
2. Open a PR against
   [public/plugins/registry.json](https://github.com/your-org/lumen) with a
   new entry pointing at the JSDelivr URL of your release.
3. Lumen's Plugin Gallery picks it up automatically.

## License

MIT — yours to do with as you please.
