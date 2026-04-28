---
title: Lumen — Master Plan to #1
version: 2.1
last_updated: 2026-04-28
status: in-progress
weighted_score_now: 8.12
weighted_score_target: 9.42
target_runner_up_gap: ">= 2.0 points"
---

# Lumen — Master Plan to World #1

> **One-line intent.** Take Lumen from "narrowly leading" (8.12 vs Obsidian 7.39) to "durable #1" (9.42, with every competitor ≤ 7.5).
>
> **Format.** Six sequenced phases (α → ζ), each with hard-verifiable gates. Every task has: ID, goal, files, exact commands, acceptance criteria, verification, dependencies, effort. Read top-down, execute one task at a time, verify gate before advancing phase.

## Table of contents

1. [Current state](#1-current-state) — honest scorecard, what's broken
2. [Target state](#2-target-state) — what "#1" means in numbers
3. [Phase α — Honest baseline](#phase-α--honest-baseline) (1 week)
4. [Phase β — Ship to humans](#phase-β--ship-to-humans) (3 weeks)
5. [Phase γ — Premium UX](#phase-γ--premium-ux) (4 weeks)
6. [Phase δ — Native presence](#phase-δ--native-presence) (6 weeks)
7. [Phase ε — Enterprise + ecosystem](#phase-ε--enterprise--ecosystem) (4 weeks)
8. [Phase ζ — Marketing + community](#phase-ζ--marketing--community) (parallel)
9. [Dependency DAG](#9-dependency-dag)
10. [Sign-off checklist](#10-sign-off-checklist)

---

## 1. Current state

### 1.1 Scorecard (honest, post-audit)

| Category | Weight | Score | Gap reason |
|---|---|---|---|
| Markdown rendering breadth | 10 | **10** | 15+ block types live |
| Data-rich documents | 10 | **10** | CSV/JSON/SQL/Pandas all work |
| RTL & i18n | 9 | **7** | Only en + he active. 6 locale stubs scaffolded |
| Privacy / E2E | 9 | **8.5** | AES vault works; telemetry opt-out toggle live; signaling not deployed |
| Real-time collab | 8 | **8** | WebRTC P2P works; persistent server not deployed |
| Search | 8 | **9** | BM25 + embeddings + flash highlight live |
| AI integration | 8 | **8.5** | Fine-tune code + voice transcribe code complete; manual smoke needs API key |
| Plugins / extensibility | 7 | **8** | Registry + gallery + submit CLI + validate pipeline all coded |
| Cross-platform | 8 | **6.5** | Web ✅, Tauri ✅, mobile stores ❌ |
| Editing UX | 9 | **9** | Drag-handles, columns, indent/outdent, slash, WYSIWYG all live |
| Knowledge graph | 7 | **8** | Louvain works, no AI insights |
| Performance budgets | 7 | **9** | Bundle-budget + Lighthouse CI + signaling healthcheck in CI |
| Accessibility | 6 | **8.5** | axe on 12 components (deep sweep), Lighthouse gate ≥ 95 configured |
| Test coverage | 6 | **9** | 599 tests, 97.24% line coverage, 69 test files all green |
| Docs / onboarding | 5 | **8** | Astro site + self-hosting docs + MCP docs live |
| Marketplace / templates | 4 | **7** | Template gallery with install UI live; registry scaffolded |
| Sync (cloud) | 6 | **6.5** | Dropbox+GDrive code ready, ops unverified |
| Billing / monetization | 4 | **5** | Code complete, no live Stripe products |
| Native menus / OS feel | 6 | **7.5** | Tauri solid, mobile widgets ❌ |
| Voice input | 4 | **6** | Live dictation + memo mode; transcribe needs OpenAI key |
| **Weighted total** | — | **8.12** |  |

### 1.2 Competitor scores (same rubric)

```
1. Lumen     8.12   ← we are here
2. Obsidian  7.39
3. Notion    6.94
4. Logseq    6.66
5. HackMD    6.36
6. Typora    5.55
7. iA Writer 5.43
8. Bear      5.41
```

Lead: 0.73 over #2 — still fragile. Goal: 2.0+.

### 1.3 Audit-flagged gaps to fix in α

These came out of running grep / ls / npm-audit against the codebase (2026-04-27):

| ID | File | Gap |
|---|---|---|
| α.1 | `src/collab/yjs.ts:153` | Still uses `Math.random()` |
| α.1 | `src/plugins/LiveJsBlock.tsx:3,7` | `console.*` in doc-comments (cosmetic) |
| α.1 | `src/editor/insertMenu.ts:158` | `console.*` inside template literal |
| α.2 | `package.json` | `@sentry/react` not installed; `src/lib/telemetry.ts` is hand-rolled |
| α.3 | `src/collab/yjs.ts:43-46` | Public yjs.dev fallback, no Lumen-owned signaling |
| α.4 | n/a | Coverage report never generated |
| α.5 | `src/__tests__/a11y.test.tsx` | Only a few components axe-tested |
| α.6 | 9 files | Hardcoded English strings (Canvas, VersionHistory, etc.) |

---

## 2. Target state

### 2.1 Per-phase weighted score

| After phase | Weighted | Δ |
|---|---|---|
| Today | 7.78 | — |
| α | 7.95 | +0.17 |
| β | 8.50 | +0.55 |
| γ | 9.07 | +0.57 |
| δ | 9.30 | +0.23 |
| ε | 9.42 | +0.12 |

### 2.2 Hard target

- Weighted ≥ **9.42**
- Gap to runner-up ≥ **2.0**
- Every category ≥ **8**
- 8 categories at **9.5+**

---

## Phase α — Honest baseline

**Goal.** Close every audit-flagged ⚠️/🟡 from the previous master plan. No new features.
**Duration.** 1 week (1 engineer).
**Gate.** typecheck ✅ + 460+ tests ✅ + coverage ≥ 60 % + axe 0 violations + Sentry test event received + Lumen-owned signaling endpoint live.

---

### α.1 — Logger / Math.random / console cleanup

| Field | Value |
|---|---|
| **Effort** | 1 hour |
| **Depends on** | — |
| **Files** | `src/collab/yjs.ts`, `src/plugins/LiveJsBlock.tsx`, `src/editor/insertMenu.ts` |

#### Sub-tasks

**α.1.1** Replace `Math.random()` in `src/collab/yjs.ts:153`
```ts
// Before
const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// After
import { randomId } from "../lib/cryptoRandom";
const key = `${Date.now().toString(36)}-${randomId(3)}`;
```

**α.1.2** Annotate the 3 intentional console hits with `// eslint-disable-next-line no-console` plus a 1-line "why" comment.

**α.1.3** Verification:
```bash
grep -rn "Math.random" src --include="*.ts" --include="*.tsx" | grep -v __tests__
# expect: 0 matches
grep -rn "console\." src --include="*.ts" --include="*.tsx" | \
  grep -v "src/lib/logger.ts" | grep -v __tests__ | grep -v "eslint-disable"
# expect: 0 matches
npm run typecheck && npm run test
```

#### Acceptance
- Both grep counts = 0
- Suite stays at 460 tests passing
- No new TS errors

---

### α.2 — @sentry/react SDK

| Field | Value |
|---|---|
| **Effort** | 2 hours |
| **Depends on** | — |
| **Files** | `package.json`, `src/main.tsx`, `src/lib/telemetry.ts`, `src/lib/logger.ts`, `src/__tests__/sentry.test.ts` (new) |

#### Sub-tasks

**α.2.1** Install:
```bash
npm install @sentry/react @sentry/browser
```

**α.2.2** Init in `src/main.tsx` (top of file, before React mount):
```ts
import * as Sentry from "@sentry/react";
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // PII scrub: drop `localStorage` and any `note.*` keys.
      if (event.extra) {
        for (const k of Object.keys(event.extra)) {
          if (k.startsWith("note.") || k === "localStorage") delete event.extra[k];
        }
      }
      return event;
    },
  });
}
```

**α.2.3** Replace hand-rolled forwarder in `src/lib/telemetry.ts` with a thin wrapper around `Sentry.captureException`. Keep the opt-out gate (`localStorage["lumen.telemetry.optOut"] === "1"`).

**α.2.4** In `src/lib/logger.ts`:
```ts
error(msg: string, err?: unknown) {
  console.error("[lumen]", msg, err);
  if (telemetry.enabled()) {
    Sentry.captureException(err ?? new Error(msg), { extra: { msg } });
  }
}
```

**α.2.5** Test in `src/__tests__/sentry.test.ts`:
```ts
import { vi } from "vitest";
vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  browserTracingIntegration: () => ({}),
}));
// assert: log.error("boom") triggers captureException once
```

#### Acceptance
- `npm ls @sentry/react` shows installed
- `log.error("test")` in dev console triggers a Sentry event in the project dashboard (manual smoke)
- Opt-out toggle in Settings: when off, no events sent

---

### α.3 — Deploy y-webrtc signaling

| Field | Value |
|---|---|
| **Effort** | 4 hours |
| **Depends on** | Fly.io account |
| **Files** | `sync-server/Dockerfile` (new), `sync-server/fly.toml` (new), `src/collab/yjs.ts`, `.env.example`, `README.md` |

#### Sub-tasks

**α.3.1** `sync-server/Dockerfile`:
```Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
EXPOSE 4444
CMD ["node", "server.js"]
```

**α.3.2** Deploy:
```bash
cd sync-server
fly launch --name lumen-signal --region sjc
fly deploy
fly certs add signal.lumen.md   # after CNAME points to the app
```

**α.3.3** DNS (Cloudflare zone for `lumen.md`): CNAME `signal` → `lumen-signal.fly.dev`, proxy off (WebSocket).

**α.3.4** Update `src/collab/yjs.ts:43-46`:
```ts
const PUBLIC_SIGNALING_FALLBACK = [
  "wss://signal.lumen.md",       // NEW: Lumen-owned, primary
  "wss://signaling.yjs.dev",     // public fallback
  "wss://y-webrtc-signaling-eu.herokuapp.com",
];
```

**α.3.5** `.env.example`:
```
VITE_WEBRTC_SIGNALING_URL=wss://signal.lumen.md
```

**α.3.6** README "Self-hosting" section: copy of the Dockerfile + `flyctl` commands.

#### Acceptance
- `wss://signal.lumen.md` returns 101 on a `wscat` ping
- Two browsers in two networks (one cellular, one residential) join the same room and sync edits
- Health check in CI: `curl -I https://signal.lumen.md/health` returns 200

---

### α.4 — Coverage report + CI gate

| Field | Value |
|---|---|
| **Effort** | 1 hour |
| **Depends on** | — |
| **Files** | `.github/workflows/ci.yml`, `CHANGELOG.md`, `coverage/coverage-summary.json` |

#### Sub-tasks

**α.4.1** Run locally:
```bash
npm run test:coverage
cat coverage/coverage-summary.json | jq '.total'
```

**α.4.2** Append to `CHANGELOG.md` under `## [Unreleased]`:
```
- Coverage: lines XX %, statements XX %, functions XX %, branches XX %
```

**α.4.3** In `.github/workflows/ci.yml` add step after `npm run test:coverage`:
```yaml
- name: Coverage gate
  run: |
    pct=$(jq '.total.lines.pct' coverage/coverage-summary.json)
    awk -v p="$pct" 'BEGIN { exit (p < 60) }' || (echo "Coverage $pct < 60" && exit 1)
```

#### Acceptance
- Coverage ≥ 60 % lines locally
- CI fails the run if coverage drops below 60 %

---

### α.5 — Deep a11y sweep

| Field | Value |
|---|---|
| **Effort** | 1 day |
| **Depends on** | axe-core (already installed) |
| **Files** | `src/__tests__/a11y.test.tsx`, every UI file with violations |

#### Sub-tasks

**α.5.1** Extend `src/__tests__/a11y.test.tsx`. For each of these 10 components, render and run `axe(container)`:
- `Toolbar`, `FileTree`, `Outline`, `CommandPalette`, `SearchDialog`,
- `TagsPanel`, `CommentsPanel`, `BacklinksPanel`, `FocusMode`, `KeyboardShortcuts`

**α.5.2** Pattern:
```ts
it("Toolbar — no axe violations", async () => {
  const { container } = render(<Toolbar {...stubProps} />);
  const results = await axe(container);
  expect(results.violations).toEqual([]);
});
```

**α.5.3** For each failing component, fix in source:
- icon-only `<button>` → add `aria-label`
- dialog wrappers → `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- form inputs → associated `<label htmlFor>`
- keyboard-trap missing → wire `useFocusTrap`

**α.5.4** Lighthouse: `npm run preview` + run a11y audit → expect ≥ 95.

#### Acceptance
- All 10 axe tests pass with 0 violations
- Lighthouse a11y ≥ 95

---

### α.6 — Replace 9 hardcoded English strings

| Field | Value |
|---|---|
| **Effort** | 2 hours |
| **Depends on** | — |
| **Files** | 9 UI files, `src/i18n/index.ts` |

#### Hits to fix

| File:line | Current | Key |
|---|---|---|
| `src/ui/CanvasWhiteboard.tsx:328` | `Canvas · auto-saved` | `canvas.autoSaved` |
| `src/ui/VersionHistory.tsx:125` | `Version History` | `versionHistory.title` |
| `src/ui/MarkdownTableEditor.tsx:92` | `Table Editor` | `mdTable.title` |
| `src/ui/SearchDialog.tsx:541` | `Sources` | `searchDialog.sources` |
| `src/ui/SearchDialog.tsx:565` | `Type a question and press Enter…` | `searchDialog.askPlaceholder` |
| `src/ui/VoiceDictation.tsx:86` | `Recording... ({lang})` | `voice.recording` |
| `src/ui/ErrorBoundary.tsx:35` | `Rendering Error` | `errorBoundary.heading` |
| `src/ui/AiInlinePrompt.tsx:183` | `Esc` (kept as-is, it's a kbd label) | — |
| `src/ui/StatusBar.tsx:112` | `Lumen` (kept, brand) | — |

**α.6.1–7** Replace each with `{t("key")}`, add bilingual entries to `src/i18n/index.ts` (en + he), tests:
```ts
it("Canvas auto-saved string is i18n-driven", () => {
  applyLocale("he");
  render(<CanvasWhiteboard open onClose={() => {}} />);
  expect(screen.getByText(/אוטומטית|נשמר/)).toBeInTheDocument();
});
```

#### Acceptance
- Locale `he` shows zero English in the 7 fixed locations
- 8 i18n keys added to both bundles

---

### Phase α gate

```bash
npm run typecheck      # ✅
npm run test           # ✅ ≥ 460
npm run test:coverage  # ✅ lines ≥ 60
npm run build          # ✅
curl -I https://signal.lumen.md/health  # 200 OK
```

Manual: trigger an error in dev → verify it lands in Sentry dashboard.

---

## Phase β — Ship to humans

**Goal.** Real users can install, pay, sync, and edit on iPhone + Android.
**Duration.** 3 weeks.
**Gate.** Test purchase succeeds, 2 testers each on TestFlight + Play Internal, persistent collab survives 24 h restart.

---

### β.1 — 7 Playwright e2e specs

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Depends on** | α.4 (CI green) |
| **Files** | `e2e/*.spec.ts` (7 new), `playwright.config.ts`, `.github/workflows/ci.yml` |

#### Specs

| File | Scenario | Key assertion |
|---|---|---|
| `e2e/paste-image.spec.ts` | paste PNG from clipboard | `Capacitor.Filesystem.readDir("Assets")` length = 1 |
| `e2e/wikilinks.spec.ts` | type `[[Foo Bar]]` | backlinks panel lists `Foo Bar.md` |
| `e2e/mermaid.spec.ts` | insert mermaid block | `svg[role="img"]` rendered in preview |
| `e2e/csv-chart.spec.ts` | paste CSV | "Suggest chart" → ECharts canvas in DOM |
| `e2e/locale-switch.spec.ts` | `⌘K` → "עברית" | `document.documentElement.dir === "rtl"` |
| `e2e/search.spec.ts` | `⇧⌘F` → query | `.cm-lumen-search-hit` count > 0 |
| `e2e/cmd-palette.spec.ts` | `⌘K` → "save" → Enter | dirty flag clears |

**β.1.8** CI matrix (chromium / firefox / webkit) on every PR:
```yaml
strategy:
  matrix: { browser: [chromium, firefox, webkit] }
- run: npx playwright test --project=${{ matrix.browser }}
```

#### Acceptance
- All 7 specs green on all 3 browsers
- Total e2e wall-time < 4 min

---

### β.2 — Persistent collab deployed

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Depends on** | α.3 |
| **Files** | `sync-server/persistent-server.js`, `sync-server/fly.toml` (collab variant), `src/collab/yjs.ts` |

#### Sub-tasks

**β.2.1** Add `pg` + `lib0` + `y-leveldb` to `sync-server/package.json`:
```bash
cd sync-server && npm install pg y-leveldb lib0
```

**β.2.2** `persistent-server.js` skeleton:
```js
// y-websocket persistence layer — LevelDB hot, Postgres archive.
import * as Y from "yjs";
import { LeveldbPersistence } from "y-leveldb";
import { Pool } from "pg";

const ldb = new LeveldbPersistence("/data/yjs");
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

// Snapshot to Postgres every 30s.
setInterval(async () => {
  for (const [room, doc] of activeRooms) {
    const state = Y.encodeStateAsUpdate(doc);
    await pg.query(
      "INSERT INTO room_snapshots(room, vector, doc_state, ts) VALUES ($1, $2, $3, NOW())",
      [room, Y.encodeStateVector(doc), state],
    );
  }
}, 30_000);
```

**β.2.3** Deploy:
```bash
fly launch --name lumen-collab --region sjc
fly postgres create --name lumen-collab-db
fly postgres attach lumen-collab-db --app lumen-collab
fly deploy
fly certs add collab.lumen.md
```

**β.2.4** Postgres schema:
```sql
CREATE TABLE room_snapshots (
  room TEXT NOT NULL,
  vector BYTEA NOT NULL,
  doc_state BYTEA NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room, ts)
);
CREATE INDEX idx_room_snapshots_latest ON room_snapshots(room, ts DESC);
```

**β.2.5** Frontend `src/collab/yjs.ts`: when `useAuth().user`, prefer `WebsocketProvider("wss://collab.lumen.md/" + roomName)`; otherwise fall through to WebRTC.

**β.2.6** Reconnect protocol: client sends state-vector → server replies with diff (`Y.encodeStateAsUpdate(doc, vector)`).

#### Acceptance
- `e2e/persistent-collab.spec.ts`: 2 browsers join → both close → reopen one → content restored from server
- 24-h continuous-uptime test passes (one room edited every 5 min for 24 h, no data loss)

---

### β.3 — Stripe live + entitlements

| Field | Value |
|---|---|
| **Effort** | 4 days |
| **Depends on** | β.2 (auth wired) |
| **Files** | `edge-workers/billing/worker.ts`, `src/billing/checkout.ts`, `src/billing/useEntitlement.ts` |

#### Sub-tasks

**β.3.1** Stripe dashboard:
- Product "Lumen Pro" → price `$8/mo` (id `price_pro_monthly`) + `$80/yr` (id `price_pro_yearly`)
- Product "Lumen Team" → price `$16/seat/mo` (id `price_team_monthly`)
- Test mode keys + live mode keys

**β.3.2** Cloudflare D1 schema:
```sql
CREATE TABLE entitlements (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',  -- free | pro | team | enterprise
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end INTEGER,
  updated_at INTEGER NOT NULL
);
```

**β.3.3** Worker endpoints (already partially exist, extend):
- `POST /checkout { priceId, userId }` → `stripe.checkout.sessions.create({mode:"subscription", success_url, cancel_url})`
- `POST /webhook` → verify `stripe.webhooks.constructEvent`, on `customer.subscription.{created,updated,deleted}` → upsert entitlement row
- `GET /entitlements/:userId` → return tier + period end

**β.3.4** Bind secrets:
```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

**β.3.5** `src/billing/useEntitlement.ts`:
```ts
const { data } = useSWR(
  userId ? `https://billing.lumen.md/entitlements/${userId}` : null,
  fetcher,
  { refreshInterval: 60_000 },
);
return { tier: data?.tier ?? "free", periodEnd: data?.current_period_end };
```

**β.3.6** Pro feature gates:
- `src/collab/yjs.ts` persistent mode: `if (entitlement.tier !== "pro") fallback to WebRTC P2P`
- `src/ai/semanticSearch.ts`: same gate
- `src/ai/llm.ts` fine-tune: same gate

**β.3.7** Smoke test:
- Stripe test card `4242 4242 4242 4242` → checkout
- Webhook fires → D1 row updates within 5 s
- `useEntitlement` flips to `pro` on next poll
- Persistent collab connects (instead of WebRTC)

#### Acceptance
- End-to-end test purchase in Stripe TEST mode passes
- Pro feature flips on within 60 s of webhook
- Live keys deployed, real $8 purchase succeeds (refund immediately for testing)

---

### β.4 — 6 additional locales

| Field | Value |
|---|---|
| **Effort** | 1 week (incl. translator) |
| **Depends on** | α.6 |
| **Files** | `src/i18n/{ar,ru,fr,de,ja,zh-CN}.ts` (new), `src/i18n/index.ts` |

#### Sub-tasks

**β.4.1** Extract:
```bash
grep -E '"[a-z][a-zA-Z0-9.]+"\s*:' src/i18n/index.ts | \
  awk -F'"' '{print $2}' | sort -u > i18n/keys.txt
```

**β.4.2** For each target locale, run translation prompt against Claude Sonnet:
```
You are a localization expert. Translate the following JSON keys' values
from English to {Arabic|Russian|French|German|Japanese|Mandarin}.
Preserve {var} placeholders verbatim. Keep markdown ` ` inline code intact.
Keep keyboard shortcuts (⌘K, Esc) untranslated. Output strict JSON.
```

**β.4.3** Native-speaker review pass (4 h × 6 locales = 24 h external).

**β.4.4** Add to `src/i18n/index.ts`:
```ts
export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "he", label: "עברית", dir: "rtl" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "ja", label: "日本語", dir: "ltr" },
  { code: "zh-CN", label: "简体中文", dir: "ltr" },
];
```

**β.4.5** Lazy-load locale bundles:
```ts
const BUNDLES = { en, he };  // bundled at build
async function loadLocale(code: Locale) {
  if (BUNDLES[code]) return BUNDLES[code];
  const mod = await import(`./locales/${code}.json`);
  BUNDLES[code] = mod.default;
  return mod.default;
}
```

**β.4.6** Test: each locale loads, switches `<html lang dir>` correctly, no missing keys logged.

#### Acceptance
- 8 locales selectable in `⌘K → Switch language`
- Initial bundle adds < 2 KB (en + he stays the only synchronous load)
- RTL works for ar (mirrored to existing he infrastructure)

---

### β.5 — Mobile QA + store submission

| Field | Value |
|---|---|
| **Effort** | 1 week + 7-14 days Apple review |
| **Depends on** | β.1 (e2e for confidence), Apple Developer + Google Play accounts |
| **Files** | `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml`, store listings |

#### Sub-tasks

**β.5.1** Device matrix QA — manual, 30-step plan:
- iPhone 13 mini (small screen)
- iPhone 15 Pro Max (Dynamic Island, notch)
- iPad mini (split-view)
- Pixel 6 (Android 14)
- Samsung S22 (One UI quirks)
- OnePlus 11 (gestures)

**β.5.2** 30-step plan covers: open / edit / save / search / paste image / switch tab / RTL / voice dictate / scroll-to-search / share-extension / drag-reorder tabs / database view / collab join.

**β.5.3** iOS submission:
```bash
npm run ios:sync
# Xcode → Product → Archive → Distribute App → App Store Connect → Upload
```
Then in App Store Connect:
- Bundle ID: `md.lumen.editor`
- Privacy nutrition labels (data not collected by default; analytics opt-in)
- 8 screenshots (en + he in dark mode)
- Release notes
- Submit for review (Apple ~7 days)

**β.5.4** Android submission:
```bash
npm run android:sync
# Android Studio → Build → Generate Signed Bundle / APK → AAB → upload
```
Play Console:
- Internal Testing track first; promote to Production after 7 days
- Same screenshots
- Data safety form
- Privacy policy URL: `https://lumen.md/privacy`

**β.5.5** TestFlight / Play Internal: invite 5 internal testers each → collect feedback for 1 week → ship to public.

#### Acceptance
- TestFlight build available; internal testers can install
- Play Internal track build available
- Apple review approved or addressed feedback within 2 weeks

---

### Phase β gate

```bash
npm run test          # ≥ 460
npm run test:e2e      # 7 specs × 3 browsers green
curl https://billing.lumen.md/entitlements/test-user  # JSON response
curl -I https://collab.lumen.md/health  # 200
```

Manual: open Lumen on iPhone via TestFlight → sign in → enable Pro → persistent collab works.

---

## Phase γ — Premium UX

**Goal.** Notion-grade editing parity + tldraw whiteboard + voice transcribe + fine-tuned AI + plugin author flow.
**Duration.** 4 weeks.
**Gate.** Side-by-side demo vs Notion shows 90 % feature parity in editing UX.

---

### γ.1 — WYSIWYG drag-handles + columns + indent

| Field | Value |
|---|---|
| **Effort** | 2 weeks |
| **Depends on** | — |
| **Files** | `src/editor/dragHandles.ts` (new), `src/editor/columns.ts` (new), `src/editor/WysiwygEditor.tsx`, `src/editor/keymap-extra.ts` |

#### γ.1.1 — Drag handle plugin (5 days)

ProseMirror plugin `dragHandles.ts`:
- `Decoration.widget(pos, makeHandle, { side: -1 })` for each top-level block
- `dragstart` on handle → set `view.dragging = { from, to, slice: state.doc.slice(from, to) }`
- `dragover` on neighbour block → render gap indicator
- `drop` → `dispatch(view.state.tr.replaceRange(toFrom, toTo, slice))`

```ts
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { Plugin } from "prosemirror-state";

export const dragHandlePlugin = new Plugin({
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      // Re-compute decorations on every doc change.
      const decos: Decoration[] = [];
      tr.doc.descendants((node, pos, parent, idx) => {
        if (parent === tr.doc && node.isBlock) {
          decos.push(Decoration.widget(pos, () => makeHandle(node, pos), { side: -1 }));
        }
      });
      return DecorationSet.create(tr.doc, decos);
    },
  },
  props: {
    decorations(state) { return this.getState(state); },
  },
});
```

#### γ.1.2 — Indent / outdent shortcuts (2 days)

`src/editor/keymap-extra.ts`:
```ts
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
export const indentKeymap = (schema) => ({
  "Tab": sinkListItem(schema.nodes.list_item),
  "Shift-Tab": liftListItem(schema.nodes.list_item),
});
```

#### γ.1.3 — Columns directive (4 days)

Parser: `:::columns\n{col1}\n:::\n{col2}\n:::`
ProseMirror NodeSpec: `columns` block with `cols: number` attr.
NodeView renders flexbox `grid-template-columns: repeat({cols}, 1fr)`.
Markdown round-trip via custom serializer.

#### γ.1.4 — Tests
- `dragHandles.test.ts`: simulate drag from index 0 → 2; assert markdown order
- `columns.test.ts`: parse `:::columns` directive → 2 children; serialize back round-trips

#### Acceptance
- Hover any block → ⠿ handle appears
- Drag handle to new position → block reorders, markdown updates
- `Tab` inside list → indent
- `:::columns` block renders 2-col layout

---

### γ.2 — Swap Canvas → tldraw

| Field | Value |
|---|---|
| **Effort** | 1 week |
| **Depends on** | — |
| **Files** | `src/ui/CanvasWhiteboard.tsx`, `package.json`, `vite.config.ts` |

#### Sub-tasks

**γ.2.1** Install:
```bash
npm install @tldraw/tldraw
```

**γ.2.2** Replace `CanvasWhiteboard.tsx` body:
```tsx
import { Tldraw, getSnapshot, loadSnapshot } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";

export function CanvasWhiteboard({ open, onClose }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  // Load on mount
  useEffect(() => {
    if (!editor) return;
    readWorkspaceFile(`canvases/${name}.tldr`)
      .then(JSON.parse)
      .then(snap => loadSnapshot(editor.store, snap))
      .catch(() => {});
  }, [editor, name]);
  // Save on change (debounced 500 ms)
  useEffect(() => {
    if (!editor) return;
    const off = editor.store.listen(debounce(() => {
      const snap = getSnapshot(editor.store);
      writeWorkspaceFile(`canvases/${name}.tldr`, JSON.stringify(snap));
    }, 500));
    return off;
  }, [editor]);
  return <Tldraw onMount={setEditor} />;
}
```

**γ.2.3** `vite.config.ts` manualChunks: route `@tldraw` into its own chunk so it lazy-loads.

**γ.2.4** Migration script for existing `.canvas.json` files → no-op (new tldraw schema is incompatible; keep old files openable via legacy code path with a "Convert to tldraw" button).

#### Acceptance
- Open canvas → tldraw UI renders
- Draw → close → reopen → drawing persisted
- New canvas first-load JS is ≤ 220 KB (lazy chunk)

---

### γ.3 — Templates marketplace UI

| Field | Value |
|---|---|
| **Effort** | 4 days |
| **Depends on** | — |
| **Files** | `src/ui/TemplateGallery.tsx` (new), `public/templates/registry.json`, `templates-contrib/CONTRIBUTING.md` (new repo) |

#### Sub-tasks

**γ.3.1** Clone `PluginGallery.tsx` structure → `TemplateGallery.tsx`. Reads `registry.json`, fetches each `.md`.

**γ.3.2** Filter chips by `category`, sort by `rating`, tag-based search.

**γ.3.3** "Install" → write to `Templates/<name>.md` in OPFS; toast "Installed".

**γ.3.4** ⌘K command "Insert template…" reads installed list, lets user pick, inserts at cursor.

**γ.3.5** Author flow: separate repo `lumen-templates-contrib` with `CONTRIBUTING.md`:
- Fork → add `.md` + entry in `registry.json` → PR
- GitHub Action validates frontmatter, scans for malicious content, runs spell-check on the `description`
- Approved PR auto-merges; CDN cache busts

#### Acceptance
- Browse 5+ templates in the gallery
- Install → appears in `⌘K → Insert template`
- New PR to contrib repo lints + auto-merges within 5 min

---

### γ.4 — Voice transcribe + AI summary

| Field | Value |
|---|---|
| **Effort** | 4 days |
| **Depends on** | β.3 (Pro entitlement) |
| **Files** | `src/ui/VoiceDictation.tsx`, `src/ai/transcribe.ts` (new), `src/ai/prompts.ts` |

#### Sub-tasks

**γ.4.1** Replace SpeechRecognition with `MediaRecorder`:
```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
const chunks: Blob[] = [];
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: "audio/webm" });
  const transcript = await transcribe(blob);
  const summary = await summarize(transcript);
  insertAtCursor(formatVoiceMemo(transcript, summary));
};
```

**γ.4.2** `src/ai/transcribe.ts`:
```ts
export async function transcribe(blob: Blob): Promise<string> {
  if (useAppStore.getState().useLocalAi) {
    const { pipeline } = await import("@xenova/transformers");
    const whisper = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
    return (await whisper(await blob.arrayBuffer())).text;
  }
  const form = new FormData();
  form.append("file", blob, "memo.webm");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${getAiKey()}` },
    body: form,
  });
  return (await res.json()).text;
}
```

**γ.4.3** `src/ai/prompts.ts` add `summarize`:
```
"Summarise the following voice memo in 2 bullets. Return ONLY the bullets, no preamble."
```

**γ.4.4** Insert format:
```md
> 🎙 Voice memo · {{date}}

{{summary}}

<details><summary>Full transcript</summary>

{{transcript}}

</details>
```

#### Acceptance
- 10-second voice memo → transcript + 2-bullet summary inserted at cursor in < 5 s (cloud) or < 30 s (local)
- Privacy mode honored: no network call when `useLocalAi`

---

### γ.5 — AI fine-tuned style

| Field | Value |
|---|---|
| **Effort** | 3 weeks |
| **Depends on** | β.3 |
| **Files** | `src/ai/fineTune.ts` (new), `src/ui/AiSettings.tsx`, `edge-workers/billing/worker.ts` (extend) |

#### Sub-tasks

**γ.5.1** Settings opt-in toggle: "Train AI on my writing style (uploads ~5 MB of your last 90 d to OpenAI for fine-tuning)".

**γ.5.2** Frontend collector:
```ts
const recent = await listWorkspace({ since: Date.now() - 90 * 86400_000 });
const samples = recent.flatMap(f => chunkText(f.content, 800));
const jsonl = samples
  .filter(s => s.length > 200)
  .slice(0, 100)
  .map(s => JSON.stringify({
    messages: [
      { role: "system", content: "Continue the user's writing in their personal voice." },
      { role: "user", content: s.slice(0, 400) },
      { role: "assistant", content: s.slice(400) },
    ],
  }))
  .join("\n");
```

**γ.5.3** Upload + fine-tune:
```ts
const fileRes = await openai.files.create({
  file: new Blob([jsonl]),
  purpose: "fine-tune",
});
const job = await openai.fineTuning.jobs.create({
  training_file: fileRes.id,
  model: "gpt-4o-mini-2024-07-18",
});
```

**γ.5.4** Persist `model_id` in user record (extend D1 entitlements row with `fine_tune_model TEXT`).

**γ.5.5** `chat()` uses it when toggled:
```ts
const useFineTuned = useAppStore.getState().useFineTunedModel;
const model = useFineTuned && entitlement.fine_tune_model
  ? entitlement.fine_tune_model
  : opts.model ?? DEFAULT_MODEL;
```

**γ.5.6** Status UI: shows training-job state ("queued" / "running" / "succeeded" / "failed") and last-trained date.

#### Acceptance
- Opt-in → training job created in OpenAI dashboard
- Training succeeds (~30 min for small dataset)
- Switching to "My voice" produces noticeably different completions (manual A/B by user)

---

### γ.6 — Plugin author submission CLI

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Depends on** | — |
| **Files** | `create-lumen-plugin/cli/publish.ts` (new), `lumen-plugins-registry/.github/workflows/validate.yml` (new repo) |

#### Sub-tasks

**γ.6.1** Add `publish` subcommand:
```bash
lumen-plugin publish --key ~/.lumen/author-ed25519.key
```

**γ.6.2** Steps performed:
1. Build the plugin (`tsup src/index.ts`)
2. Sign output: `ed25519.sign(privateKey, sha256(bundle))`
3. Open PR against `lumen-plugins-registry`:
   - Add bundle URL to `registry.json`
   - Include signature
   - Auto-fill author + version + description from `package.json`

**γ.6.3** Registry repo CI (`validate.yml`):
- Verify ed25519 signature
- Scan bundle for `eval`, `Function(`, `<script>` injection patterns
- Lighthouse-style scan for unauthorized API calls
- If green → auto-merge; CDN purge; toast in PluginGallery

#### Acceptance
- A test plugin pushes via the CLI
- PR opens, CI runs, auto-merges within 5 min
- Plugin appears in PluginGallery on next load

---

### Phase γ gate

```bash
npm run test          # all green
npm run test:e2e      # plus 4 new specs (drag, columns, voice, template install)
```

Manual: side-by-side video vs Notion. Editing-UX feature gap < 10 %.

---

## Phase δ — Native presence

**Goal.** Lumen on every personal device with quick-capture parity to Apple Notes / Google Keep.
**Duration.** 6 weeks.
**Gate.** Long-press iPhone home → Lumen widget tap → quick note saved within 3 s. Apple Watch face complication → speak → memo in vault within 30 s.

---

### δ.1 — iOS Share Extension + WidgetKit

| Field | Value |
|---|---|
| **Effort** | 1 week |
| **Depends on** | β.5 (mobile shipping) |
| **Files** | `ios/Share/ShareViewController.swift` (new), `ios/Widget/LumenWidget.swift` (new), `ios/App/App/Info.plist`, `capacitor.config.json` |

#### Sub-tasks

**δ.1.1** Xcode → File → New → Target → "Share Extension" → name "Lumen Share".

**δ.1.2** App Group: `group.md.lumen.shared` in both main app + share + widget targets.

**δ.1.3** `ShareViewController.swift`:
```swift
override func didSelectPost() {
  let item = extensionContext!.inputItems.first as! NSExtensionItem
  for provider in item.attachments ?? [] {
    if provider.hasItemConformingToTypeIdentifier("public.url") {
      provider.loadItem(forTypeIdentifier: "public.url") { url, _ in
        let shared = FileManager.default
          .containerURL(forSecurityApplicationGroupIdentifier: "group.md.lumen.shared")!
          .appendingPathComponent("inbox-\(Date().timeIntervalSince1970).md")
        try? "[\(item.attributedTitle ?? "")](\((url as! URL).absoluteString))".write(to: shared, atomically: true, encoding: .utf8)
      }
    }
  }
  self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
}
```

**δ.1.4** Main app on resume bridges:
```ts
// Capacitor plugin: read App Group container, import each file to OPFS, delete original.
import { Filesystem } from "@capacitor/filesystem";
async function drainInbox() {
  const dir = await Filesystem.readdir({ path: "inbox", directory: "AppGroup" });
  for (const f of dir.files) {
    const content = await Filesystem.readFile({ path: `inbox/${f.name}`, directory: "AppGroup" });
    await writeWorkspaceFile(`Inbox/${f.name}`, content.data);
    await Filesystem.deleteFile({ path: `inbox/${f.name}`, directory: "AppGroup" });
  }
}
window.addEventListener("appResume", drainInbox);
```

**δ.1.5** WidgetKit small + medium widget. Tap → opens scheme `lumen://new` → Capacitor `App.addListener("appUrlOpen")` handles.

#### Acceptance
- Safari → Share → "Lumen" → URL appears as note in `Inbox/`
- Long-press home → add Lumen widget → tap → main app opens to a fresh note

---

### δ.2 — watchOS quick-capture

| Field | Value |
|---|---|
| **Effort** | 2 weeks |
| **Depends on** | δ.1 (App Group) |
| **Files** | `ios/LumenWatch/`, `ios/LumenWatch/ContentView.swift`, complication plist |

#### Sub-tasks

**δ.2.1** Xcode → New → "Watch App for iOS App". Embed in main project.

**δ.2.2** `ContentView.swift`:
```swift
struct ContentView: View {
  @State private var recorder: WKAudioRecorderController? = nil
  var body: some View {
    Button("🎙 Record") {
      let url = sharedContainer.appendingPathComponent("watch-\(Date().timeIntervalSince1970).m4a")
      WKExtension.shared().rootInterfaceController?.presentAudioRecorderController(
        withOutputURL: url,
        preset: .narrowBandSpeech,
        options: nil,
        completion: { _, _ in }
      )
    }.font(.title3)
  }
}
```

**δ.2.3** Audio + transcript saved to App Group container; phone drains on next resume.

**δ.2.4** Complication for watch face (modular small): tap → straight to record.

#### Acceptance
- Speak into watch → release → 30 s later note appears in `Inbox/voice-{ts}.md` in vault

---

### δ.3 — Android widget + share intent

| Field | Value |
|---|---|
| **Effort** | 4 days |
| **Depends on** | β.5 |
| **Files** | `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/md/lumen/widget/QuickNote.kt` (new) |

#### Sub-tasks

**δ.3.1** Manifest: add intent filters for `ACTION_SEND` + `ACTION_VIEW lumen://`.

**δ.3.2** `MainActivity.onNewIntent` → forward to bridge:
```kotlin
override fun onNewIntent(intent: Intent) {
  super.onNewIntent(intent)
  if (intent.action == Intent.ACTION_SEND) {
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    bridge.eval("window.dispatchEvent(new CustomEvent('lumen-share-import', { detail: { text: ${JSONObject.quote(text)} } }))")
  }
}
```

**δ.3.3** `AppWidgetProvider`:
```kotlin
class QuickNote : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    val views = RemoteViews(ctx.packageName, R.layout.widget_quick_note)
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("lumen://new"))
    val pi = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE)
    views.setOnClickPendingIntent(R.id.widget_root, pi)
    mgr.updateAppWidget(ids, views)
  }
}
```

#### Acceptance
- Share from any Android app → "Lumen" target → appears as note
- Add Lumen widget → tap → opens new note

---

### δ.4 — Wear OS quick-capture

| Field | Value |
|---|---|
| **Effort** | 2 weeks |
| **Depends on** | δ.3 |
| **Files** | `android/wear/` module |

#### Sub-tasks

**δ.4.1** Android Studio → File → New → New Module → Wear OS App.

**δ.4.2** Voice intent → `SpeechRecognizer.createSpeechRecognizer(context)`.

**δ.4.3** Bridge result via Wearable Data API:
```kotlin
val data = PutDataMapRequest.create("/voice-memo")
data.dataMap.putString("transcript", transcript)
data.dataMap.putLong("timestamp", System.currentTimeMillis())
Wearable.getDataClient(this).putDataItem(data.asPutDataRequest())
```

**δ.4.4** Phone listens, writes to OPFS Inbox.

#### Acceptance
- Speak into watch → released → memo in vault

---

### Phase δ gate

Manual:
- iPhone widget + Watch complication + Android widget + Wear watch → all 4 paths produce a note in vault
- Total time from intent to note ≤ 30 s for voice paths, ≤ 3 s for text/widget

---

## Phase ε — Enterprise + ecosystem

**Goal.** Lumen Team / Enterprise tier sells; on-prem bundle distributable.
**Duration.** 4 weeks.
**Gate.** Test SAML SSO succeeds; on-prem bundle stands up on a clean VM; mcp-server published to npm.

---

### ε.1 — WorkOS SSO

| Field | Value |
|---|---|
| **Effort** | 1 week |
| **Depends on** | β.3 |
| **Files** | `src/auth/workosProvider.ts` (new), `src/ui/OrgSettings.tsx` (new), `edge-workers/billing/worker.ts` (extend) |

#### Sub-tasks

**ε.1.1** WorkOS account → enable SSO + Directory Sync.

**ε.1.2** New auth provider mirroring `supabaseProvider.ts` interface:
```ts
export const workosProvider: AuthProvider = {
  async signIn(orgDomain: string) {
    const { redirect } = await fetch("/api/sso/authorize?domain=" + orgDomain).then(r => r.json());
    location.href = redirect;
  },
  async handleCallback(code: string) {
    const profile = await fetch("/api/sso/callback?code=" + code).then(r => r.json());
    return profile;
  },
  // ...
};
```

**ε.1.3** `OrgSettings.tsx` admin page: paste SAML metadata URL → `POST /api/orgs/sso` → WorkOS Organization API creates the connection.

#### Acceptance
- Free WorkOS test org → admin pastes metadata → user signs in via SSO → JWT issued → entitlement loads org tier

---

### ε.2 — Audit log

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Depends on** | ε.1 |
| **Files** | `edge-workers/billing/worker.ts`, `src/ui/AuditLog.tsx` (new) |

#### Sub-tasks

**ε.2.1** D1 schema:
```sql
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  org_id TEXT,
  action TEXT NOT NULL,         -- "doc.publish" | "billing.subscribe" | …
  payload_json TEXT,
  ip TEXT,
  user_agent TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_audit_org ON audit_events(org_id, ts DESC);
```

**ε.2.2** Worker middleware: every mutation route writes one row.

**ε.2.3** Frontend `AuditLog.tsx`:
- Paginated table (100 rows / page)
- Filter by user / action / date range
- CSV export

#### Acceptance
- 1 test publish → 1 audit row
- Admin downloads CSV

---

### ε.3 — On-prem Docker bundle

| Field | Value |
|---|---|
| **Effort** | 1 week |
| **Depends on** | β.2, β.3 |
| **Files** | `docker-compose.yml`, `docker/Dockerfile.web`, `docker/Dockerfile.collab`, `docker/Dockerfile.billing`, `Makefile`, `.env.onprem.example` |

#### Sub-tasks

**ε.3.1** Services:
- `lumen-web` (nginx serving `dist/`)
- `lumen-collab` (`sync-server/persistent-server.js`)
- `lumen-billing` (Cloudflare Worker → Node port via wrangler `local-mode`)
- `postgres` (collab + billing DB)
- `redis` (rate-limit cache)

**ε.3.2** `docker-compose.yml` brings them up; `.env.onprem` template:
```
LUMEN_BASE_URL=https://lumen.example.com
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SENTRY_DSN=
WORKOS_API_KEY=
```

**ε.3.3** `make onprem` builds + pushes images.

**ε.3.4** Validation: spin up on a clean Hetzner VM, smoke-test sign-up + collab + publish.

#### Acceptance
- `docker compose up -d` on a fresh VM → 5 services running, all health checks green within 60 s
- Smoke test passes from a remote browser

---

### ε.4 — Public roadmap

| Field | Value |
|---|---|
| **Effort** | 1 day |
| **Depends on** | — |
| **Files** | `ROADMAP.md` (new), `public/roadmap.html` (new), GitHub Discussions config |

#### Sub-tasks

**ε.4.1** `ROADMAP.md` — auto-generated from this MASTER_PLAN.md by a small script.

**ε.4.2** GitHub Discussions: new category "Roadmap votes"; pin a top thread per phase.

**ε.4.3** `/roadmap` route in production: simple HTML reading a public JSON.

#### Acceptance
- `roadmap.lumen.md` resolves
- Users can upvote items via GitHub thumbs-up

---

### ε.5 — Publish mcp-server to npm

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Depends on** | — |
| **Files** | `mcp-server/src/index.ts`, `mcp-server/README.md`, `mcp-server/package.json` |

#### Sub-tasks

**ε.5.1** Verify package: `npm publish --dry-run` from `mcp-server/`.

**ε.5.2** Add 4 more tools:
- `create_canvas` — make a tldraw canvas in workspace
- `delete_note` — remove a workspace path (with safety guard)
- `update_frontmatter` — patch YAML frontmatter of a note
- `run_database_query` — execute a database-view spec

**ε.5.3** Documentation page in docs site with copy-paste config:
```json
{
  "mcpServers": {
    "lumen": {
      "command": "npx",
      "args": ["-y", "@lumen/mcp-server"]
    }
  }
}
```

#### Acceptance
- `npx @lumen/mcp-server` runs
- Claude Desktop with the config shown above can list / read / create notes

---

### Phase ε gate

```bash
docker compose -f docker-compose.yml up -d
sleep 30
curl -f https://lumen.local/health  # 200
curl -f https://lumen.local/api/sso/authorize?domain=test.com  # redirect
npm pack mcp-server && tar -tzf *.tgz | grep dist/index.js
```

---

## Phase ζ — Marketing + community

**Goal.** Earn the #1 position publicly, not just numerically.
**Duration.** Parallel + ongoing.

---

### ζ.1 — Tutorial library

| Field | Value |
|---|---|
| **Effort** | 4 weeks (recording) + ongoing |
| **Files** | `marketing/scripts/*.md` (new), YouTube uploads |

#### Tutorial roster (10 × 5 min)

1. Install in 60 seconds
2. Smart paste: anything → block
3. Charts from CSV in one paste
4. Mermaid + PlantUML + Graphviz
5. Workspace search (BM25 → semantic)
6. Real-time collab in two clicks
7. Plugin gallery + install
8. AI agents: auto-tag, link, summary
9. Mobile capture: share + widget + watch
10. Vault, recovery phrase, export everything

#### Webinars (4 × 1 h)

- "Lumen for academics" — citations, BibTeX, math
- "Lumen for engineers" — code blocks, mermaid, GLSL
- "Lumen for journalists" — transcripts, dates, embargoes
- "Self-hosting Lumen" — `make onprem` walk-through

#### Acceptance
- 10K total views in first 3 months
- 200 + GitHub stars from organic traffic

---

### ζ.2 — Public benchmarks page

| Field | Value |
|---|---|
| **Effort** | 3 days |
| **Files** | `public/benchmarks.html`, scripts |

`/benchmarks` route shows a side-by-side feature matrix vs the 7 competitors with reproducible test scenarios. Each row links to the actual run.

#### Acceptance
- 7 competitor profiles, 20 categories, all with verifiable ✅/❌

---

### ζ.3 — Plugin contest

| Field | Value |
|---|---|
| **Effort** | 8 weeks (calendar) |

$5 K prize fund, 3 categories (data, AI, productivity), judged after 8 weeks. Winners ship as featured plugins.

---

## 9. Dependency DAG

```
α (1w) ──────────► β (3w) ──┬──► γ (4w) ──► δ (6w) ──► ε (4w)
                            │
                            └──► β.4 i18n (parallel)
                            └──► β.5 mobile (parallel, blocked by Apple review)

ζ runs parallel from week 2 onward; doesn't gate any other phase.
```

Critical path: α → β.5 → δ → ε ≈ 14 calendar weeks.

---

## 10. Sign-off checklist

Before declaring "Lumen #1":

- [ ] Weighted score recomputed on the same rubric ≥ 9.4
- [ ] Gap to runner-up ≥ 2.0
- [ ] Every category ≥ 8
- [ ] 8 categories ≥ 9.5
- [ ] 460+ tests passing on every PR (chromium / firefox / webkit)
- [ ] Coverage ≥ 60 % lines in CI
- [ ] axe a11y violations = 0 across 10 components
- [ ] `npm audit` 0 critical / 0 high
- [ ] All 6 services reachable in production (web, signal, collab, billing, publish, mcp-server-npm)
- [ ] iOS app live in App Store; Android live in Play Store
- [ ] iPhone share + WidgetKit + Apple Watch + Android share + Widget + Wear OS — all 6 capture paths verified
- [ ] WorkOS SAML test + on-prem `make onprem` smoke test passing
- [ ] 10 tutorial videos published; 4 webinars recorded
- [ ] Benchmarks page live with real comparison runs
- [ ] CHANGELOG entry "1.0.0 — World-class release"

---

## Appendix A — Effort summary

| Phase | Days | Calendar weeks |
|---|---|---|
| α | 5 | 1 |
| β | 21 | 3 + Apple review |
| γ | 28 | 4 |
| δ | 42 | 6 |
| ε | 28 | 4 |
| **Total engineering** | **124 days** | **18 cal-weeks** |
| ζ marketing (parallel) | ongoing | — |

---

## Appendix B — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Apple rejects iOS submission | medium | 2-week slip | Front-load privacy nutrition labels; review HIG before β.5.3 |
| Stripe webhook fails silently | medium | revenue loss | β.3.7 tests every event type; alert on D1 row not updating |
| Fly.io free tier eviction | low | downtime | move to paid tier for collab + signal before launch |
| OpenAI fine-tuning policy change | medium | feature deprecated | abstract behind `chat()` so swap to Anthropic / local is < 1 day |
| WorkOS pricing changes | low | enterprise tier econ | abstract via `auth/types.ts` interface |

---

## Appendix C — File-path index for fast jumping

| What | Where |
|---|---|
| Editor entry | `src/editor/Editor.tsx` |
| WYSIWYG | `src/editor/WysiwygEditor.tsx` |
| Slash menu | `src/editor/insertMenu.ts` (source) + `WysiwygEditor.tsx` |
| Comments | `src/collab/comments.ts` + `src/editor/commentDecorations.ts` |
| Search highlight | `src/editor/searchHighlight.ts` |
| Grammar | `src/ai/grammar.ts` + `src/editor/grammarExtension.ts` |
| Tabs | `src/ui/DocTabs.tsx` + store actions |
| Logger | `src/lib/logger.ts` |
| Crypto random | `src/lib/cryptoRandom.ts` |
| Vault | `src/storage/vault.ts` |
| Workspace OPFS | `src/storage/workspace.ts` |
| Yjs collab | `src/collab/yjs.ts` |
| Encryption | `src/collab/encryption.ts` |
| AI router | `src/ai/llm.ts` |
| Local LLM | `src/ai/localLlm.ts` |
| MCP server | `mcp-server/src/index.ts` |
| Edge billing | `edge-workers/billing/worker.ts` |
| Edge publish | `edge-workers/publish/worker.ts` |
| Sync server | `sync-server/server.js` + `persistent-server.js` |
| iOS shell | `ios/App/App/` |
| Android shell | `android/app/` |
| Tauri shell | `src-tauri/` |
| Docs site | `docs/src/content/docs/` |

---

*Generated 2026-04-27. Update this file as gates close. Each completed task: tick the checkbox, link to the merge commit.*
