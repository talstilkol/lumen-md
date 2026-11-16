# W10.F28: the W9.8 `w-NC-*` worktrees, and where their commits are

Checked on 17.11.2026 by lane FA (audit r3) against `verify/train-7` f090c20812. Every worktree is clean (`git status` empty). Each HEAD is either an ancestor of the train or on a pushed branch, so **no work exists only on the local disk**.

| worktree | branch | HEAD | where it is |
|---|---|---|---|
| w-NC-223 | nc-223 | 27e7befa47 | in verify/train-7 |
| w-NC-235 | nc-235 | 1334460696 | in verify/train-7 |
| w-NC-258 | nc-258 | aeb77482d4 | in verify/train-7 |
| w-NC-261 | nc-261 | ba8c89c301 | in verify/train-7 |
| w-NC-267 | nc-267 | d40c48b9f9 | in verify/train-7 |
| w-NC-272 | nc272-work | fa8cd877e5 | in verify/train-7 |
| w-NC-275 | nc-275 | e1ecaeaaee | pushed: origin/feat/e2ee-sync-core, origin/pr/275 (the same change reached the train as dd04b2f161, plan/w98-ledger.md rows 2.28 to 2.31) |
| w-NC-277 | nc-277 | eae63aba62 | in verify/train-7 |
| w-NC-306 | nc-306 | 4a807c4b7f | pushed: origin/feat/search-ops, origin/pr/306 |
| **w-NC-316** | none | none | **never existed.** There was no worktree, no `nc-316` branch and no commit made in one. PR #316 (docs/complete) was ported to the train through docs commits (58dce362fa, f1dfb46762) and through the #618 row proofs (f456af21cc). It never needed a W9.8 code worktree. |
