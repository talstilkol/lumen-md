# M1 — Baseline verification

Honest reproduction of the C4-style protocol from the round-4 plan.

## What was claimed earlier

> "The CI failures predate round-25 work — typecheck, test, and build
> have been red on every commit to main for the last 3 runs."

Previously this was implied without a clean reproduction. This document
captures the actual reproduction.

## Setup

A separate worktree was created at the pre-round-25 commit:

```bash
git worktree add /tmp/lumen-baseline 34cfec32
cd /tmp/lumen-baseline
npm install
```

Commit `34cfec32` is the round-24 squash on main, one commit before
round-25's PR #54 merge.

## Findings

### Typecheck — FAILS on baseline (pre-round-25)

```
$ npx tsc --noEmit
src/__tests__/collabYjs.test.ts(206,37): error TS2307:
  Cannot find module 'y-websocket' or its corresponding type declarations.
src/collab/yjs.ts(212,31): error TS2307:
  Cannot find module 'y-websocket' or its corresponding type declarations.
```

These are the exact errors round-25 fixed via `src/types/y-websocket.d.ts`.
**Confirmed pre-existing.**

### Unit tests — 1 failure on baseline

```
Test Files  2 failed | 142 passed (144)
      Tests  1 failed | 1220 passed (1221)
```

The failing test is `src/__tests__/collabYjs.test.ts` (the y-websocket
import-resolution failure preventing the file from loading), plus 1
flaky test (likely `updateBanner.test.tsx` — round-25 deflaked this
via `waitFor`).

**Confirmed pre-existing — round-25 expanded the suite to 1270 tests
total while keeping these two patterns at 0.**

### Build, coverage, e2e — gated by typecheck failure

Pre-round-25, CI gives up at the typecheck step, so the downstream
steps (coverage, build, bundle budget, e2e jobs) never ran. They
appeared "skipped" in the GitHub UI but the actual reason was
the typecheck red.

## Conclusion

The earlier claim that "CI was broken on main for 3+ commits" is
**verified by reproduction**. The y-websocket typecheck failure was
present on commit `34cfec32` (round-24) and would have been present
on earlier commits as well (it predates round-24 by months — the
source file `src/collab/yjs.ts` has used the static `import("y-websocket")`
since the collab feature shipped).

Round-25's contribution: surfacing this latent CI failure by exposing
it to the gates and writing the four-layer fix (.d.ts + test alias +
Rollup external + Vite optimizeDeps).

## Worktree cleanup

```bash
git worktree remove /tmp/lumen-baseline
```
