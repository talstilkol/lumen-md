# Records of processing activities (GDPR Art. 30) — W11.S11

**Not legal advice.** This file is part of the legal review packet (W6.37).
A lawyer's review is owed (W11.O3).

Lumen is a local-first editor. Notes stay on the user's device. The project
runs three things that could process personal data. This record covers them.
The routes the app itself uses (AI providers, grammar check, and others) go
to third parties the user chose. They are mapped in `PRIVACY.md` and in
`legal/consent-register.json`. They are not processing by the project.

Controller: the Lumen project, through its maintainer (contact:
`SECURITY.md` and `PRIVACY.md`). No EU representative and no DPO: see
[eu-representative-dpo.md](eu-representative-dpo.md).

## 1. The encrypted sync relay (`sync-server/vault-relay.js`, `edge-workers/vault-relay/`)

| Art. 30(1) item | Record |
|---|---|
| Purpose | Store the encrypted files of encrypted sync for devices that have no sync folder and no WebDAV |
| Data subjects | People who use the relay for sync |
| Categories of data | **Content:** opaque objects encrypted on the device with keys the relay never sees. **Metadata:** object names (opaque), sizes and times, and the SHA-256 of each space's bearer token. **Network:** the client's IP address, while a request is handled. It is counted for rate limits under an HMAC whose random key lives in memory and changes daily, so no address is kept and no count links across days. |
| Recipients | The hosting provider: Cloudflare (Workers and Durable Objects), or Fly.io for the Node relay |
| Transfers outside Israel / the EU | The hosting provider's regions (Cloudflare and Fly.io, USA and global). Basis to confirm in review (W6.37, question 4). |
| Retention | A space nobody read or wrote for 90 days is deleted (`VAULT_RELAY_RETENTION_DAYS`). Addresses: not kept. |
| Security (Art. 32) | End-to-end encryption. Token hashes only. Per-address and global quotas. An optional invite or proof of work for new spaces. No accounts and no address logs. |

## 2. The share server (`sync-server/collab-server.mjs`, `server.js`, `edge-workers/collab/`)

| Art. 30(1) item | Record |
|---|---|
| Purpose | Relay and keep live-shared rooms, so that people can join a room when no one else is online |
| Data subjects | People in a shared room |
| Categories of data | **Content:** the room's document state. It is encrypted in every new room (the key is in the invite link, never on the server). Rooms opened before encryption are plain text. **Metadata:** room name (128 random bits), update times and sizes. **Network:** IP addresses in the signalling log, unless `SIGNAL_QUIET` is set. **Display names:** random ("Saffron", "Willow"), live only, never stored. |
| Recipients | The hosting provider (Cloudflare or Fly.io) |
| Transfers | As for the relay |
| Retention | Rooms nobody changed for 90 days are deleted (`COLLAB_RETENTION_DAYS`, swept at start and daily). The latest 24 hourly backups are kept. Note: `PRIVACY.he.md`'s impact assessment still says "no limit": it was written before the sweep existed, and [dpia-share-server.md](dpia-share-server.md) supersedes it. |
| Security | Encryption in every new room, HMAC room tokens (one room, 10 minutes) and an operator access key (`COLLAB_ACCESS_KEY`) |

## 3. Feedback

| Art. 30(1) item | Record |
|---|---|
| Purpose | Let users report problems |
| Processing by the project | **None.** The feedback window builds the text of a GitHub issue on the device. The user opens or copies it themselves. Nothing is sent to the project. |
| Where the data ends up | A public GitHub issue that the user posted under their own GitHub account, under GitHub's terms |
| Retention | As long as the issue exists. The user can delete their own issue, and the project deletes one on request. |

## Review

This record is revised with every change to the three servers or the
feedback flow. `src/__tests__/privacyDoc.test.ts` checks that it names all
three and their retention settings.
