# ADR-004: CRDTs: Yjs 13 for live rooms only; no move to Loro or Automerge

**Status:** Accepted (plan W11.S16, research R3.11)
**Date:** 2026-11-15
**Next review:** 2027-05-15, or earlier when a trigger below fires

## Context

Lumen syncs a vault of Markdown files. Two different things are called
"sync":

- **The vault:** Markdown files on disk are the source of truth. The
  encrypted sync (W1.7, 3.4) moves whole files, end-to-end encrypted per file
  (age and the keyring), and merges concurrent edits with a three-way text
  merge: diff3 by line, then by word, with front matter merged by key (W1.9,
  `src/sync/merge/textMerge.ts`). Git and outside changes use the same merge.
- **Live rooms:** two or more people editing one note at the same moment
  (collab, the canvas). This needs a CRDT, and Lumen uses **Yjs 13**
  (`yjs ^13.6.30`), with each room's updates encrypted with the room's key.

In 2026 the alternatives moved:

- **Yjs 14** (RC) adds attribution (who wrote what), suggestions and diffs,
  which is the path to suggest mode (W3.11). It is not GA. The ProseMirror
  binding becomes `@y/prosemirror`.
- **Automerge 3** cut memory by more than 10× and added the Hexane storage.
  Its E2EE and access control, **Keyhive**, is not available for JS/TS.
- **Loro 1.11** is the fastest on the automerge-paper trace: its own B4 run
  gives Loro 1,754 ms, Yjs 2,812 ms and Automerge 7,109 ms.

## Decision

1. **The Markdown files stay the source of truth.** The vault is not
   stored as a CRDT document, and the encrypted sync stays per-file E2EE
   with the three-way merge.
2. **Yjs 13 only for live rooms.** No room state becomes the vault's
   storage.
3. **No migration to Loro or Automerge,** for rooms or for the vault.

Why:

- A CRDT vault would make every file a binary document, which
  plain-text tools and git can no longer read. That breaks the promise that
  the vault is just files.
- The merge already does what the vault needs. On public traces it merges
  **99.8%** of real concurrent pairs with no dialog and 0 characters lost
  (5,874 of 5,886: W11.S7, PR #748, `bench/merge-traces/results.json`).
- Moving rooms off Yjs means rewriting the live editor binding, the canvas
  and the share room. Loro's speed gain shows only on traces far longer than
  a shared note.
- Automerge without Keyhive has no E2EE story better than ours.

## Criteria to revisit (measurable)

Any one of these opens a new ADR. Each names how it is checked.

| Trigger | Measured by | Then |
|---|---|---|
| **Yjs 14 is GA**, a non-RC release on npm, with `@y/prosemirror` stable | `npm view yjs dist-tags.latest` ≥ 14.0.0 | Plan the move of live rooms to Yjs 14 for attribution (W3.11), with the same room encryption |
| **Keyhive ships for JS/TS**, a published package with E2EE documents | the Automerge blog and npm; a working encrypted document in a spike | Reassess Automerge for rooms only, against the table below |
| **Rooms get slow:** the two-client edit delay goes over a **150 ms p95** | `npm run owner:share`, step 1: two clients edit one room through the live-share server (`docs/.../sync/relay-server.md`) | Find out whether Yjs is the cause (the network usually is) and measure B4 (below) before changing anything |
| **The vault merge degrades:** under **90%** merged, or any character lost, on the real concurrent pairs | `npm run bench:merge-traces` (W11.S7, PR #748) | Fix the merge. This is not a reason to move the vault to a CRDT. |

**The B4 measurement when a decision is due:** run dmonad/crdt-benchmarks B4
(the automerge-paper trace, also in `bench/merge-traces/manifest.json`) for
Yjs (current and 14), Loro and Automerge on the same machine. Record the
time, the document size and the parse time. A library is worth a migration
only if it is at least **2× faster to apply and parse**, and also
encrypts rooms as we do, keeps a JS API we can test offline, and has a
licence our licence gate allows.

## Consequences

- `package.json` keeps `yjs` at major 13. `src/__tests__/adrCrdt.test.ts`
  fails on a major bump, pointing here, so a move to 14 comes with an ADR.
- Suggest mode (W3.11) waits for Yjs 14 GA, or is built without attribution.
