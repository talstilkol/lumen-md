---
title: Transparency report
description: Every six months: the requests for user data the encrypted sync relay and the share server received, answered and rejected, and what they could hand over at all.
type: explanation
---

<!-- Written by scripts/privacy/transparency.mjs from security/transparency/. Do not edit by hand. -->

Like Proton's, every six months, including when every number is 0. Written from `security/transparency/` by `scripts/privacy/transparency.mjs`; a test fails when this page is out of date, or when a report is more than six months overdue.

## 2026-07-01 – 2026-12-31

Interim report: no public relay or share server ran in this period (both are code only), so there was nothing anyone could ask for. The period closes on 31 December; the final report for it replaces this one.

| Request | Received | Answered | Rejected |
|---|---|---|---|
| Government or police | 0 | 0 | 0 |
| Court orders | 0 | 0 | 0 |
| Foreign authorities | 0 | 0 | 0 |
| Takedown or removal | 0 | 0 | 0 |

**What could be handed over:** Only what the servers hold: encrypted objects under opaque names, their sizes and times, the SHA-256 of each space's token, and room names. Never note text (encrypted on the device with keys the servers never see), and no IP addresses (the relay counts them under a daily key it never stores).
