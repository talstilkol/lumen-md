# Vercel CI (Beta) as a fallback for lint and unit tests (W11.Q12)

**Status:** trial set up 15.11.2026; **decision pending the first runs** (owner, below). Buildkite stays the CI of record either way.

## Why try it

Vercel CI went into Beta on all plans on 28.10.2026 (https://vercel.com/blog/introducing-vercel-ci). It runs the Turborepo tasks tagged `ci` in `turbo.json`, serves unchanged tasks from the remote cache, and posts a GitHub check. That could give lint and the unit tests a second runner with no GitHub Actions and no agent of our own. The announcement says nothing about browsers, so e2e, the build and the gates stay on Buildkite.

## What is set up

- `ci/vercel-ci-trial/turbo.json` tags two tasks `ci`: `lint` (`npm run lint`) and `test` (`npm run test`, vitest). Each task's `inputs` decide when the cache can answer.
- **It is not at the repo root, on purpose.** Vercel detects Turborepo from a root `turbo.json`. Vercel CI also reads a root `turbo.json` and the `ci` key of a root `vercel.json` (Vercel CI configuration reference, https://vercel.com/docs/ci/configuration). A root file could change how the existing Vercel project (lumen-md.vercel.app) builds every branch. So on `main`, the trains and the lane branches, nothing at the root changes. `vercelCiTrial.test.ts` fails if a root `turbo.json` appears.
- Nothing is restructured: the repo stays one package. The announcement says single-package repos work; that is part of what the trial checks.
- `turbo` itself is not in the lockfile yet (the registry is offline in the cloud lane); the owner adds it with the first run.

## How to run the trial (owner)

The trial runs only on a throwaway branch, `trial/vercel-ci`. That branch is never merged, and the root `turbo.json` exists only there.

```bash
git switch -c trial/vercel-ci origin/main
cp ci/vercel-ci-trial/turbo.json turbo.json
npm install --save-dev turbo@^2          # Vercel CI runs the tasks through turbo
git add turbo.json package.json package-lock.json
git commit -m "trial: Vercel CI on this branch only [skip ci]"
git push -u origin trial/vercel-ci
```

1. Turn Vercel CI on for the project in the Vercel dashboard (Project → Settings → CI, Beta).
2. Push to `trial/vercel-ci` and wait for the `lint` and `test` runs. The run page and its logs give each task's time in seconds.
3. Run Buildkite on the same commit, then fill in the table below with:
   `node scripts/ci/ci-compare.mjs --buildkite build.json --vercel lint=<s>,test=<s> --vercel-cost <$> --needs-restructure <yes|no>`
4. If the rule keeps it, open a PR that moves `turbo.json` to the root with the Vercel preview build checked. If not, delete the `trial/vercel-ci` branch and `ci/vercel-ci-trial/`.

A preview build of `trial/vercel-ci` on the existing project sees the root `turbo.json`. That preview is part of what the trial checks: its build command must still be `node scripts/vercel-build.mjs` (from `deploy/vercel.base.json`), and its Ignored Build Step must be unchanged. Production (`main`) never sees the file.

## The comparison

Buildkite Free (checked in R5, 14.11.2026): 5 active users, 10 concurrent self-hosted jobs, 2,000 hosted Linux vCPU-minutes a month, 30-day retention. Pro is $30 per user a month.

On one commit, both run; `node scripts/ci/ci-compare.mjs` reads Buildkite's build JSON and the Vercel times and prints the table and the decision.

| step | Buildkite s | Vercel CI s |
|---|---|---|
| lint | owed | owed |
| unit tests | owed | owed |

## The rule

Keep Vercel CI as a fallback for these two steps only if all of these hold, otherwise drop it and delete `ci/vercel-ci-trial/`:

1. it ran both without restructuring the repo into a Turborepo;
2. it cost nothing on the current Vercel plan;
3. it was not more than 1.5× slower than Buildkite on either step.

## Decision

Pending. Fill in the table and the line below from the first run:

`Decision (date, commit): keep / drop — reasons`
