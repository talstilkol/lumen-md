# CI on your machine — `npm run ci:local`

`npm run ci:local` runs what CI's `check` job runs, then e2e on Chromium against the production build:

typecheck → hygiene → lint → i18n (keys + en/he drift) → licence gate → security headers → vitest → build → bundle budget → e2e.

A step whose tool doesn't exist on this branch (no `lint` script yet, no licence gate, no `scripts/headers.mjs`) shows up as "not here". It is not a failure.

| Command | What it runs |
|---|---|
| `npm run ci:local` | Everything (vitest without coverage). |
| `npm run ci:local -- --coverage` | Vitest with coverage (CI's 65% gate). |
| `npm run ci:local -- --changed` | Only what the diff can break: `vitest related` for the changed files. Build, budget and e2e run only when app code changed; e2e is the smoke test plus the changed specs. The base is the upstream branch, else `origin/main`. |
| `npm run ci:local -- --changed --base origin/fix/codex-backlog` | The same, against an explicit base (stacked branches). |
| `--skip e2e,build` / `--only typecheck,test` | Pick steps by id: `typecheck`, `hygiene`, `lint`, `i18n`, `licenses`, `headers`, `test`, `build`, `budget`, `e2e`. |
| `--bail` | Stop at the first failure. |
| `npm run ci:local -- --install-hook` | Pre-push hook that runs `ci:local --changed --skip e2e --bail`. Bypass it once with `git push --no-verify`. |

For e2e, `ci:local` serves `dist/` with `vite preview` on a free port and runs Playwright's Chromium project. It uses a lane's `playwright.lane.config.ts` when there is one (see lanes.md). Set `PW_CHROMIUM` if Playwright's own Chromium isn't installed.

It prints a summary table with the time each step took, and exits 1 if any step failed.
