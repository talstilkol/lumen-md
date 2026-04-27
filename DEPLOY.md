# Lumen — Launch Deploy Guide

Eight blockers stand between "feature complete" and "Lumen 1.0 live to the
public." This document walks each one in order, with the **exact commands**
and **exact dashboard clicks** required. Most are external-account work — the
code is done.

> **Roughly 3 working days** if you sequence them as listed.

---

## 0. Prerequisites (one-time, ~30 min)

- [ ] Buy `lumen.app` (or whichever domain) — Cloudflare Registrar / Namecheap.
- [ ] Cloudflare account (free) — used for DNS + Workers.
- [ ] Stripe account (free until you start billing).
- [ ] Apple Developer Program ($99/yr).
- [ ] Google Play Developer ($25 one-time).
- [ ] Sentry account (free tier).
- [ ] Supabase project (free) — already optional; required for billing/sync/publish.
- [ ] Chrome Web Store registration ($5 one-time).

---

## 1. Signaling server for collab (P1-09) — 30 min

Lumen falls back to `wss://signaling.yjs.dev` (Yjs's public server). For
launch, run your own so a public outage doesn't disable collab.

```bash
cd sync-server
npm install
# Test locally
PORT=4444 node server.js

# Deploy to Fly.io (free):
brew install flyctl
fly launch --name lumen-signal     # accept defaults
fly deploy
# → wss://lumen-signal.fly.dev/
```

Update `.env.production`:

```
VITE_WEBRTC_SIGNALING_URL=wss://lumen-signal.fly.dev,wss://signaling.yjs.dev
```

(Comma-separated → first one is primary, second is fallback.)

---

## 2. Persistent collab server (P2-03) — 30 min

Same Fly.io flow with the y-websocket starter:

```bash
cd sync-server
npm install y-websocket y-leveldb level
fly launch --name lumen-collab --dockerfile  # generate Dockerfile
fly volumes create yjs_data --region iad --size 1
# Mount the volume in fly.toml:
#   [[mounts]]
#   source = "yjs_data"
#   destination = "/data"
fly deploy
```

`.env.production`:

```
VITE_YJS_WEBSOCKET_URL=wss://lumen-collab.fly.dev
```

---

## 3. CSP + headers in production (DONE — verify only)

`index.html` ships a strict CSP that allows the 16 embed providers, OpenAI,
Stripe, Supabase, Dropbox, LanguageTool. After deploy, add HTTP headers via
your host:

**Cloudflare Pages** (recommended) — drop a `_headers` file:

```
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: interest-cohort=(), geolocation=(self), microphone=(self), camera=(self)
```

Run `npm run build && wrangler pages deploy dist`.

---

## 4. Stripe billing edge worker (P2-05) — 1 hour

Code is in `edge-workers/billing/worker.ts`. Configure + deploy:

```bash
# 4a. Create the Supabase entitlements table (one-time)
psql "<your-supabase-conn-string>" <<EOF
create table if not exists entitlements (
  user_id uuid primary key references auth.users on delete cascade,
  tier text not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  renews_at bigint,
  updated_at timestamptz default now()
);
EOF

# 4b. Create Stripe products + prices
# https://dashboard.stripe.com/products → New product → "Lumen Pro" → $8/mo
# https://dashboard.stripe.com/products → New product → "Lumen Team" → $16/seat/mo
# Copy the price IDs into src/billing/checkout.ts:
#   PRICE_IDS = { pro: "price_…", team: "price_…" }

# 4c. Deploy worker
cd edge-workers/billing
npm i -g wrangler
wrangler login
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE
wrangler deploy
# → https://lumen-billing.<your>.workers.dev

# 4d. Wire the Stripe webhook to /webhook on that URL via the Stripe Dashboard.
# 4e. Set client env:
#   VITE_BILLING_ENDPOINT=https://lumen-billing.<your>.workers.dev/checkout
```

---

## 5. Publish edge worker (P3-08) — 30 min

Read-mode publishing. Same shape as the billing worker:

```bash
cd edge-workers/publish
wrangler kv:namespace create PUBLISHED
# → paste id into wrangler.toml under [[kv_namespaces]]
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE
wrangler deploy

# Client env:
#   VITE_PUBLISH_ENDPOINT=https://lumen-publish.<your>.workers.dev
```

---

## 6. Cloud sync (Dropbox) — 1 hour (P2-04)

```bash
# 6a. Register a Dropbox app:
# https://www.dropbox.com/developers/apps → Create app
# Permissions: "App folder" + files.content.write + files.content.read
# Redirect URIs: https://lumen.app/oauth/dropbox

# 6b. Set env:
#   VITE_DROPBOX_APP_KEY=<your-app-key>

# 6c. Test:
# In Lumen → Settings → Cloud sync → Connect Dropbox → OAuth flow → done.
```

---

## 7. Mobile (P2-07) — ~2 days calendar (a few hours work)

### iOS

```bash
# 7a. macOS prereq
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -license accept

# 7b. Sync + open
npm run ios:open

# 7c. In Xcode:
#   Signing & Capabilities → set Team to your Apple Developer team.
#   Bundle ID stays com.lumen.editor (or change).
#   Increment "Build" number on every TestFlight upload.

# 7d. Archive + upload
#   Product → Destination → "Any iOS Device (arm64)"
#   Product → Archive
#   Distribute App → App Store Connect → Upload
#   Wait ~10 min for processing → add to internal TestFlight group.

# 7e. Submit for review
#   App Store Connect → My Apps → Lumen → "+ Version" → fill metadata
#   Submit (typically 24–72 h review).
```

### Android

```bash
# 7a. Prereq
brew install --cask android-studio
# Set ANDROID_HOME after first launch.

# 7b. Add Android platform
npm install @capacitor/android
npx cap add android
npm run android:open

# 7c. In Android Studio:
#   Build → Generate Signed Bundle / APK → Android App Bundle (.aab)
#   Create keystore (KEEP IT — losing it locks you out of updates).
#   release variant → app-release.aab.

# 7d. Upload to Play Console (https://play.google.com/console).
```

---

## 8. Web app deploy (Cloudflare Pages) — 15 min

```bash
# 8a. Connect repo to Cloudflare Pages:
# https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git

# 8b. Build settings:
#   Framework: Vite
#   Build command: npm run build
#   Output: dist
#   Env vars: paste every VITE_* from steps 1–7

# 8c. Custom domain:
#   Pages → lumen-app → Custom domains → Add → lumen.app
```

PWA service worker auto-updates clients on next visit.

### Marketing site (`/landing.html`) — same deploy

The landing page lives at `public/landing.html` and ships in the same Pages
deploy. Audit:

- [ ] Replace placeholder screenshots with real ones (use `npm run preview`
      to capture).
- [ ] `<title>` + Open Graph meta on every social card.
- [ ] Run `npx lhci autorun` and confirm Lighthouse Performance ≥ 90,
      Accessibility ≥ 95, SEO ≥ 95.

---

## 9. Tauri macOS — sign + notarize (15 min)

```bash
# 9a. Apple Developer ID Application certificate (one-time):
# https://developer.apple.com/account/resources/certificates/add
# Type: Developer ID Application

# 9b. App-specific password:
# https://appleid.apple.com → Sign-in & Security → App-Specific Passwords

# 9c. Build
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDEF1234"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABCDEF1234)"
npm run tauri:build

# 9d. Verify
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Lumen.app
spctl -a -t exec -vv      src-tauri/target/release/bundle/macos/Lumen.app
# Both should report "accepted" with "Notarized".
```

Upload `Lumen_*.dmg` to the GitHub Release that `release.yml` already
created from your tag push.

---

## 10. Chrome Web Store (Web Clipper) — 30 min

```bash
# 10a. Generate icons (16/32/48/128 PNG) — use any of the existing favicons:
cd extension/icons
# (manually create 16x16.png, 32x32.png, 48x48.png, 128x128.png)

# 10b. Zip
cd ..
zip -r lumen-clipper-0.1.0.zip extension/* -x "*.DS_Store"

# 10c. Upload
# https://chrome.google.com/webstore/devconsole → Add new item
# Upload zip, fill description, screenshots, privacy policy URL.
# Review takes 2-7 days.
```

---

## Post-launch checklist

After every step above is green:

- [ ] All 9 Playwright E2E pass on CI Mac runner (chromium / firefox / webkit).
- [ ] Lighthouse: Performance ≥ 90, A11y ≥ 95, Best practices ≥ 95, SEO ≥ 95, PWA ≥ 90.
- [ ] axe-core a11y test passes (no critical/serious violations).
- [ ] `npm run budget` passes — bundle still within targets.
- [ ] Sentry receiving events from at least one production session.
- [ ] First 10 users invited via TestFlight + Play Internal track.
- [ ] `https://lumen.app/p/<test-slug>` returns a published note.
- [ ] Right-click → "Save selection to Lumen" creates a clip.
- [ ] Subscribe → return to app → Pro features unlock.
- [ ] `⌘K → "AI: Switch to local AI"` downloads + serves answers offline.

---

## Rollback plan

Every step is independently reversible:

| Step | Rollback |
| --- | --- |
| Signaling | Remove `VITE_WEBRTC_SIGNALING_URL` → falls back to public Yjs |
| Persistent collab | Remove `VITE_YJS_WEBSOCKET_URL` → WebRTC-only |
| Stripe | Disable `VITE_BILLING_ENDPOINT` → entitlements default to Free |
| Publish | Remove `VITE_PUBLISH_ENDPOINT` → publish command throws "offline" |
| Dropbox | Remove `VITE_DROPBOX_APP_KEY` → cloud sync UI hidden |
| Mobile | App Store / Play "Take down" controls |
| macOS DMG | Re-upload signed binary via `release.yml` |
| Chrome | Disable in Web Store dashboard |

The web app survives every backend going down — local-first by design.

---

Ready to launch.
