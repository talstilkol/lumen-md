---
title: Security
description: Lumen's security status in public: the external audit (none yet), the threat model, fuzzing, release provenance, every open finding, and a review scorecard with a privacy label for each plugin.
---

<!-- Written by scripts/security-page.mjs from security/findings.json and the plugin scorecards. Do not edit by hand. -->

This page is written from the repository itself: the findings register (`security/findings.json`) and the plugin scorecards (`public/plugins/examples/scorecards/`). A test fails when the page is out of date, so an open finding can't be left off it.

## External audit

Lumen has not had an external security audit. One is to be commissioned (plan W11.O6) for the sync protocol and the keyring. Until a report is published in full, Lumen's cryptography is not audited and no text may say otherwise, and encrypted sync (E2EE) stays off by default, labelled as not externally audited (plan W11.S1; security/crypto-audit.json records the audit state).

**Encrypted sync is experimental.** While no external audit is published, encrypted sync (E2EE) is behind an experimental flag that is off in every channel, beta included, and its setup screen says it has not had an external security audit (plan W11.S1). This cryptography is not audited, no text in the app may say it is, and a check enforces that. The audit covers `src/sync/e2ee/`, `src/collab/encryption.ts`, `src/storage/vault/encrypted/`, `src/storage/lockedNote.ts`.

## Threat model

What is protected, who we defend against, and the known gaps: [Threat model](/security/threat-model/).

## Fuzzing

The decoders are fuzzed (`npm run fuzz`, 1,000,000 inputs per decoder); how and what is covered: [Supply chain](/security/supply-chain/). Results per release are not published on this page yet.

## Release provenance (SLSA)

Releases are built to carry signatures and SLSA provenance (`npm run release:sign`, `npm run release:verify`, plan W7.22); see [Supply chain](/security/supply-chain/). No signed release has been published yet: the first is 0.2.0-beta.1 (launch gate M0).

## Open findings

Every finding that is still open or accepted, with its severity. A finding leaves this list only when it is fixed, with the change that fixed it.

| id | severity | area | finding | since |
|---|---|---|---|---|
| LUM-2026-001 | medium | sync | Encrypted sync (E2EE) has had no external audit. | 2026-11-15 |
| LUM-2026-003 | medium | agents | An agent granted `write` writes without asking again for each file. | 2026-11-15 |
| LUM-2026-004 | medium | vault | A copied browser profile can use the stored secret key without a password until whole-vault encryption (11.4) ships. | 2026-11-15 |
| LUM-2026-002 | low | collaboration | Collaboration edits are attributed locally, not signed. | 2026-11-15 |
| LUM-2026-005 | low | clipper | The web clipper's `<all_urls>` host permission is broader than its click-only behaviour needs. | 2026-11-15 |
| LUM-2026-006 | low | fuzzing | The fuzzer does not cover `.base`, `.excalidraw`, PDF annotations or plugin manifests yet. | 2026-11-15 |
| LUM-2026-007 | low | plugins | The plugin review does not run `npm audit` on a version's lockfile offline; such a version is marked "audit owed" until it runs. | 2026-11-15 |

## Plugin review scorecards

Every version of every plugin in the registry goes through an automated review before it is listed (plan W11.S14): static analysis (eval, Function, obfuscation, minified-only bundles, undeclared network origins), its permissions against the previous version, its stylesheet (no remote `@import`, `url()`, `image-set()` or `src()`, escaped forms included, and no `var()`, `env()` or `attr()` inside those functions, because the review cannot see the value they put there), a public source and an open-source licence, and the packages in its lockfile against the known-bad list (`security/known-bad.json`; high or critical fails it). A version that fails is not listed; a listed version whose review failed is taken down within 24 hours. The privacy label comes from the permissions the manifest declares.

| plugin | version | grade | score | privacy label |
|---|---|---|---|---|
| `lumen.calendar` | 1.0.0 | A | 90 | Keeps its settings; Reads notes in your vault; Collects nothing: no network access |
| `lumen.example.bidi-cleaner` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Shows notifications; Collects nothing: no network access |
| `lumen.example.callout` | 1.0.0 | A | 90 | Keeps its own data on this device; Collects nothing: no network access |
| `lumen.example.daily-quote` | 1.0.0 | A | 90 | Changes the open note; Can send data to https://example.com; Shows notifications |
| `lumen.example.hebrew-date` | 1.0.0 | A | 90 | Changes the open note; Collects nothing: no network access |
| `lumen.example.tasks-overview` | 1.0.0 | A | 90 | Reads notes in your vault; Collects nothing: no network access |
| `lumen.example.text-format` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Collects nothing: no network access |
| `lumen.example.toc` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Keeps its settings; Collects nothing: no network access |
| `lumen.example.word-stats` | 1.0.0 | A | 90 | Reads the open note; Keeps its settings; Collects nothing: no network access |
| `lumen.flashcards` | 1.0.0 | A | 90 | Reads the open note; Keeps its own data on this device; Collects nothing: no network access |
| `lumen.kanban` | 1.0.0 | A | 90 | Writes to the clipboard; Reads the open note; Changes the open note; Shows notifications; Collects nothing: no network access |
| `lumen.linter` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Shows notifications; Keeps its settings; Collects nothing: no network access |
| `lumen.natural-dates` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Shows notifications; Keeps its settings; Collects nothing: no network access |
| `lumen.note-refactor` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Shows notifications; Keeps its settings; Reads notes in your vault; Changes notes in your vault; Collects nothing: no network access |
| `lumen.sort-lines` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Shows notifications; Collects nothing: no network access |
| `lumen.table-format` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Collects nothing: no network access |
| `lumen.tags` | 1.0.0 | A | 90 | Shows notifications; Reads notes in your vault; Changes notes in your vault; Collects nothing: no network access |
| `lumen.templates` | 1.0.0 | A | 90 | Reads the open note; Changes the open note; Keeps its settings; Reads notes in your vault; Collects nothing: no network access |

## Transparency report

Every six months, the requests for user data the relay and the share server received, answered and rejected: [Transparency report](/security/transparency/). The store privacy labels are built from the privacy ledger, and a check fails when a route is missing from them (`store/privacy-labels.json`).

## Report a vulnerability

Privately, as [SECURITY.md](https://github.com/talstilkol/lumen-md/blob/main/SECURITY.md) explains.

The same contact is in [`/.well-known/security.txt`](https://lumen-md.vercel.app/.well-known/security.txt) (RFC 9116); a check fails when the file expires.

### Disclosure timelines (EU Cyber Resilience Act)

The reporting duties of the CRA (Regulation (EU) 2024/2847 (Cyber Resilience Act), Article 14) apply from 2026-09-11. A free project that is not monetised is most likely outside them, but Lumen keeps the same clock for a vulnerability that is actively exploited:

| When | What Lumen publishes |
|---|---|
| ≤ 24 hours after learning it is exploited | Early warning: what is affected and what to do meanwhile, with no exploit details. |
| ≤ 72 hours | Notification: the affected versions, the severity (CVSS 3.1) and the mitigations. |
| ≤ 14 days after a fix or mitigation is available | Final report: the GitHub security advisory (GHSA) with the description, severity, impact, root cause and fix, and a CVE requested through it. |

For a severe incident the final report comes within 30 days. If Lumen ever becomes a manufacturer under the CRA (for example through a paid relay), the same reports also go to the CSIRT and ENISA's single reporting platform, on the same clock.

### Good-faith research (safe harbor)

We will not take legal action against research, or ask a host to act against it, when it follows SECURITY.md, tests only your own data and installations, does not read, change or delete other people's data, does not degrade the service for others, and gives us the time above before publishing. If someone else acts against you for such research, we will say publicly that it followed this policy.

### Supported versions

Lumen gets security updates for at least five years from its first public release, and never ending before 31 December 2031 (CRA Art. 13(8)). They ship in the newest release line, which every user can move to free of charge (Art. 13(10)); each security update stays downloadable for at least ten years (Art. 13(9)).

| Release line | Status | Security fixes |
|---|---|---|
| 0.1.x | current | While it is the newest release line, and for critical and high severity for 90 days after the next minor line ships. |

### Hall of fame

No reports credited yet. Reporters are credited here and in the advisory unless they ask not to be.
