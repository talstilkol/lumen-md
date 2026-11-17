# Encrypted sync: scope questionnaire

Laid out along the three areas the published Obsidian Sync audits covered
(Cure53, 10/2024: client and server; Trail of Bits, 12/2025: cryptography
and protocol), so a firm can quote from it directly (plan W13.S4).
Answers are the project's; the firm may narrow or widen them.

## 1. Client API

- **Code:** `src/sync/e2ee/` (engine, keyring, pairing, recovery, passkeys,
  roles, LAN, providers), listed with hashes in the pack's `scope/files.tsv`.
- **Entry points:** `E2eeSync.sync()`, `createVault`, `unlockVault`,
  `unlockWithDevice`, pairing (`pair`, `pairingSas`, `confirmPairing`),
  re-key and revoke, recovery restore, passkey unlock.
- **Platforms:** browser (PWA), Tauri desktop, Capacitor mobile — one
  TypeScript code base.
- **Primitives:** WebCrypto (AES-GCM, HKDF, HMAC, PBKDF2, X25519 where
  available) and audited JS libraries for Argon2id, scrypt, ChaCha20-Poly1305
  and BLAKE2b (`src/sync/e2ee/primitives/`; W10.D11–D13).
- **Questions for the firm:** is the freeze / commit / finish re-key safe
  under a lying provider (§5)? Are the pairing messages domain-separated
  enough (§6)? Can the shared-vault policy (W13.S2) be bypassed by path
  tricks (case, Unicode, nesting)?

## 2. Server

- **Code:** `sync-server/vault-relay.js`, `sync-server/vault-relay-roles.js`
  (Node), `edge-workers/vault-relay/worker.mjs` (Cloudflare Durable Object,
  the same module).
- **What it stores:** opaque objects, SHA-256 of bearer tokens, sizes and
  times. No accounts, no address logs.
- **Endpoints:** `GET/PUT/DELETE /v1/vault/o/<name>` with If-Match /
  If-None-Match; drop boxes (append-only tokens); role spaces (ACL-checked
  writes).
- **Questions for the firm:** token handling and comparison; compare-and-swap
  under concurrency; the ACL checks match the client's `checkNext`; resource
  limits.

## 3. Cryptography

- **Spec:** `spec/sync-protocol.md` (§1–§7) and the vectors.
- **Independent implementations:** `impl/check_vectors.py` (Python) and
  `impl/ref-impl.mjs` (node:crypto + RFC 9106 Argon2id), both from the spec;
  both read 100% of the vectors.
- **Questions for the firm:** key separation (HKDF labels), AAD coverage,
  nonce handling (random 96-bit GCM nonces per object; limits per key),
  the recovery `check` and the passkey PRF wrap, the SAS (five 6-bit symbols,
  commitments, confirmation windows), group keys for shared vaults (see
  `docs/adr/005-group-keys.md`).

## 4. Logistics

- **Size:** about 20–25k lines in scope (client sync + relays); see `scope/files.tsv`.
- **Build:** one command, `BUILD-AND-TEST.md`.
- **Access:** the public repository; a test relay on request.
- **Reporting:** findings through SECURITY.md; the project publishes the
  final report, as Obsidian did.
- **Funding:** NLnet NGI Zero and OSTIF applications (plan W13.S5) cite this pack.
