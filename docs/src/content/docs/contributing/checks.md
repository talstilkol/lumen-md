---
title: Checks on every branch (Vercel)
description: Lumen's gates run in the Vercel build of every branch, without GitHub Actions — what runs, what a red status means, and where the old CI checks went.
type: how-to
---

`main` and the integration trains (`verify/…`) get a Vercel build when
pushed, and Vercel reports it on the commit as the **Vercel** status; a pull
request's own branch is verified through the train (see
[Builds that are skipped](#builds-that-are-skipped)). That build is Lumen's gate: the build
command is `node scripts/vercel-build.mjs` (in `deploy/vercel.base.json`),
and a preview build runs every check. A pull request with a failing test or
a broken gate gets a red **Vercel** status; a clean one gets a green one.
No GitHub Actions minutes are used.

| Build | What runs, in order |
|---|---|
| Preview (the `verify/…` trains) | lockfile drift, build, `live:meta` on `dist/` (the deployed metadata names only lumen-md.vercel.app), bundle budget, the secret scan of `dist/`, vitest (without the nightly-only suites), e2e (the fast set on chromium, with the Hebrew axe and aria specs; smoke on firefox), `i18n:check`, hygiene, `docs:sync`, `docs:complete` (every page in both languages, and each Hebrew page with its English page's sections, help anchors and at least 60% of its words), the licence gate, the mutation floor (`mutation:check`) |
| Production (`main`) | build, `live:meta` on `dist/`, bundle budget, build manifest, the crypto attack tests (`test:attacks`) |

The gates stop at the first failure. The build log ends with the gate that
failed and the ones that passed before it, with their times:

```text
✗ vercel-build: the vitest gate failed (212.4 s, exit 1). Passed before it: build 95.1 s, budget 1.2 s.
```

## The fast gate and the nightly run

A preview build must end inside 38 of the 45 minutes Vercel allows; one
that runs longer fails (`GATE_BUDGET_MIN`). So the build is a fast gate and
the rest runs every night on the second host. One file says what runs where,
`scripts/test-tiers.mjs`, and `src/__tests__/testTiers.test.ts` checks that
nothing falls out of both:

| | Vercel preview (every push to a train) | Nightly (`npm run nightly:full`) |
|---|---|---|
| vitest | every file except `VITEST_NIGHTLY_ONLY` (golden sets, timing budgets, whole runtimes), one worker per CPU of the build's quota | the whole suite in 2 shards |
| e2e | `E2E_FAST` on chromium (about 50 tests), smoke on firefox | every spec on chromium, firefox and WebKit, 4 shards each, against the production build |
| timing budgets | — | the `@nightly` perf project |
| Ignored Build Step | — | `npm run check:vercel-ignore` (W6.10) |

Each preview writes its gate times and the slowest vitest files to
`reports/vercel-build.json`, served as `/__build/receipt.json`. A spec joins
`E2E_FAST` once it passes in the nightly run.

## Builds that are skipped

Vercel builds one deployment at a time, so every queued build delays the
ones behind it. `scripts/vercel-ignore.sh` (the config's `ignoreCommand`)
skips a build before it starts when:

- its branch is neither `main` (production) nor an integration train
  (`verify/…`): a pull request's branch is verified through the train
  (`verify/train-2`), so it does not build on its own. Setting the Vercel
  project variable `LUMEN_BUILD_ALL=1` builds every branch again;
- its commit is no longer the head of its branch: a newer push is queued
  and will be built instead. When the branch head cannot be read (no
  network, a deleted branch), the next rule decides;
- the commit changes nothing the web build reads (Markdown outside `src/`
  and `public/`, the docs site, the other deployables).

A skipped build shows as **Canceled** in Vercel, not as a pass: the
branch's status comes from its newest commit.

**These rules take effect only once the Vercel project's Ignored Build
Step is set.** Lumen's config is `vercel.ts`, which Vercel compiles after
the ignore step has already run, so the `ignoreCommand` in
`deploy/vercel.base.json` is never read. The project setting (Settings →
Git → Ignored Build Step) must be `bash scripts/vercel-ignore.sh`. Until it
is, every pushed branch builds. A branch whose commit has no such script
fails that command with a non-zero exit, so it builds as before.

## Running the same checks locally

```bash
node scripts/vercel-build.mjs              # the preview set
node scripts/vercel-build.mjs --production # build, live:meta, budget and manifest only
node scripts/vercel-build.mjs --dry-run    # print the gates, run nothing
```

Outside Vercel (no `VERCEL_ENV`) the script runs the preview set, so a
local run is what the branch's build will do. Each gate is also an npm
script of its own: `npm run build`, `npm run budget`, `npm test`,
`npm run e2e:gate` (after `VITE_E2E=1 npm run build`: specs reach the app's modules through `window.__lumenTest`, which only such a build has), `npm run i18n:check`, `npm run hygiene`, `npm run docs:sync`, `npm run docs:complete`,
`npm run licenses`, `npm run lockfile:drift`, `npm run secrets:dist` (see
[Secret scan of the build](/security/secret-scan/)).

### Lockfile drift

The first preview gate, `npm run lockfile:drift`, compares the installed
tree (`npm ls --all`) with `package-lock.json` and fails on any package
installed at another version, missing, or installed without being locked,
one line per package. It also fails when `package.json` and the lockfile's
root entry disagree. What the gates test is then what ships. Without
`node_modules`, `--lock-only` checks only `package.json` against the lockfile,
and `--tree <dir>` also lists the packages that another `node_modules` (an
offline test shim) holds at versions the lockfile does not name. To fix a
drift, reinstall with `npm ci`. If `package.json` changed, regenerate the
lockfile with `npm install --package-lock-only` and commit it.

The docs have their own checks: every page has its Diátaxis kind (tutorial,
how-to, reference or explanation), every feature page names its plan task,
and every example marked `run` — like the two below — runs and passes:

```sh run
node scripts/docs-meta.mjs --check    # expect: every one typed
node scripts/docs-parity.mjs --strict
```

```js run
const { bannerFor } = await import(process.cwd() + "/scripts/lib/docsMeta.mjs");
const tasks = new Map([["W1.1", { verified: "built" }], ["W1.2", { verified: "browser" }]]);
console.log(bannerFor(["W1.2"], tasks) === null ? "verified: no banner" : "?");
console.log(bannerFor(["W1.1"], tasks).includes("Beta") ? "built: beta banner" : "?");
// expect: built: beta banner
```

## What does not run in the build

Checks that need browsers, devices or signing keys can't run in a Vercel
build. They run in a Vercel Sandbox (W1.1) or on a developer machine:

| Plan task | Was | Now |
|---|---|---|
| 8.3 Lighthouse gate | an LHCI job on every PR | The Buildkite Lighthouse step on every PR, with no label or branch condition: `npm run lighthouse` runs Lighthouse CI 0.16.1 (Lighthouse 13) on desktop (`lighthouserc.json`: performance ≥ 0.9, LCP ≤ 2.5 s, TBT ≤ 200 ms, CLS ≤ 0.1) and on a phone (`lighthouserc.mobile.json`: performance ≥ 0.8, LCP ≤ 2.5 s), 5 runs each, the median run, every limit an error. Reports stay on disk under `reports/lh/` and as build artifacts, never in public storage. A Vercel preview build also runs `npm run perf:gate` after e2e. `src/__tests__/perfGate.test.ts` fails when a limit is looser than the plan. INP is measured by `e2e/inp-budget.spec.ts`. |
| 0.19 PR gate (Danger.js, size-limit) | a Danger comment and size-limit on every PR | the size part is the **bundle budget** gate (every main chunk has a budget, `scripts/bundle-budget.mjs`); an unlisted network call fails **vitest** (`src/__tests__/cloudRoutes.test.ts` audits every cloud route); the licence diff is the **licence gate**. The PR comment itself has no replacement yet |
| 13.3 Android and iOS builds | mobile builds in CI | `npm run android:sync` / `npm run ios:sync` on a machine with the SDKs (iOS needs macOS); the web part they ship is what the preview build checks |
| 13.4 Release pipeline | a release workflow | a local release script, signed artifacts and rollback on a developer machine; the web app's release is the production build |
| Playwright e2e | e2e jobs on every PR | the **e2e** gate runs the fast set (`E2E_FAST` in `scripts/test-tiers.mjs`) on chromium and the smoke spec on firefox in the build (`scripts/e2e-gate.mjs`); the whole suite runs every night in shards (`npm run nightly:full`), since on the build machine the chromium project alone takes about 30 minutes. WebKit cannot run in the build: Playwright's WebKit needs glibc 2.38 and the build image (Amazon Linux 2023) has 2.34. Safari is covered on a Mac (W4.22) |

## The whole e2e suite before main moves

The Buildkite step `e2e-shards` runs the whole chromium project in 4 shards
in parallel (`node scripts/e2e-gate.mjs --full`), each on the production
build made with `VITE_E2E=1` and each inside a 10-minute box. The step
`e2e-receipt` merges the shards into `reports/e2e-<sha>.json`, signed with
the host's Ed25519 key, and is red unless every shard passed.

main moves only through `npm run promote:main -- <commit> --push`. It
refuses unless that commit (or one with the same tree) has the signed
report, the report verifies with a key in `security/e2e-receipt-keys/`
as `origin/main` has it (read with git, never from the commit being
promoted; a `--key` or `--keys` inside the checkout is refused), 0 tests
failed and every shard finished inside its box. It pushes only as a
fast-forward, never with force. `npm run promote:check` (the WebKit and
Safari receipts) is a separate check, and both must pass.

## When a gate is red

Open the Vercel deployment from the commit's status and read the end of
the build log: the failing gate is named there. Fix it on the branch and
push again; Vercel builds the new commit. A failing gate is never skipped
or loosened to get a green status.
