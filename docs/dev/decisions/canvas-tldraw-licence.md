# Canvas: tldraw needs a licence key in production (plan 1.9)

**Status:** measured 18.10.2026; decision pending (plan 15.10). Default plan: move the canvas to Excalidraw (MIT), task 4.19.

## What the licence says

tldraw 4.5.10 (`src/ui/CanvasTldraw.tsx`) is under the *tldraw license*. Without a key, it allows use only in development environments; it says: "Not to use the Software in Production Environments." Production needs a trial or commercial licence key. There is no free production tier. The software checks the key, and it "may transmit usage data to tldraw for license compliance".

## What the code does (read from `node_modules/@tldraw/editor/dist-esm/lib/license/LicenseManager.mjs`)

- "Development" means any of: not `https:`, `localhost`, or `NODE_ENV !== "production"` (line 59). This is why local tests never see the behaviour below.
- In production without a key, the editor calls `fetch()` on `https://cdn.tldraw.com/<version>/watermarks/watermark-track.svg` (lines 32, 80–96). The query string carries `url=window.location.href`, `license_type` and `environment`. Nothing catches the request.
- The editor also loads fonts and assets from `cdn.tldraw.com` by default.

## What Lumen allowed

- `public/_headers` permits `https://cdn.tldraw.com` in both `connect-src` and `font-src`, so the beacon succeeds on the public deployment.
- Before this change, the privacy ledger did not track `cdn.tldraw.com`. The beacon was therefore invisible, even under local-only.

## Done in 1.9

- The privacy ledger now tracks `cdn.tldraw.com` in a new category, `third-party`. The label reads "Third-party service — the page address is sent" and is translated into en plus 7 locales.
- Local-only blocks it like other off-device traffic.
- Remaining before release: either a licence key (15.10) or the move to Excalidraw (4.19). The second option also removes the CDN fonts and assets.
