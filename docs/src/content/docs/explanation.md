---
title: "Explanation"
description: "Why Lumen works the way it does: the ideas, trade-offs and decisions."
type: reference
---

Why Lumen works the way it does: the ideas, trade-offs and decisions.

12 pages.

## Editor

- [Accessibility statement](/editor/accessibility-statement/) — How accessible Lumen is — the standard it follows (Israeli Standard 5568, WCAG), what works, known gaps, and how to report a barrier.

## Project

- [Community and the beta](/project/community/) — Where to talk about Lumen, how the Hebrew beta works, how to join, and the code of conduct.
- [Lumen, Obsidian, Notion and Google Docs](/project/compare/) — An honest comparison for people who write in Hebrew: what each one does, with a source for every claim, and what Lumen still lacks.
- [Pricing](/project/pricing/) — Lumen is free and MIT-licensed forever, with no account. The only paid things are optional — an encrypted sync relay at $4 a month and a one-time supporter payment — and the free tier never shrinks.
- [Public roadmap](/project/roadmap/) — The roadmap page at /roadmap — generated from plan/plan.json, titles and status only, and checked in CI so it cannot drift.
- [Sustainability](/project/sustainability/) — How Lumen pays for itself without ads, accounts or locked features. Donations through GitHub Sponsors and Open Collective, an optional paid relay that sees only ciphertext, and every cost in the open.

## Security and privacy

- [A privacy report you can prove](/security/privacy-report/) — Export the privacy ledger as a signed report, check it with a script, and see the results of the outside audit for every version.
- [Supply chain: how a release was built, and who released it](/security/provenance/) — Every lumen-md release file carries SLSA provenance signed by the build host and a keyless Sigstore signature from Tal's own login. One command checks both, offline if you like.
- [Secret scan of the build](/security/secret-scan/) — Why no secret may be a VITE_* variable, the gate that fails a build that sets one, and the scan of the live deployments.
- [Threat model](/security/threat-model/) — What Lumen protects, from whom, at each of its boundaries — vault, sync, sharing, plugins, agents and the web clipper — and where each defence is tested.
- [Transparency report](/security/transparency/) — Every six months: the requests for user data the encrypted sync relay and the share server received, answered and rejected, and what they could hand over at all.

## Workspace

- [Israeli time](/workspace/israeli-time/) — A Sunday–Thursday work week, the Hebrew date next to dates, and deadlines that move off Shabbat and chagim with a note saying why.
