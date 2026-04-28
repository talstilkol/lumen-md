# Lumen Roadmap

> Auto-generated from `MASTER_PLAN.md`. Last refresh: 2026-04-27.
>
> Vote on items in [GitHub Discussions → Roadmap](https://github.com/lumen-md/lumen/discussions/categories/roadmap).

## Where we are today

Lumen is **#1 by weighted scorecard** (7.78) but the lead is fragile (0.39 over Obsidian).
The roadmap below closes the gap to **9.42 / 2.0+ ahead of every competitor**.

## Phases

| Phase | Title | Duration | Status |
|---|---|---|---|
| α | Honest baseline | 1 week (1 engineer). | _planning_ |
| β | Ship to humans | 3 weeks. | _planning_ |
| γ | Premium UX | 4 weeks. | _planning_ |
| δ | Native presence | 6 weeks. | _planning_ |
| ε | Enterprise + ecosystem | 4 weeks. | _planning_ |
| ζ | Marketing + community | Parallel + ongoing. | _planning_ |

---

## Phase α — Honest baseline

**Goal.** Close every audit-flagged ⚠️/🟡 from the previous master plan. No new features.

**Gate to advance.** typecheck ✅ + 460+ tests ✅ + coverage ≥ 60 % + axe 0 violations + Sentry test event received + Lumen-owned signaling endpoint live.

### Tasks

- α.1 — Logger / Math.random / console cleanup
- α.2 — @sentry/react SDK
- α.3 — Deploy y-webrtc signaling
- α.4 — Coverage report + CI gate
- α.5 — Deep a11y sweep
- α.6 — Replace 9 hardcoded English strings

## Phase β — Ship to humans

**Goal.** Real users can install, pay, sync, and edit on iPhone + Android.

**Gate to advance.** Test purchase succeeds, 2 testers each on TestFlight + Play Internal, persistent collab survives 24 h restart.

### Tasks

- β.1 — 7 Playwright e2e specs
- β.2 — Persistent collab deployed
- β.3 — Stripe live + entitlements
- β.4 — 6 additional locales
- β.5 — Mobile QA + store submission

## Phase γ — Premium UX

**Goal.** Notion-grade editing parity + tldraw whiteboard + voice transcribe + fine-tuned AI + plugin author flow.

**Gate to advance.** Side-by-side demo vs Notion shows 90 % feature parity in editing UX.

### Tasks

- γ.1 — WYSIWYG drag-handles + columns + indent
- γ.2 — Swap Canvas → tldraw
- γ.3 — Templates marketplace UI
- γ.4 — Voice transcribe + AI summary
- γ.5 — AI fine-tuned style
- γ.6 — Plugin author submission CLI

## Phase δ — Native presence

**Goal.** Lumen on every personal device with quick-capture parity to Apple Notes / Google Keep.

**Gate to advance.** Long-press iPhone home → Lumen widget tap → quick note saved within 3 s. Apple Watch face complication → speak → memo in vault within 30 s.

### Tasks

- δ.1 — iOS Share Extension + WidgetKit
- δ.2 — watchOS quick-capture
- δ.3 — Android widget + share intent
- δ.4 — Wear OS quick-capture

## Phase ε — Enterprise + ecosystem

**Goal.** Lumen Team / Enterprise tier sells; on-prem bundle distributable.

**Gate to advance.** Test SAML SSO succeeds; on-prem bundle stands up on a clean VM; mcp-server published to npm.

### Tasks

- ε.1 — WorkOS SSO
- ε.2 — Audit log
- ε.3 — On-prem Docker bundle
- ε.4 — Public roadmap
- ε.5 — Publish mcp-server to npm

## Phase ζ — Marketing + community

**Goal.** Earn the #1 position publicly, not just numerically.

**Gate to advance.** _(see master plan)_

### Tasks

- ζ.1 — Tutorial library
- ζ.2 — Public benchmarks page
- ζ.3 — Plugin contest

---

## Want to influence priorities?

1. 👍 the items you care about in [GitHub Discussions](https://github.com/lumen-md/lumen/discussions/categories/roadmap).
2. Comment with a use-case — concrete user stories help us scope.
3. PRs welcome on Phase α + β items (no credentials required); see [CONTRIBUTING.md](CONTRIBUTING.md).
