# Security headers: one source

Every Content-Security-Policy and security header Lumen ships is written once, in
[`security/policy.json`](../../security/policy.json), and rendered into the files each
host reads by [`scripts/headers.mjs`](../../scripts/headers.mjs) (plan 0.17).

```sh
npm run headers         # check (CI): exit 1 + a directive-level diff when any copy differs
npm run headers:write   # rewrite the policy values in place in every source
```

`--write` replaces header **values** only. Each file keeps its own structure, comments and
formatting. The check also fails on problems `--write` cannot fix, and these need a hand
edit once:

- a route with no block in a file;
- a CSP that applies to the wrong route (for example, a new page the Vercel catch-all
  does not exclude);
- a required header that is missing;
- a framed runner page that gets `X-Frame-Options`;
- a `<meta>` CSP in an HTML page the policy does not list.

For `public/_headers` and `deploy/vercel.base.json`, the script emulates the host. It works out which
headers each route's sample paths (`routes.*.samples`) really receive and maps each CSP
line to its route from that result. For nginx, `sources[file].blocks` names the route of
each `location`.

The build-time endpoint extension (`src/build/cspEndpoints.ts`) still runs on the
**built** copies: `dist/index.html`, `dist/_headers`, the nginx
`__CSP_CONNECT_EXTRA__` placeholder, and the same placeholder in the Vercel config,
which `vercel.ts` fills at build time (see below). It never touches the sources, so it and this check
cannot conflict. It still leaves `connect-src 'none'` (the live-js runner) untouched,
which `headersPolicy.test.ts` checks.

## Routes

| Route | Kind | Paths | `_headers` (Cloudflare, Netlify) | Netlify edge function | `deploy/vercel.base.json` | `deploy/nginx.conf` (the one nginx image, 13.2) | meta | Tauri |
|---|---|---|---|---|---|---|---|---|
| `app` | document; also the other workers under `/assets/` and the service worker | everything else | `/*` | n/a | catch-all regex | `http` level, `location /assets/`, `location = /sw.js` (0.20) | `index.html` | `app.security.csp` |
| `playground-runner` | document, framed by the app | `/playground-runner.html` | own block (Cloudflare detaches the catch-all; Netlify cannot) | own entry, drops `X-Frame-Options` (13.2) | own entry | own location | `playground-runner.html` (0.20) | n/a |
| `livejs-runner` | document, framed by the app | `/livejs-runner.html` | own block | own entry (13.2) | own entry | own location (new) | `livejs-runner.html` | n/a |
| `tesseract` | worker | `/tesseract/*` | own block | n/a | own entry | own location (new) | n/a | n/a |
| `eval-workers` | worker | `/assets/{graphviz,ruby,tsCheck}.worker-*`, `/webr/*` | own blocks (`/webr/*` new) | n/a | own entries (`/webr/` new) | assets regex (new) + runtime include | n/a | n/a |

Until 13.2 there were two nginx configs (`docker/nginx.conf` for the compose bundle, `deploy/nginx.conf` for the Fly image); the compose bundle now builds the same image (see [docs/self-hosting/hosting](../src/content/docs/self-hosting/hosting.md)). The inventory below is the state before 0.17 and keeps the old file names.

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
    IPC on macOS/Linux and on Windows). It keeps `https:` as a documented exception, see
    the per-host table.
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
| Tauri | `connect-src` + `ipc:` `http://ipc.localhost` `https:` | Tauri 2 IPC. `https:` because this policy is compiled from tauri.conf.json and cannot receive the deployment's endpoint origins at build time. The meta policy, which does, keeps the page on the explicit list |
| nginx | `connect-src` + `__CSP_CONNECT_EXTRA__` | filled by the `Dockerfile` from `dist/.csp-connect-extra` |
| nginx | no HSTS | plain-HTTP listener behind the operator's TLS terminator. `includeSubDomains; preload` on someone else's domain is their call |
| nginx | COOP `same-origin`, COEP `credentialless` | cross-origin isolation (D9). COEP goes on every document and worker it serves. Since 13.2 this is the compose bundle's image too; keeping it is decision 15.10(7) |
| Netlify | runner pages: `X-Frame-Options` dropped, CSP replaced, by `netlify/edge-functions/runner-headers.ts` | Netlify's `_headers` cannot detach the catch-all rules (13.2); the function's policy strings are a `headers.mjs` source |

## Vercel: endpoint origins at build time (0.20)

A static `vercel.json` is read from the repository, so it could not carry the origins of
the `VITE_*_ENDPOINT` workers a deployment is built with: the header blocked them while
the page's `<meta>` allowed them. Vercel now reads [`vercel.ts`](../../vercel.ts), which
it runs at build time with the project's environment. It loads
`deploy/vercel.base.json` (rendered from the policy and checked like every other source,
with a `__CSP_CONNECT_EXTRA__` placeholder in the app policy's `connect-src`, from
`hosts.vercel`) and replaces the placeholder with the configured origins, or removes it.
The app policy also covers the other workers under `/assets/` and `sw.js` on Vercel, so
their requests to those workers pass too. `vercel.ts` has no imports beyond Node's, and
`src/__tests__/vercelConfig.test.ts` keeps its endpoint rules equal to
`cspEndpoints.ts` and checks the generated config path by path.

## Not covered, and open items for the owner

1. **`vercel.ts` on a real deployment.** It follows Vercel's documented programmatic
   configuration, and its output is tested, but no preview deployment has run it yet
   (the preview deploys are rate-limited). Check the response headers of the first one:
   `curl -sI <preview>/ | grep -i content-security` should list the endpoint origins.
2. **The deploy image's COOP/COEP.** It buys threads for WebAssembly, but blocks
   YouTube, Vimeo and similar embeds, and severs `window.opener` for popups. Decide
   whether it should stay, become opt-in, or spread to the other hosts.
3. **webR on Cloudflare/Vercel (D6).** CI runs the `webr::eval_js()` e2e under the nginx
   headers (job "e2e under deploy headers"), which serve `/webr/` the same eval-workers
   policy as Cloudflare and Vercel. A run on a preview deployment is still to do.
4. **The extension and VS Code webview policies** (`extension/`, `packages/vscode-lumen`)
   and the srcdoc sandboxes' inline policies are separate surfaces, and are not part of
   this policy.

Done in 0.20: the playground runner's `<meta>` copy and WebKit nonce, the build-time
endpoint origins on Vercel, and the CSP of the other workers and `sw.js` on both nginx
images (the app policy, as Cloudflare and Vercel already served them).
