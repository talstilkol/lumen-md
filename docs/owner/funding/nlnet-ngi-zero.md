# NLnet NGI Zero application (draft)

*Fill the `<…>` fields; keep the rest or shorten it. Check the current call
text and form at nlnet.nl before submitting: fields and caps change between
calls.*

**Thematic call:** NGI Zero Commons Fund (or the call NLnet suggests).

**Proposal name:** Lumen encrypted sync — an audited, spec-first,
local-first sync for a Hebrew-first notes app

**Website / wiki:** https://lumen-md.vercel.app · the public repository

**Contact:** `<name>`, `<e-mail>`, `<country>`

## Abstract

Lumen is an open-source, local-first Markdown editor whose notes stay
files on the user's device. Its end-to-end encrypted sync works over storage
the user already has (WebDAV, S3, Dropbox, a synced folder) or a small
relay that only sees ciphertext. The protocol is written down
(`docs/sync-protocol.md`), has test vectors, and is read byte for byte by
two independent implementations besides the app (Python and node:crypto).
It has had nine internal reviews and no external one. This grant pays for
the external audit, the fixes it finds, and publishing the report — as
Obsidian did with Cure53 and Trail of Bits — so that families and classrooms
can share an encrypted vault on a protocol someone outside the project has
checked.

## Have you been involved with projects or organisations relevant to this project before?

`<the owner's background>`

## Requested amount

`<amount in EUR>` (within the call's cap)

## Budget breakdown

| Task | Effort | Cost |
|---|---|---|
| External audit of client sync, relay and cryptography (scope: the pack's questionnaire) | firm's quote | `<EUR>` |
| Fixing the findings, re-test with the firm | `<days>` | `<EUR>` |
| Group keys for shared vaults if the audit or ADR-005's triggers require it | `<days>` | `<EUR>` |
| Publishing: the report, the updated spec and vectors, a write-up in Hebrew and English | `<days>` | `<EUR>` |

## Compare your project with existing or historical efforts

Obsidian Sync (closed source, audited and published), Standard Notes
(audited by Trail of Bits), Joplin (open, E2EE, no published protocol
audit). Lumen differs: the protocol is a public specification with vectors
and independent readers, sync works over the user's own storage with an
untrusted provider, and the app is built Hebrew-first (RTL, niqqud).

## What are significant technical challenges you expect to solve?

Rollback and split-view detection with an untrusted provider (spec §9),
re-keys that a cut-off cannot corrupt, safe pairing between devices (SAS),
recovery and passkey unlock, and shared vaults that carry no code between
members (W13.S2).

## Describe the ecosystem of the project

Users: individuals, families, schools in Israel and Hebrew/Arabic speakers;
the protocol spec and vectors are reusable by other local-first apps.

## European dimension

`<ask NLnet before submitting: the applicant is in Israel. Possible answers:
the open protocol and vectors serve European users and projects; EU
contributors or an EU-based audit firm; EN 301 549 accessibility.>`

## Attachments

- `lumen-sync-audit-pack.tar` and its SHA-256 (W13.S4)
- ADR-005 (group keys)
