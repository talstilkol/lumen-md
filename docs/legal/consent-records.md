# Consent records for the routes that leave the device (W11.S11)

**Not legal advice.** This file is part of the legal review packet (W6.37). A
lawyer's review is still owed (W11.O3).

[`legal/consent-register.json`](../../legal/consent-register.json) maps every
route the privacy ledger can record to one consent record. Each record names
the route by the name the ledger panel shows, so a user can match a line in
the ledger to its record. `src/__tests__/privacyDoc.test.ts` fails when a
route has no record. It gets the routes the same way the privacy policy's
test does: from `src/ai/privacyLedger.ts` and every module that records into
the ledger.

## The guidance (25 Feb 2026)

The Privacy Protection Authority's guidance on obtaining consent, as a law
firm's summary describes it (we have not read the guidance's own text),
asks for five things. Each record answers each one:

| The guidance asks | The record's field | How Lumen meets it |
|---|---|---|
| Active consent: an act of the user, not silence | `ppa2026.activeOptIn` | No route runs by itself. The default AI policy is `local-only`, and each route starts only from something the user does (`src/ai/policy.ts`). |
| No pre-ticked box | `ppa2026.preTicked` (always `false`) | Every switch that turns on a route is off by default. Error reports are off by default and need a build with a DSN. |
| Recipients named | `ppa2026.namedRecipients` | Each record names the company or server. The ledger shows the same name when the route is used. |
| Withdrawal as easy as consent: one click | `ppa2026.withdrawal` | **Local only** (Settings → Privacy) is one switch that blocks every route that carries user content. Each route also has its own switch. Error reports re-read consent for every event. |
| Re-consent when the purpose changes | `ppa2026.reconsentOnChange` | See below. |

Records with `needsConsent: false` are routes the user set up to their own
machine or device (Ollama on this machine, LAN sync), or that carry no user
content and serve a feature the user turned on (model downloads, the update
check). Their basis is the performance of what the user asked for. They are
still listed, so that 100% of routes have a record.

Two records are `alarm`, not consent routes. One is the two CDNs that should
never be contacted. The other is audit mode, which shows requests no rule
recognises. A hit on either is a bug to fix. It is not something to consent
to.

## Re-consent

A route's purpose or recipient changes only in a release that changes its
ledger rule (`src/ai/privacyLedger.ts`). That release must do three things:

1. Change the route's record in `legal/consent-register.json`. The test fails
   on a new route name until it has a record.
2. If the purpose or recipients widen, turn the route's switch off for
   existing users. The user then turns it on again under the new wording. A
   switch that stays on after its purpose widened is consent the user never
   gave.
3. Say so in the release notes.

**Gap:** step 2 is a rule for releases. No code enforces it yet. Tracking it
in code (a version per route's consent, reset when the record changes) is a
follow-up for the clinic's review to confirm or reject.
