# Encrypted sync: threat model for an external audit

This is the long form of `docs/sync-protocol.md` §9, written for an auditor
(plan W13.S4). The spec is the authority; where the two differ, the spec
wins and this file is the bug.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Note and attachment plaintext | the device only (OPFS, a folder, IndexedDB) | the user's data |
| The epoch secret and its sub-keys (`names`, `manifest`, `blobs`, `keyring`, `pairing`) | memory while unlocked; sealed in the keyring | opens every object of the epoch |
| The passphrase and the master key | typed, then memory only | opens the keyring's passphrase wrap |
| The recovery key and passkey PRF outputs (§5a, §5b) | printed kit / the authenticator | each opens the vault alone |
| A device's age identity | IndexedDB on that device (non-extractable where the platform allows) | opens that device's wrap |
| Anchors (manifest counter and history, keyring digest and chain) | the device's sync state | detect replay and rollback |
| The role-vault ACL and member signing keys (W12.S4) | the relay (signed), each member device | who may write a shared vault |
| Metadata | the provider | object count, sizes (padded), timing |

## Actors

- **The provider** (WebDAV, S3, Dropbox, Google Drive, a folder synced by a
  third party, the Lumen relay): untrusted. Can read, withhold, replay,
  reorder and delete objects, and can drop If-Match.
- **A network attacker**: sees TLS to the provider only; the relay and the
  providers are reached over HTTPS. The LAN channel (`src/sync/e2ee/lan`)
  is authenticated by the pairing comparison (§6a).
- **A former member or revoked device**: knew an older epoch secret and,
  in a role vault, a signing key. Must not read epochs after its revocation
  or write after the ACL removes it.
- **A current member of a shared vault** (family, classroom): may write
  what the ACL lets it write, and may try to plant code or settings for the
  other members (handled by `src/sync/e2ee/sharedVault.ts`, plan W13.S2).
- **Someone holding the device**: out of scope while it is unlocked; a
  locked device keeps the key material sealed (`deviceLock.ts`).

## Trust boundaries

1. Device ↔ provider: everything that crosses is sealed (AES-256-GCM with
   AAD naming kind, vault and object) or MACed (the header, pairing
   messages). Object names are HMACs of labels.
2. Device ↔ device: pairing codes and answers (§6), the SAS comparison
   (§6a); the user compares five symbols.
3. Member ↔ member (role vaults): the admin-signed ACL, checked by the relay
   and again by every member on read.
4. App ↔ its own storage: the vault's files are the user's; a synced
   `.lumen/` or `.obsidian/` file is data, never code (W13.S2).

## STRIDE

| Threat | Example | Mitigation | Spec |
|---|---|---|---|
| Spoofing | a provider makes a keyring for a device's public key | anchors bound to the epoch secret; recovery `check` MAC | §5 *Anchors*, §5a |
| Tampering | a changed blob, manifest or keyring | AES-GCM with AAD; manifest hashes; keyring digest chain | §4, §5 |
| Tampering | a pairing request relabelled as an answer | kind in the MAC label and the body, exact field sets | §6 (F1) |
| Repudiation | who wrote an object in a role vault | member signatures, ACL sequence numbers | W12.S4 |
| Information disclosure | object names, sizes | HMAC names, padding; sizes and timing remain | §4, §9 |
| Information disclosure | a revoked device reads new epochs | re-key wraps only for listed, unrevoked devices | §5 |
| Denial of service | withholding or deleting objects | inherent; detected as missing, never as data loss | §9 |
| Elevation of privilege | a member plants a plugin, theme or snippet | shared-vault policy: excluded both ways unless consented; plugins need the permission screen | W13.S2 |
| Rollback | an old manifest or keyring | counters, history, chain; unverified devices don't upload | §5, §9 (N6) |
| Split view | a provider hides a revocation from some devices | inherent; two-way pairing between views is refused | §9 |

## Out of scope

- A device compromised while enrolled (it can read what it syncs).
- Metadata: sizes, timing, object counts.
- The providers' own access control and availability.
- Side channels of the JavaScript engine and the OS.
- The collaboration rooms (Yjs, `sync-server/collab`), which have their own
  audit scope (`docs/adr/004-crdt-yjs13-rooms.md`) unless the auditor adds them.
