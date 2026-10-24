# Security headers: one source

Every Content-Security-Policy and security header Lumen ships is written once, in
[`security/policy.json`](../../security/policy.json), and rendered into the files each
host reads by [`scripts/headers.mjs`](../../scripts/headers.mjs) (plan 0.17).

```sh
npm run headers         # check (CI): exit 1 + a directive-level diff when any copy differs
npm run headers:write   # rewrite the policy values in place in every source
```

A host's exceptions (`hosts.<host>.csp` in the policy) are rules on a route's directives:
`omit` drops whole directives, `remove` drops single sources from a directive, and `add`
appends sources. They apply in that order.

`--write` replaces header **values** only. Each file keeps its own structure, comments and
formatting. The check also fails on problems `--write` cannot fix, and these need a hand
edit once:

- a route with no block in a file;
- a CSP that applies to the wrong route (for example, a new page the Vercel catch-all
  does not exclude);
- a required header that is missing;
- a framed runner page that gets `X-Frame-Options`;
- a `<meta>` CSP in an HTML page the policy does not list.

For `public/_headers` and `vercel.json`, the script emulates the host. It works out which
headers each route's sample paths (`routes.*.samples`) really receive and maps each CSP
line to its route from that result. For nginx, `sources[file].blocks` names the route of
each `location`.

The build-time endpoint extension (`src/build/cspEndpoints.ts`) still runs on the
**built** copies: `dist/index.html`, `dist/_headers` and the nginx
`__CSP_CONNECT_EXTRA__` placeholder. It never touches the sources, so it and this check
cannot conflict. It still leaves `connect-src 'none'` (the live-js runner) untouched,
which `headersPolicy.test.ts` checks.

## Routes

| Route | Kind | Paths | `_headers` | `vercel.json` | `docker/nginx.conf` | `deploy/nginx.conf` | meta | Tauri |
|---|---|---|---|---|---|---|---|---|
| `app` | document | everything else | `/*` | catch-all regex | `location /` | `http` level | `index.html` | `app.security.csp` |
| `playground-runner` | document, framed by the app | `/playground-runner.html` | own block | own entry | own location | own location | none (see open items) | n/a |
| `livejs-runner` | document, framed by the app | `/livejs-runner.html` | own block | own entry | own location | own location (new) | `livejs-runner.html` | n/a |
| `tesseract` | worker | `/tesseract/*` | own block | own entry | own location | own location (new) | n/a | n/a |
| `eval-workers` | worker | `/assets/{graphviz,ruby,tsCheck}.worker-*`, `/webr/*` | own blocks (`/webr/*` new) | own entries (`/webr/` new) | assets regex + runtimes location | assets regex (new) + runtime include | n/a | n/a |

## Inventory before 0.17

These are the CSPs per route and per source, compared with the policy chosen below.
"=" means identical.

| Route | `_headers` | `vercel.json` | `docker/nginx.conf` | `deploy/nginx.conf` | meta | Tauri |
|---|---|---|---|---|---|---|
| app | = | = | different (D1), and never served (D2, D3) | **none** (D4) | = (trailing `;` only) | different (D5) |
| playground-runner | = | = | = | = | none | n/a |
| livejs-runner | = | = | = | **none** (meta only) | = without `frame-ancestors` | n/a |
| tesseract | = | = | = | **none** | n/a | n/a |
| eval-workers `/assets/*.worker-*` | = | = | = | **none** | n/a | n/a |
| eval-workers `/webr/*` | **app policy** (D6) | **app policy** (D6) | = except `base-uri` | **none** | n/a | n/a |

These are the other security headers on the app document:

| Header | `_headers` | `vercel.json` | `docker/nginx.conf` | `deploy/nginx.conf` |
|---|---|---|---|---|
| X-Frame-Options | DENY | DENY | DENY (never served, D2) | **SAMEORIGIN** (D7) |
| Referrer-Policy | strict-origin-when-cross-origin | same | same (never served) | same |
| Permissions-Policy | `interest-cohort=(), geolocation=(self), microphone=(self), camera=(self)` | same | **none** | `camera=(), microphone=(self), geolocation=()` (D8) |
| X-Content-Type-Options | nosniff | nosniff | nosniff (never served) | nosniff |
| Strict-Transport-Security | 2 years, subdomains, preload | same | none | none |
| COOP / COEP | none | none | none | `same-origin` / `credentialless` (D9) |

## Differences and decisions

The rule: the canonical policy for a route is the strictest one the app actually needs.
Nothing that was stricter is loosened without the reason given here. On every web host,
index.html's meta CSP is enforced next to the header, and Tauri's policy is enforced next
to it as well. So the effective policy is always the intersection of the two.

- **D1 · docker app CSP drifted from all the others.** It had scheme-less
  `fonts.googleapis.com` / `fonts.gstatic.com`, no `cdn.tldraw.com` font, no `media-src`,
  and `frame-src 'self' blob: https:`. It had no `base-uri`, `form-action`,
  `frame-ancestors` or Trusted Types. **The `_headers` / `vercel.json` / meta policy wins.**
  - The https-only font hosts and `base-uri` / `form-action` / `frame-ancestors` / Trusted
    Types are stricter.
  - tldraw loads its default assets from cdn.tldraw.com (`src/ui/CanvasTldraw.tsx` sets
    no `assetUrls`).
  - Documents may contain `<video>` / `<audio>` that pass the sanitizer, with https: or
    blob: sources.
  - The embed block frames `data:text/html` (gist) and only the listed embed origins
    (`src/plugins/EmbedBlock.tsx`). Nothing frames `blob:`, so the explicit list replaces
    the blanket `https:`.
- **D2 · docker's app headers never reached the page.** They sat at server level, but
  `location /` has its own `add_header Cache-Control`. A location with any `add_header`
  inherits none from the server. Checked with nginx 1.24: `/` and every SPA route were
  served with `Cache-Control` only. The headers now live in `location /`.
- **D3 · docker's app CSP was malformed.** It was split over lines with `\`. nginx keeps
  the backslash and the bare newline in the header value, which was confirmed by serving
  it. It is now one line.
- **D4 · deploy/nginx.conf (root Dockerfile, fly.toml) sent no CSP header for the app,
  the live-js runner, the OCR worker or the eval workers.** Only the meta tag applied, and
  workers had no policy at all. The image now sends the same policies as every other host.
  nginx 1.24 checked the config and the served headers.
- **D5 · Tauri.**
  - `'unsafe-eval'` dropped. Tauri sends this policy with `.html` assets only (tauri 2.12
    `manager::get_asset`, `is_html`). Workers never got it, and the page was already held
    to no-eval by index.html's meta.
  - `img-src asset: tauri:` dropped. Nothing uses the asset protocol (`convertFileSrc`),
    and the meta blocked it anyway.
  - `frame-src https:` replaced by the embed list. The meta enforced that list anyway.
  - `font-src https://cdn.tldraw.com` added (tldraw, as D1).
  - `connect-src` gets the full app list, plus `ipc:` and `http://ipc.localhost` (Tauri 2
    IPC on macOS/Linux and on Windows). 0.17 kept `https:` there as an exception; plan 2.1
    removed it (see "Desktop (Tauri)" below).
- **D6 · webR's worker lost eval on Cloudflare and Vercel.** The F4/P3 change gave eval to
  `/assets/*.worker-*` only. `/webr/webr-worker.js` fell under the app policy (no eval,
  Trusted Types). R.js evaluates side modules' EM_ASM code and `webr::eval_js()`
  (`emscripten_run_script_int`) with `eval`, and `scripts/copy-webr.mjs` assumes the
  policy grants it. The docker image already did. **docker wins:** `/webr/*` joins
  `eval-workers` on every host. That route allows no network beyond `'self'` and keeps
  `base-uri 'none'`, which docker's copy lacked.
- **D7 · X-Frame-Options SAMEORIGIN → DENY on the deploy image.** DENY is stricter.
  Nothing frames the app, and the framed runner pages carry no X-Frame-Options on any
  host (`frame-ancestors 'self'` instead).
- **D8 · Permissions-Policy.** The deploy image's `camera=()` / `geolocation=()` win.
  Nothing in the app uses either: `getUserMedia` is audio-only in
  `src/ui/VoiceDictation.tsx`, and there is no `navigator.geolocation`. Cloudflare's
  `interest-cohort=()` is kept. The result is
  `interest-cohort=(), geolocation=(), microphone=(self), camera=()` everywhere, and
  docker gains it.
- **D9 · COOP/COEP stay on the deploy image only.** This is a documented per-host
  exception, not a stricter-or-looser choice. It enables cross-origin isolation, and so
  multi-threaded WebAssembly. Its cost is that cross-origin iframes which do not send COEP
  (most of the embed list) cannot load there. See open items.
- **Runner documents on nginx** now also carry Referrer-Policy and Permissions-Policy.
  Cloudflare and Vercel always sent them through the catch-all.

## Per-host exceptions

These are written in `policy.json` under `hosts`.

| Host | Exception | Why |
|---|---|---|
| meta | no `frame-ancestors` | ignored in `<meta>` (CSP3), and browsers log an error |
| meta | no Trusted Types | enforced by the production response headers only. The dev server, Tauri and Capacitor have not been verified under them |
| Tauri | no `frame-ancestors`, no Trusted Types | a top-level window is never framed (on Linux Tauri injects the policy as `<meta>`). Trusted Types as for meta |
| Tauri | `connect-src` + `ipc:` `http://ipc.localhost` | Tauri 2 IPC. No `https:`: the list is the app's explicit one. A build with deployment endpoints adds them with `--tauri-config` (below) |
| Tauri | `img-src` and `media-src` without `https:` | the desktop app loads images only from itself and the hosts the app needs. Images and media inside notes stay unloaded there (below) |
| docker nginx | `connect-src` + `__CSP_CONNECT_EXTRA__` | filled by `docker/Dockerfile.web` from `dist/.csp-connect-extra` |
| nginx (both) | no HSTS | plain-HTTP listener behind the operator's TLS terminator. `includeSubDomains; preload` on someone else's domain is their call |
| deploy nginx | COOP `same-origin`, COEP `credentialless` | cross-origin isolation (D9). COEP goes on every document and worker it serves |

## Desktop (Tauri)

Plan 2.1 leaves no open scheme in the desktop policy. It has no `unsafe-eval`, and
`connect-src`, `img-src`, `media-src` and `frame-src` allow only `'self'` (plus `data:` /
`blob:` where the app makes them) and named hosts.

- **`connect-src`** is the app's list plus Tauri's IPC. Tauri enforces index.html's meta
  policy next to its own, so the `https:` that 0.17 kept there never allowed anything the
  meta did not. Its only purpose was build-time endpoint origins. These origins come from
  `VITE_*_ENDPOINT` and `VITE_CSP_CONNECT_EXTRA`. The Vite build adds them to the meta but
  cannot add them to `tauri.conf.json`, which the Rust build compiles in. The release
  workflow sets none of them. A desktop build that does set them passes the matching policy
  to the Tauri CLI:

  ```sh
  npm run build    # with the deployment's VITE_* variables; writes dist/.csp-connect-extra
  npm run tauri:build -- --config "$(node scripts/headers.mjs --tauri-config dist/.csp-connect-extra)"
  ```

  `tauri build --config` merges the JSON over `tauri.conf.json`. `headersPolicy.test.ts`
  checks what the script prints. The desktop build itself has not been run with it.
- **`img-src`** is `'self' data: blob:` plus the hosts the app itself loads images from:
  - tldraw's icons and embed icons, from `cdn.tldraw.com` (also CSS `mask-image`);
  - the map block's tiles, from `*.tile.openstreetmap.org`;
  - account avatars, from `avatars.githubusercontent.com` and `*.googleusercontent.com`.
  
  The web policies list the same hosts and keep a trailing `https:` for images inside
  notes. The desktop policy drops that `https:`, so images from other sites in a note do
  not load on desktop.
- **`media-src`** is `'self' blob:`. `<video>` / `<audio>` from other sites in a note do
  not play on desktop.
- **Not checked here:** rendering inside the desktop app (Graphviz, Python, OCR, the
  canvas icons, map tiles). It is the owner's manual check in plan 15.8.

## Not covered, and open items for the owner

1. **The playground runner has no `<meta>` CSP**, so the Vite dev server, Tauri and
   Capacitor run it unprotected. Its policy also lacks the WebKit nonce that the live-js
   runner needed (`'self'` does not match in an opaque-origin frame), so it may be blocked
   in Safari on the web hosts too. The build already stamps `nonce="lumen-livejs-runner"`
   on every page's scripts. Adding `'nonce-lumen-livejs-runner'` to the route and a meta
   copy is likely the fix, but it needs a Safari check first.
2. **Vercel does not get the build-time endpoint origins.** `vercel.json` is read from
   the repo, not from `dist/`. On a Vercel deployment with `VITE_*_ENDPOINT`, the header
   blocks those workers while the meta allows them. The options are to list them in
   `vercel.json`, or to move Vercel to a build-generated config.
3. **The deploy image's COOP/COEP.** It buys threads for WebAssembly, but blocks
   YouTube, Vimeo and similar embeds, and severs `window.opener` for popups. Decide
   whether it should stay, become opt-in, or spread to the other hosts.
4. **Other worker scripts and the service worker.** Cloudflare and Vercel give them the
   app policy through the catch-all. On nginx, `location /assets/` and `sw.js` carry no
   CSP, because their own `add_header` lines drop the inherited ones. Unify them after the
   workers (transformers, webllm, search, lua, hebrewSpell, the service worker) are
   verified under the app's Trusted Types.
5. **webR on Cloudflare/Vercel (D6)** is decided from the runtime's code. Run an R block
   that calls `webr::eval_js()` on a preview deployment to confirm.
6. **The extension and VS Code webview policies** (`extension/`, `packages/vscode-lumen`)
   and the srcdoc sandboxes' inline policies are separate surfaces, and are not part of
   this policy.
7. **Images and media inside notes on desktop.** Since plan 2.1 the desktop app loads none
   from other sites. If they should load on desktop as they do on the web, remove the
   Tauri rule that drops `https:` from `img-src` / `media-src`. The renderer's own gate
   (plan 2.2) still holds them back until the user allows them.
8. **Desktop builds with deployment endpoints** use `--tauri-config` (see "Desktop
   (Tauri)"). This has not been tried in a real desktop build.
