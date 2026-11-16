# Security Policy

## Supported versions

| Version | Supported | Security fixes |
|---------|-----------|----------------|
| 0.1.x   | ✅ Current | While it is the newest release line, and for critical and high severity for 90 days after the next minor line ships. |

The same table is on the public security page (written from `security/disclosure.json`).

## Reporting a vulnerability

**Do not put the details of a vulnerability in a public GitHub issue, discussion or pull request.**

**First choice:** report it privately through GitHub: **[Report a vulnerability](https://github.com/talstilkol/lumen-md/security/advisories/new)** (Security → Advisories). Only the maintainers see it. If you can't use GitHub's form, open a public issue titled **["Security contact request"](https://github.com/talstilkol/lumen-md/issues/new?title=Security%20contact%20request)** with no details at all, only a way to reach you; a maintainer answers within 48 hours with a private channel. Include:

1. What is affected (file, feature, version or commit)
2. Steps to reproduce, or a proof of concept
3. The impact: what an attacker gets (notes read, notes changed, keys, code run, data sent off the device)
4. A suggested fix, if you have one

GitHub's private vulnerability reporting is **turned on** for this repository and is the first channel. A dedicated security mailbox with a published key will follow. The state of every channel is in `security/channels.json`.

### What happens next

| When | What the maintainers do |
|---|---|
| ≤ 48 hours | Answer the contact request with a private channel, then acknowledge the report there. |
| ≤ 5 business days | Confirm or reject it, give it a severity (CVSS 3.1: critical, high, medium, low) and a fix date. |
| Critical / high: ≤ 14 days · medium: ≤ 30 days · low: next release | Fix it in a **temporary private fork** (a GitHub security advisory's, once private reporting is on), so the fix is not public before the release. The fix touches a sensitive path, so it gets a human review (`human-reviewed` label, see `.github/CODEOWNERS`) like any other change there. |
| Release day | Publish the release, then a GitHub security advisory; request a CVE through it when the severity is medium or higher. The reporter is credited unless they ask not to be. |
| 90 days after the report | The latest date for disclosure, fixed or not, unless the reporter and the maintainers agree on another date. If a vulnerability is exploited in the wild, it is disclosed as soon as users can protect themselves. |

If the first maintainer does not answer within 48 hours, the second maintainer (docs: *contributing/second-maintainer*) takes the report. Both receive every report.

### Disclosure timelines (EU Cyber Resilience Act, Article 14)

The reporting duties of the CRA (Regulation (EU) 2024/2847) apply from 11 September 2026. A free project that is not monetised is most likely outside them, but Lumen keeps the same clock for a vulnerability that is **actively exploited**:

| When | What the maintainers publish |
|---|---|
| ≤ 24 hours after learning it is exploited | **Early warning**: what is affected and what to do meanwhile, with no exploit details. |
| ≤ 72 hours | **Notification**: the affected versions, the severity (CVSS 3.1) and the mitigations. |
| ≤ 14 days after a fix or mitigation is available | **Final report**: the GitHub security advisory (GHSA) with the description, severity, impact, root cause and fix, and a CVE requested through it. |

For a severe incident the final report comes within 30 days. If Lumen ever becomes a manufacturer under the CRA (for example through a paid relay), the same reports also go to the CSIRT and ENISA's single reporting platform, on the same clock. The contact is also published as [`/.well-known/security.txt`](https://lumen-md.vercel.app/.well-known/security.txt) (RFC 9116).

### In scope

- The web app (lumen-md.vercel.app and self-hosted builds), the desktop app (Tauri), the Android and iOS apps
- End-to-end encrypted sync and collaboration, the encrypted vault, the secrets store, plugin signing
- Anything that sends note content, keys or personal data off the device without the user's consent (the privacy ledger)
- CSP and header bypasses; the plugin sandbox; path traversal out of the vault folder

### Out of scope

- Attacks that need a device the attacker already controls (malware, an unlocked computer)
- Reports from automated scanners without a working attack
- Missing hardening headers on hosts Lumen does not run
- Third-party services the user connects (their own model provider, sync provider), except how Lumen uses them

### Good-faith research (safe harbor)

We will not take legal action against research, or ask a host to act against it, when it follows this policy, tests only your own data and installations, does not read, change or delete other people's data, does not degrade the service for others, and gives us the time above before publishing. If someone else acts against you for such research, we will say publicly that it followed this policy.

### בעברית

לא מפרסמים פרטים של חולשת אבטחה ב-issue, בדיון או ב-PR ציבוריים. **הערוץ הראשון** הוא הדיווח הפרטי של GitHub: **[Report a vulnerability](https://github.com/talstilkol/lumen-md/security/advisories/new)** (Security → Advisories), שרק המתחזקים רואים. הוא **מופעל** במאגר הזה. מי שלא יכול להשתמש בטופס פותח issue ציבורי בכותרת **["Security contact request"](https://github.com/talstilkol/lumen-md/issues/new?title=Security%20contact%20request)** בלי שום פרט, ומתחזק עונה תוך 48 שעות עם ערוץ פרטי. אחר כך תבוא תיבת דואר ייעודית עם מפתח מפורסם. מצב כל ערוץ נמצא ב-`security/channels.json`. ניתן חומרה ותאריך תיקון תוך 5 ימי עבודה, נתקן ב-fork פרטי זמני ונפרסם את הגרסה ואז את ה-advisory (עם CVE מחומרה בינונית ומעלה, ועם קרדיט למדווח). המועד האחרון לפרסום הוא 90 יום מהדיווח. אם המתחזק הראשון לא עונה תוך 48 שעות, המתחזק השני מטפל.

**לוחות זמנים לפי ה-CRA (סעיף 14):** לחולשה שמנוצלת בפועל — התרעה מוקדמת עד 24 שעות מרגע שנודע עליה (מה מושפע ומה לעשות, בלי פרטי ניצול), הודעה עד 72 שעות (גרסאות, חומרה, התגוננות), ודוח סופי עד 14 יום אחרי שיש תיקון או התגוננות (ה-advisory של GitHub עם CVE). באירוע חמור הדוח הסופי תוך 30 יום. פרויקט חינמי כנראה פטור מהחובות האלה, שחלות מ-11 בספטמבר 2026, אבל אנחנו שומרים על אותם זמנים.

**מחקר בתום לב:** לא ננקוט צעדים משפטיים נגד מחקר שפועל לפי המדיניות הזו, בודק רק על הנתונים וההתקנות שלכם, לא נוגע בנתונים של אחרים ולא פוגע בשירות, ונותן לנו את הזמן שלמעלה לפני פרסום.

**תקופת תמיכה:** קו הגרסאות 0.1.x מקבל תיקוני אבטחה כל עוד הוא החדש ביותר, ותיקונים בחומרה קריטית וגבוהה עוד 90 יום אחרי שקו הגרסאות הבא יוצא.

## Maintainers and keys

Every key that can sign a Lumen release, plugin or reviewed commit is listed here with its fingerprint. A key that is not in this table is not ours. Changing this table is a sensitive change, so the other maintainer reviews it (`.github/CODEOWNERS`).

| Maintainer | GitHub | Commit signing key (SSH, SHA256 fingerprint) | Plugin signing key (Ed25519, SHA-256 of the SPKI) | Since |
|---|---|---|---|---|
| Tal (owner) | @talstilkol | *to add* | *to add* | — |
| Second maintainer | *open: see docs, contributing/second-maintainer* | — | — | — |

The desktop updater trusts one minisign public key (`src-tauri/tauri.conf.json`). It is held by the owner and kept in the maintainers' emergency vault (docs: *contributing/second-maintainer*, sections 6 and 7).

## Security architecture

Lumen is a **local-first** application. By default, no data leaves the browser.

### Data at rest

| Store | Encryption | Scope |
|---|---|---|
| OPFS workspace | Plaintext (browser-sandboxed) | Same origin only |
| IndexedDB (git, search index) | Plaintext (browser-sandboxed) | Same origin only |
| Secrets vault (`⌘K → Vault`) | AES-256-GCM, PBKDF2-derived key | User passphrase required |
| localStorage (preferences) | Plaintext | Same origin only |

### Data in transit

| Feature | Transport | Encryption |
|---|---|---|
| P2P collaboration | WebRTC (DTLS/SRTP) | Transport encrypted via WebRTC DTLS (hop-by-hop between peers; signaling servers, relays and the optional persistent y-websocket server are not covered). Password-protected rooms additionally encrypt document updates end-to-end — see [`docs/src/content/docs/collab/encryption.md`](docs/src/content/docs/collab/encryption.md). Rooms without a password are **not** end-to-end encrypted. |
| Signaling server | WSS (TLS 1.2+) | Transport-layer only |
| AI prompts (OpenAI) | HTTPS (TLS 1.2+) | Transport-layer only |
| Smart search embeddings | HTTPS to OpenAI | Transport-layer only |
| Git clone/push | HTTPS | Transport-layer only |

### Plugin sandbox

Third-party plugins run in a sandboxed `<iframe>` with:

- `sandbox="allow-scripts"` — **no** `allow-same-origin`
- CSP: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data:; connect-src https:`
- Communication restricted to a `postMessage` API with an explicit allowlist of callable methods
- Plugin signatures verified via Ed25519 (WebCrypto `verify()`) before installation

### Telemetry

- Error reports are **off by default**. They are sent only when the user turns them on (the Telemetry pill in the status bar) **and** the build sets `VITE_SENTRY_DSN`. Without both, the Sentry SDK is never loaded and no request is made.
- A Sentry DSN is **public by design, not a secret**: it only lets a client submit events. A build-time `VITE_*` variable is the intended place for it.
- `beforeSend` rebuilds each event from an allowlist: the error's class name, plus stack frames reduced to script file names. The message is never sent, because it may embed user text without quotes. The request URL, user, breadcrumbs, tags, extra and contexts are dropped. There is no session replay, no tracing and no session tracking.
- Reports go through the privacy ledger under the "monitoring" category, and the local-only policy refuses them. The DSN's host reaches the CSP only through the build-time endpoint mechanism (`src/build/cspEndpoints.ts`); no tracker host or wildcard is hard-coded.
- Web vitals are measured locally and never sent.

### Authentication

- Auth is always optional — Lumen works fully without an account
- When configured, auth uses Supabase (JWT-based) or a custom `AuthProvider`
- API keys are stored in the encrypted secrets vault, not in plaintext localStorage
- The `localProvider` (default) always returns an anonymous session

### Known limitations

- OPFS data is not encrypted at rest (relies on browser origin isolation)
- WebRTC P2P rooms are ephemeral. Signaling servers see room names and peer metadata; without a room password, anything routed through a signaling/relay or persistent sync server is not end-to-end encrypted. Use a room password for end-to-end encryption of document updates (see `docs/src/content/docs/collab/encryption.md`)
- PlantUML rendering uses the public Kroki API (diagram source is sent to `kroki.io`)
- `htmlpreview` fenced blocks execute user-authored HTML/JS in a sandboxed iframe

## Dependencies

- `npm audit` is run in CI on every push — the gate requires **0 critical / 0 high** vulnerabilities
- Dependabot is configured for automated security updates (`.github/dependabot.yml`)
- The `uuid` package is pinned via `overrides` to avoid transitive vulnerabilities

## Disclosure timeline

We follow a **90-day disclosure policy**. If a fix is not released within 90 days of the initial report, the reporter may publish details publicly.

## Hall of fame

Reporters are credited here and in the advisory, unless they ask not to be. No reports credited yet.
