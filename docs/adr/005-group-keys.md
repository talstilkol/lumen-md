# ADR-005: Group keys for shared vaults: keep the shared epoch key; wait on BeeKEM; no MLS

**Status:** Accepted (plan W13.S3)
**Date:** 2026-11-17
**Decision:** wait
**Next review:** 2027-05-17, or earlier when a trigger in *Reopen when* fires

## Context

A family or classroom vault (W12.S4) is one encrypted vault that several
people write. Today every member's device holds the same **epoch secret**
(spec §5). Removing a member means a re-key: a trusted device makes a new
epoch secret and wraps it, one age X25519 stanza per remaining device, in a
new keyring. The ACL (signed by the admin) decides who may write.

Three ways to agree on a group key were compared:

- **Shared epoch key** (today): O(n) wraps per removal, no ordering needed
  beyond the keyring's compare-and-swap; works on every provider Lumen
  supports, including those that cannot order writes (a synced folder,
  Google Drive; spec §9).
- **MLS** (RFC 9420; OpenMLS): a ratchet tree (TreeKEM), O(log n) per
  update, forward secrecy and post-compromise security per commit. It needs
  a **delivery service that orders commits**: two concurrent commits cannot
  both apply; the loser redoes its work.
- **BeeKEM** (Kleppmann et al., ePrint 2026/1434; Ink & Switch Keyhive):
  TreeKEM whose concurrent updates **merge** (a node can hold several
  "conflict" keys until a later update replaces them), so it works without
  a trusted server or an ordering service, with logarithmic cost when there
  is no concurrency.

## The numbers (scripts/experiments/group-keys/proto.mjs)

Bytes one device writes to **remove one member** of an n-member vault
(real X25519 / HKDF / AES-GCM sizes; age stanzas as base64 JSON for the
shared key; 32-byte public keys and 92-byte wraps for the trees):

| n | shared epoch key | TreeKEM / BeeKEM |
|---:|---:|---:|
| 4 | 1332 | 156 |
| 8 | 3108 | 280 |
| 16 | 6660 | 404 |
| 32 | 13764 | 528 |
| 64 | 27972 | 652 |
| 128 | 56388 | 776 |
| 256 | 113220 | 900 |
| 1024 | 454212 | 1148 |

**Four members updating at once** (an offline weekend, a split provider):

| n | TreeKEM: total bytes (3 commits refused and redone) | BeeKEM: total bytes (merged) | a removal right after: TreeKEM | BeeKEM |
|---:|---:|---:|---:|---:|
| 8 | 2604 | 1488 | 464 | 556 |
| 32 | 4340 | 2480 | 896 | 988 |
| 256 | 6944 | 3968 | 1544 | 1636 |
| 1024 | 8680 | 4960 | 1976 | 2068 |

Crypto time to remove one of 1024 on the build machine: about 300 ms for the
shared key and under 25 ms for the tree (both well under a second).

## Comparison on the four axes

| Axis | Shared epoch key | MLS (OpenMLS) | BeeKEM (Keyhive) |
|---|---|---|---|
| Remove a member without a trusted server | yes: any admin device re-keys; the provider stays untrusted | no: needs an ordering delivery service | **yes** |
| Concurrent / split work | the keyring CAS serialises; a split view is the inherent limit of §9 | concurrent commits refused, redone (table above) | **merged**; conflict keys cost a little until the next update |
| Update size | O(n): 14 KB at 32 members, 444 KB at 1024 | **O(log n)** | **O(log n)** without concurrency, more with conflicts |
| Maturity (audits, licence, JS) | in production here; internal reviews 12.11 ×9; vectors with two independent readers | RFC 9420 (2023); OpenMLS audited, MIT; Rust/WASM | paper and proofs 2026; Keyhive pre-1.0, no audit, no JS release |

## Decision

**Wait.** Keep the shared epoch key with the admin-signed ACL for shared
vaults. Do not adopt MLS: its ordering requirement does not fit providers
that cannot order writes, and the family and classroom sizes Lumen targets
(≤ 40 devices) cost at most about 17 KB per removal today. Do not build a
CGKA ourselves.

## Reopen when

Any one of these:

1. Keyhive / BeeKEM ships an **audited** release with a stable wire format
   and a JS or WASM build under a licence compatible with Lumen's.
2. A shared vault needs **more than 128 devices** (a school, ~56 KB per
   removal), or removals become frequent enough that O(n) keyrings matter on
   mobile data.
3. A requirement for **post-compromise security per update** (healing a
   member's leaked key without a full re-key), or for removal while every
   admin device is offline.
4. Lumen's relay becomes the only provider for shared vaults (then an
   ordering service exists and MLS is back on the table).

## Consequences

- Shared vaults stay limited by §9's inherent limits (split view, fork);
  the audit pack lists this as open (docs/sync-audit/open-findings.md, S3-ADR).
- The prototype stays in `scripts/experiments/` and is not shipped.
- `src/__tests__/adrGroupKeys.test.ts` recomputes the tables from the
  prototype; a change to either fails it until both agree.
