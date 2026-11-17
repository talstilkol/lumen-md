# Encrypted sync: known findings

What the project's own reviews found and left open, or accepted as inherent
(plan W13.S4). The reviews are listed in `spec/sync-protocol.md` §10;
the IDs here are theirs.

## Open

| ID | Finding | Status |
|---|---|---|
| EXT-1 | No external audit yet; every review so far was internal | open: the pack exists for it (W11.O6, W13.S5) |
| S3-ADR | Shared vaults use one shared epoch key; removing a member needs a re-key from a trusted device; no CGKA (BeeKEM/MLS) yet | open: decision in docs/adr/005-group-keys.md |
| W13.S2 | A plugin that arrives with consent is gated by the permission screen in code (`plugins/vaultPlugins.ts`); no app screen lists vault plugins yet | open |
| H2 | A revocation that keeps losing to same-epoch keyring rewrites needs the storage login changed first | open (documented) |
| META | Sizes are padded, but object count and timing are visible to the provider | open by design |

## Accepted (inherent)

| ID | Finding | Why it stays |
|---|---|---|
| §9 no-anchor | A device opened with the passphrase alone can be shown an old state | it says "freshness not verified" and does not upload until paired |
| §9 split view | A provider can hide a key change from some devices | only a channel outside the provider can show it; two-way pairing between views is refused |
| §9 fork | Two re-keyers under a provider that lies about the manifest can both commit | detected on the next round and revoked again; prevention needs a CAS-keeping server |
| G4 | A pairing code already handed out, entered after cancel on a device kept on the old view, still pairs | only telling that device helps |
| GDRIVE | Google Drive has no atomic create-only | Drive is sync-only: no re-key, revocation or enrollment through it |
