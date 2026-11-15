# Vercel CI (Beta) as a fallback for lint and unit tests (W11.Q12)

**Status:** trial set up 15.11.2026; **decision pending the first runs** (owner, below). Buildkite stays the CI of record either way.

## Why try it

Vercel CI went into Beta on all plans on 28.10.2026 (https://vercel.com/blog/introducing-vercel-ci). It runs the Turborepo tasks tagged `ci` in `turbo.json`, serves unchanged tasks from the remote cache, and posts a GitHub check. That could give lint and the unit tests a second runner with no GitHub Actions and no agent of our own. The announcement says nothing about browsers, so e2e, the build and the gates stay on Buildkite.

## What is set up

- `turbo.json` at the root tags two tasks `ci`: `lint` (`npm run lint`) and `test` (`npm run test`, vitest). Each task's `inputs` decide when the cache can answer.
- Nothing is restructured: the repo stays one package. The announcement says single-package repos work; that is part of what the trial checks.
- `turbo` itself is not in the lockfile yet (the registry is offline in the cloud lane); the owner adds it with the first run.

## The comparison

Buildkite Free (checked in R5, 14.11.2026): 5 active users, 10 concurrent self-hosted jobs, 2,000 hosted Linux vCPU-minutes a month, 30-day retention. Pro is $30 per user a month.

On one commit, both run; `node scripts/ci/ci-compare.mjs` reads Buildkite's build JSON and the Vercel times and prints the table and the decision.

| step | Buildkite s | Vercel CI s |
|---|---|---|
| lint | owed | owed |
| unit tests | owed | owed |

## The rule

Keep Vercel CI as a fallback for these two steps only if all of these hold, otherwise drop it and delete `turbo.json`:

1. it ran both without restructuring the repo into a Turborepo;
2. it cost nothing on the current Vercel plan;
3. it was not more than 1.5× slower than Buildkite on either step.

## Decision

Pending. Fill in the table and the line below from the first run:

`Decision (date, commit): keep / drop — reasons`
