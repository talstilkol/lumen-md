# Contributing a Plugin (γ.6)

Lumen plugins live in [`@lumen-md/lumen-plugins-registry`](https://github.com/lumen-md/lumen-plugins-registry)
(separate repo). This repo only ships the runtime + the schema.

## TL;DR

1. Build your plugin with `create-lumen-plugin`:

   ```bash
   npm create lumen-plugin@latest my-plugin
   cd my-plugin && npm install && npm run build
   ```

2. Generate an Ed25519 signing key:

   ```bash
   mkdir -p ~/.lumen
   openssl genpkey -algorithm Ed25519 -out ~/.lumen/author-ed25519.key
   ```

3. Open the registry PR via the publish CLI:

   ```bash
   GITHUB_TOKEN=ghp_… node scripts/publish-plugin.mjs \
     --dir ./my-plugin \
     --key ~/.lumen/author-ed25519.key \
     --bundle-url https://cdn.example.com/my-plugin/1.0.0/index.js \
     --gh-pr lumen-md/lumen-plugins-registry
   ```

   The CLI computes SHA-256, signs the bundle with your Ed25519 key,
   creates a branch, commits the patched `registry.json`, and opens
   the PR with bundle URL + signature in the body.

## What the registry-side validate.yml does

When your PR lands at `lumen-plugins-registry`, this Action runs:

```yaml
# .github/workflows/validate.yml — drop this in the registry repo.
name: validate
on:
  pull_request:
    paths: [registry.json]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Validate registry shape
        run: |
          node -e '
            const reg = require("./registry.json");
            for (const p of reg.plugins) {
              if (!p.id || !p.version || !p.bundle || !p.sha256 || !p.signature) {
                throw new Error("missing required field on " + p.id);
              }
            }
            console.log("✓ shape OK (" + reg.plugins.length + " plugins)");
          '
      - name: Verify Ed25519 signatures
        run: node .github/scripts/verify-signatures.mjs
      - name: Scan bundles for malicious patterns
        run: node .github/scripts/scan-bundles.mjs
      - name: Auto-merge when all checks pass
        if: success()
        uses: pascalgn/automerge-action@v0.16.4
```

A reference implementation of the two scripts lives in
`scripts/verify-signatures.mjs` and `scripts/scan-bundles.mjs` in the
registry repo. Both have ~80 lines of Node — feel free to fork.

## Security model

- The registry is **public** — anyone can read; only signed PRs can
  modify.
- Each registry entry carries the bundle's SHA-256 + an Ed25519
  signature from the author's key. Lumen verifies the signature in
  the browser (`src/plugins/signing.ts`) before executing the
  bundle.
- A bundle that fails signature verification is shown in the gallery
  but disabled with a warning — the user can override but the UI
  makes it impossible to install accidentally.
- The bundle runs inside a sandboxed iframe with `allow-scripts`
  but **no** `allow-same-origin` — the plugin can't read OPFS or
  cookies directly. All host calls go through the postMessage
  broker.

## What we reject

- Plugins requesting any DOM permission Lumen doesn't offer.
- Plugins making outbound HTTP requests not declared in
  `permissions`.
- Plugins fetching ESM at runtime (any `import()` whose specifier
  isn't a string literal).
- Plugins that ship pre-minified code without a sourcemap when
  `permissions` includes `network` — too easy to hide hostile code
  in a minified blob.

## Naming + IDs

`id` must match `^[a-z][a-z0-9-]{2,40}$`. We squat-park common IDs
the same way npm does: if the id matches an active project's name
without their permission, the PR is rejected with a 1-line "claim
your namespace" instruction.

## License

MIT-only for plugins in the official registry. If you need a
different license, host your bundle yourself and ship as a 3rd-party
plugin (the gallery shows a 🌐 icon for those + a clear "not from
the official registry" warning).
