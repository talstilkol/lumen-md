---
title: Automatic merging
description: When the same note changed in two places, Lumen merges the two edits itself and asks only when both changed the same words — the same way for encrypted sync, git and edits made outside Lumen.
type: how-to
tasks: ["W1.9", "W11.S7", "W11.S6"]
---

A note can change in two places at once: on your laptop and your phone
between two syncs, in Lumen and in a `git pull`, or in Lumen and in another
editor working on the same folder. Lumen merges both edits on its own, keeps
both versions in the note's history, and opens the conflict dialog only for
the part both sides changed in different ways.

## How the merge works

Lumen compares each version with the last one both sides had:

1. **Front matter, key by key.** A field one side changed takes that change.
   When both sides changed a list — `tags`, `aliases` — both sets of
   additions and removals are applied (`[a, b]` + `c` here, `d` there →
   `[a, b, c, d]`). The same field changed to two different values is a
   conflict. The merged front matter must be valid YAML; if it would not be,
   Lumen does not merge it.
2. **The body, line by line.** Lines only one side touched take that side's
   version.
3. **Then word by word.** If both sides edited the same line or paragraph —
   one fixed a typo, the other added a word — both edits are kept.
4. **What is left asks.** Only when both sides changed the *same words*
   differently (or one deleted what the other edited) does the conflict
   dialog open, showing just those places. Both sides typing the same new
   text at the same place asks too, since keeping it once would drop one
   side's typing. The same deletion on both sides merges.

Nothing is lost: both versions go into the note's **history** (marked *kept
at a merge*), so any merge can be undone from the version list.

## Where it applies

| Where | What happens |
|---|---|
| [Encrypted sync](/sync/e2ee/) | A note both devices changed is merged before the dialog; binary files are kept side by side. |
| [Git](/sync/git/) | A pull merges the files both sides changed; what still overlaps gets the usual conflict markers for the resolution screen. |
| Changes outside Lumen | A note with unsaved edits that another app changed on disk is merged into the editor and saved; if you keep typing while it merges, the dialog decides instead. |

All three use the same merge engine (`src/sync/merge/textMerge.ts`).

## How often it merges by itself

In the test of 500 random pairs of concurrent edits to ordinary notes (a
few word changes, new lines, deleted lines, new tags and changed fields on
each side), 459 merge without a dialog (92%), every word either side added
is in the result, and the front matter is valid YAML in every merge.

Those pairs are ones we generated. On **public editing traces** (plan
W11.S7: `npm run bench:merge-traces`, numbers in
`bench/merge-traces/results.json`):

- **Two people really typing at the same time** (josephg/editing-traces,
  `concurrent_traces`): of the 5,886 moments where their concurrent edits
  met, 5,874 merge without a dialog (99.8%). No character is lost, and every
  one of those merges is exactly the text the two ended up with.
- **One author's history cut into two halves**, as if typed on two devices
  (the sequential traces and crdt-benchmarks B4, 200 keystrokes per side):
  10% merge without a dialog. Both halves almost always touch the same
  paragraph, often the same sentence, so the merge asks. That is the hard
  case, not the usual one, and this number is reported, not a target.
- **No character is lost in any of them.** Before a fix (W1.9), 4 of the
  2,700 split pairs did lose characters in a merge without a dialog: 59 in
  all, a newline in one of them. In each, both sides had written the same
  new text at the same place, and the merge kept it once. Now that place
  asks, like any other place both sides wrote.
## Conflict files instead of a merge

If you'd rather not merge, choose **Keep a conflict file** under
*What syncs on this device* in the encrypted sync panel. This is Syncthing's
way, and Obsidian's since 1.9.7. When both devices changed the same note:

- The note gets the other device's version.
- This device's version is kept next to it as
  `<name>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.md` (the time is UTC; the
  device is the first 7 characters of its id). Ignore patterns such as
  `*.sync-conflict-*` match it.
- Both versions are also in the note's history.

For any other text file the version already in the vault wins, and this
device's version goes into the file's history. A binary file gets a
conflict file too, because the history keeps text only. Nothing is dropped.

The choice is this device's only. It is kept in this browser's storage,
never in the vault, and it doesn't sync: a phone can keep conflict files
while the laptop merges.

