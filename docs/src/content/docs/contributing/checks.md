---
title: Checks on every branch (Vercel)
description: Lumen's gates run in the Vercel build of every branch, without GitHub Actions — what runs, what a red status means, and where the old CI checks went.
---

Every branch pushed to GitHub gets a Vercel build, and Vercel reports it on
the commit as the **Vercel** status. That build is Lumen's gate: the build
command is `node scripts/vercel-build.mjs` (in `deploy/vercel.base.json`),
and a preview build runs every check. A pull request with a failing test or
a broken gate gets a red **Vercel** status; a clean one gets a green one.
No GitHub Actions minutes are used.

| Build | What runs, in order |
|---|---|
| Preview (every branch except `main`) | build, bundle budget, vitest, e2e (smoke on chromium and firefox), `i18n:check`, hygiene, `docs:sync`, the licence gate |
| Production (`main`) | build, bundle budget — as before |

The gates stop at the first failure. The build log ends with the gate that
failed and the ones that passed before it, with their times:

```text
✗ vercel-build: the vitest gate failed (212.4 s, exit 1). Passed before it: build 95.1 s, budget 1.2 s.
```

## Running the same checks locally

```bash
node scripts/vercel-build.mjs              # the preview set
node scripts/vercel-build.mjs --production # build and budget only
node scripts/vercel-build.mjs --dry-run    # print the gates, run nothing
```

Outside Vercel (no `VERCEL_ENV`) the script runs the preview set, so a
local run is what the branch's build will do. Each gate is also an npm
script of its own: `npm run build`, `npm run budget`, `npm test`,
`npm run e2e:gate` (after a build), `npm run i18n:check`, `npm run hygiene`, `npm run docs:sync`,
`npm run licenses`.

## What does not run in the build

Checks that need browsers, devices or signing keys can't run in a Vercel
build. They run in a Vercel Sandbox (W1.1) or on a developer machine:

| Plan task | Was | Now |
|---|---|---|
| 8.3 Lighthouse gate | an LHCI job on every PR | `npm run lighthouse` (median of 5 runs, the thresholds in `lighthouserc.json`) in the Sandbox, against the preview's build; not a build step, since it needs Chromium |
| 0.19 PR gate (Danger.js, size-limit) | a Danger comment and size-limit on every PR | the size part is the **bundle budget** gate (every main chunk has a budget, `scripts/bundle-budget.mjs`); an unlisted network call fails **vitest** (`src/__tests__/cloudRoutes.test.ts` audits every cloud route); the licence diff is the **licence gate**. The PR comment itself has no replacement yet |
| 13.3 Android and iOS builds | mobile builds in CI | `npm run android:sync` / `npm run ios:sync` on a machine with the SDKs (iOS needs macOS); the web part they ship is what the preview build checks |
| 13.4 Release pipeline | a release workflow | a local release script, signed artifacts and rollback on a developer machine; the web app's release is the production build |
| Playwright e2e | e2e jobs on every PR | the **e2e** gate runs `e2e/smoke.spec.ts` on chromium and firefox in the build (`scripts/e2e-gate.mjs`); the whole suite runs with `npx playwright test` on a developer machine or in the Sandbox (W1.1), since on the build machine the chromium project alone takes about 30 minutes. WebKit cannot run in the build: Playwright's WebKit needs glibc 2.38 and the build image (Amazon Linux 2023) has 2.34. Safari is covered on a Mac (W4.22) |

## When a gate is red

Open the Vercel deployment from the commit's status and read the end of
the build log: the failing gate is named there. Fix it on the branch and
push again; Vercel builds the new commit. A failing gate is never skipped
or loosened to get a green status.
