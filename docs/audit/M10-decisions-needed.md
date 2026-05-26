# M10 — Decisions you need to make

The round-4 plan asked for a clear list of items the assistant can't
resolve unilaterally. Here it is.

## Open Dependabot PRs (5)

All against `main`. Each is a single-bump backport that's safe to
merge if CI passes:

| PR | Bump | Risk |
|---|---|---|
| [#51](https://github.com/talstilkol/lumen-md/pull/51) | `ws` 8.20.1 → 8.21.0 in /sync-server | low — patch |
| [#50](https://github.com/talstilkol/lumen-md/pull/50) | `astro` 6.1.9 → 6.3.7 in /docs | medium — minor; visual review of docs/ recommended |
| [#49](https://github.com/talstilkol/lumen-md/pull/49) | `qs` 6.15.1 → 6.15.2 in /mcp-server | low — patch |
| [#48](https://github.com/talstilkol/lumen-md/pull/48) | `brace-expansion` 5.0.5 → 5.0.6 | low — patch |
| [#43](https://github.com/talstilkol/lumen-md/pull/43) | `@babel/plugin-transform-modules-systemjs` 7.29.0 → 7.29.4 | low — patch |

**Decision needed:** merge all 5 in a single dependabot-cleanup pass,
or close them and let dependabot re-open with the latest available.

## Push policy for local main (65+ commits ahead of origin/main)

Local `main` is at `38023fb3`. Origin `main` is at `b6593b6d`. They've
been reconciled (the merge commit `b4ad084a` pulled origin/main into
local; secondary conflicts were resolved in `38023fb3`). The two are
no longer divergent — local is strictly *ahead* of origin by the
65-ish original local commits PLUS the two merge-resolution commits.

**Decision needed:** when do you want to push local → origin? Options:

1. **Push now** (`git push origin main`). Origin gets all the local
   development work + the merge. Simplest, fastest.
2. **Push to a feature branch** and open a review PR. Keeps origin
   clean if you want to review the 65 commits in context.
3. **Hold** until you've manually reviewed the diff. Slowest, safest.

I haven't pushed anything in this session without explicit OK.

## Git config

Verified `git config --global credential.helper` is **unset**. The
earlier round-3 concern ("did `gh auth setup-git` add a credential
helper that should be removed?") is resolved — there's no global
credential helper to undo. No action needed.

## Branch hygiene

Local branches not on origin: none unusual (one Claude worktree branch
at `/Users/tal/projects/md editor/.claude/worktrees/loving-wilson-a0a148`
on `claude/loving-wilson-a0a148`). Don't touch the worktree branch —
it's owned by another Claude session.

## CI status

| Job | Last seen on `main` (b6593b6d) | Status |
|---|---|---|
| typecheck • test • build | ✅ | green |
| e2e (chromium) | ✅ | green |
| e2e (firefox) | ✅ | green |
| e2e (webkit) | ✅ | green |
| e2e against production build | ✅ | green |
| signaling server health | skipped | only fires on push |

**Decision needed:** none — CI is green on main. The next push from
local will re-run all of these.

## Follow-up tasks (chips already filed in this session)

1. **Split e2e Playwright per-browser for parallel CI** — already done
   in round-25 (in this PR). The chip can be dismissed.
2. **Fix Milkdown lifecycle race in WysiwygEditor + slash plugin** —
   still pending. The race is currently filtered in
   `e2e/user-journey.spec.ts` rather than fixed.

## Summary

Three concrete decisions, listed in order of likely cost-to-defer:

1. **Push local → origin** — small risk, blocks no one if delayed.
2. **Dependabot batch (#43, #48, #49, #50, #51)** — security backports,
   safe enough to do in one pass.
3. **Milkdown race proper fix** — already filed as a follow-up task,
   no immediate harm if it stays filtered.

No item here requires me to act; all are user-call.
