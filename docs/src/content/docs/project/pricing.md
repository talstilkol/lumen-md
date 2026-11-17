---
title: Pricing
description: Lumen is free and MIT-licensed forever, with no account. The only paid things are optional — an encrypted sync relay at $4 a month and a one-time supporter payment — and the free tier never shrinks.
type: explanation
---

## The app: free, forever

- **Free, with every feature.** Nothing in the app is locked behind a payment.
- **MIT licence.** The code is yours to read, run, change and share ([LICENSE](https://github.com/talstilkol/lumen-md/blob/main/LICENSE)).
- **No account.** Your notes stay on your device as Markdown files.
- **The free tier never shrinks.** No feature that is free today will become paid. This promise is also in the README.
- **Only hosted services can be paid.** In the code, `src/billing/gates.ts` may gate only a service that runs on a server and costs money (the encrypted relay, hosted publish, the persistent collaboration server). Search, semantic search, AI with your own key or a local model, and the number of devices are never limited, even when an operator turns billing on. A test lists every gate and fails if a local feature is among them.

Sync between your devices is free too, through your own relay (`node sync-server/vault-relay.js`), a folder you already sync, or Git.

## Optional: the encrypted sync relay

For people who would rather not run a relay themselves. The relay sees only encrypted data: notes are encrypted on the device before they leave it ([Sustainability](/project/sustainability/) explains what the relay can and can't see).

| Plan | Price |
| --- | --- |
| Monthly | **$4** a month |
| Yearly | **$40** a year (ten months) |

<button type="button" disabled data-pay="relay-monthly">Subscribe monthly ($4)</button>
<button type="button" disabled data-pay="relay-yearly">Subscribe yearly ($40)</button>

## Optional: support Lumen once

A one-time payment of about **$25**, for people who want to support the work. It unlocks nothing, because there is nothing to unlock.

<button type="button" disabled data-pay="supporter">Support once ($25)</button>

## Discounts and free use

- **Students and teachers:** 50% off the relay.
- **Schools, yeshivas and nonprofits:** the relay is free.

## Payments are not open yet

The buttons above are disabled. Payments open only once the payment provider is set up (plan W11.O8). Until then nothing on this page can take a payment. Donations are open now: [Sustainability](/project/sustainability/).
