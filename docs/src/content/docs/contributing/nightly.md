---
title: Nightly runs and receipts
description: npm run nightly runs the flake hunt, the perf checks, the review triage and the weekly health on your own machine, and writes a signed report for each, without GitHub Actions.
type: how-to
---

Lumen doesn't use GitHub Actions, so the scheduled runs (plan 0.11) and the
measurements that depend on them (0.5: three nights with no flaky test; 0.14:
how many preview-build failures a local `ci:local` run would have caught) run
on the owner's machine. One command does it:

```bash
npm run nightly                  # what is due today
npm run nightly -- --dry-run     # print the plan, run nothing
```

| Kind | When | What runs |
|---|---|---|
| `flake` | every night | `npm run e2e:flake -- --all --times 5` (chromium, firefox, webkit, 5 runs each, no retries) |
| `perf` | every night | build, bundle budget, the `@nightly` perf project, and the Lighthouse trend: desktop and mobile, the median of 3 runs each, added to `reports/trend/lighthouse-history.json` and `lighthouse-trend.md`. It runs `lhci collect` only, so nothing is uploaded |
| `triage` | every night | review triage of the open PRs, the 0.14 count over the first 20 PRs since 12.11.2026, `live:meta --self-test` and the ruleset drift check (both below) |
| `weekly` | Sundays (UTC) | dependency health (audit, outdated, licences), and mutation scores: on a branch with `scripts/mutation/check.mjs`, the critical modules under real vitest (`run.mjs --critical --receipt --min 80`, then `mutation:check`), otherwise `test:mutation` |
| `fuzz` | every night | `npm run fuzz:redaction`: the [redaction fuzz](/contributing/redaction-fuzz/) with the night's seed, 20,000 cases. A leak fails the step and is saved to `tests/fuzz/redaction/regressions.json`. The sealed report keeps the night, cases, leaks and saved counts. Not counted by 0.11. |
| `sr` | every night, on a Mac with `@guidepup/*` installed | `npx @guidepup/setup --ci`, then the Hebrew journey under VoiceOver ([screen readers, automated](/editor/screen-reader-automation/)). Not counted by 0.11. |
| `supply` | every night, on a host where `scorecard`, `osv-scanner`, `cargo-deny` or `syft` is installed | the supply-chain checks ([below](#supply-chain-checks-plan-w11s5)). Not counted by 0.11. |

`--only flake,perf` picks kinds. The scheduler passes `--scheduled`, which
marks the reports as scheduled. Plan 0.11 counts only those.

## Reports and receipts

Each kind writes `reports/nightly/<date>-<kind>.json`. The report records:

- the commit, and whether the tree was clean
- the machine: platform, Node and CPU count, no host name
- every command with its exit code and duration
- the sha256 of each command's output, with its last lines
- the kind's numbers: flaky and always-failing tests per browser, perf
  annotations, review totals, audit counts

The report is **sealed**. It carries its sha256 and an Ed25519 signature
made with a key that never leaves the machine
(`~/.config/lumen-md/nightly-ed25519.pem`, mode 0600, created on the first
run; `LUMEN_NIGHTLY_KEY` overrides the path). The public half is committed as
`reports/nightly/PUBLIC_KEY.pem`. Anyone can check a committed report:

```bash
npm run nightly -- --verify reports/nightly/2026-11-13-flake.json
```

If any number in the report changed after the run, both the digest and the
signature fail.

`reports/nightly/status.json` (sealed too) is recomputed after every run
(`npm run nightly -- --status` does only that). It records:

- **0.5**: how many consecutive nights each had every browser 5 times, with
  no flaky and no always-failing test (3 are needed)
- **0.11**: which of the four kinds produced a scheduled report (all 4 are
  needed)
- **0.14**: in the first 20 PRs opened since 12.11.2026, the commits whose
  **Vercel** preview build failed. The preview build runs a subset of
  `ci:local`, so each such failure is one `ci:local` would have caught,
  except `docs:sync`, which `ci:local` doesn't run. `verify/*` integration
  branches aren't counted.
- **W6.16**: how many consecutive weeks had a scheduled weekly run in which
  every critical module scored at least 80 under real vitest (not the
  offline shim), and the receipt check passed (4 are needed). The weekly
  report carries each module's score with the sha256 of its source and
  tests, so the signed report is the receipt. The run then puts
  `scripts/mutation/receipt.json` back to the committed version, so the
  clone still pulls cleanly.

`--commit` commits `reports/nightly/` with a `[skip ci]` message. It never
pushes. A commit that changes only `reports/` doesn't start a Vercel build
(`scripts/vercel-ignore.sh`), so receipts don't use up the deployment quota.

## Scheduling it on a Mac (launchd)

Use a clone that is used only for the nightly, on its own branch, so a run
never mixes with your work:

```bash
git clone https://github.com/talstilkol/lumen-md ~/lumen-nightly
cd ~/lumen-nightly && git switch -c nightly/receipts && npm ci && npx playwright install
```

Then install the scheduler with one command. On a Mac it writes and loads
the launchd job; on Linux it adds one cron line between two markers:

```bash
npm run nightly:install                  # 02:17 every night
npm run nightly:install -- --at 03:41    # another time
npm run nightly:install -- --print       # show what it would install
npm run nightly:install -- --uninstall
```

The templates are `scripts/nightly/launchd.plist` and
`scripts/nightly/crontab`. On a Mac it installs
`~/Library/LaunchAgents/dev.lumen-md.nightly.plist`, like this:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.lumen-md.nightly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd ~/lumen-nightly &amp;&amp; git pull -q --rebase origin main &amp;&amp; npm ci --silent &amp;&amp; npm run nightly -- --scheduled --commit</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>/tmp/lumen-nightly.log</string>
  <key>StandardErrorPath</key><string>/tmp/lumen-nightly.log</string>
</dict>
</plist>
```

launchd runs a job that was missed while the Mac slept as soon as it wakes.
To publish the receipts, push the branch (`git push origin nightly/receipts`)
or open a PR from it. On Linux the cron line is:

```text
17 2 * * * cd ~/lumen-nightly && git pull -q --rebase origin main && npm ci --silent && npm run nightly -- --scheduled --commit
```

## Why not Vercel Cron or a cloud scheduled task

- **Vercel Cron** only calls a function of a deployment on a schedule. It
  can't run three browsers five times over the e2e suite, and it would spend
  the shared deployment quota.
- **A Claude Code scheduled task** starts a fresh cloud session. That session
  has no browsers and can't install packages, so it can run only the
  `triage` kind (GitHub's REST API) and read the committed receipts. That is
  useful for a morning summary, not for the measurements themselves.

## Supply-chain checks (plan W11.S5)

Scorecard and CodeQL exist in this repository only as GitHub Actions YAML,
so neither has ever run. `scripts/supply/nightly.mjs` runs the
supply-chain checks on the nightly host instead:

| Check | Command | Needs |
|---|---|---|
| Scorecard | `scorecard --repo=github.com/talstilkol/lumen-md --format json` | the network and `GITHUB_AUTH_TOKEN`, a fine-grained token with read-only access |
| OSV | `osv-scanner scan source` on `package-lock.json`, `mcp-server/package-lock.json` and `src-tauri/Cargo.lock` | the network |
| cargo deny | `cargo-deny check advisories bans` in `src-tauri` | the network (the RustSec database) |
| SBOM | `syft dir:. -o cyclonedx-json` | nothing |

```bash
npm run supply:nightly                 # what is installed; sealed receipt → reports/nightly/<date>-supply.json
npm run supply:nightly -- --dry-run    # nothing runs, no network; the receipt gives each skip reason
npm run supply:nightly -- --open-tasks # also open a GitHub issue for each new task
```

Inside `npm run nightly`, the `supply` kind runs the script and seals its
results into that night's report, under `supply`.

The receipt holds the gates of W11.M8. A check that was skipped leaves its
gates **unmeasured**, never passed:

- the Scorecard aggregate is at least 7.0;
- Branch-Protection is at least 8, Code-Review at least 8, and
  Dangerous-Workflow is 10;
- OSV finds 0 critical vulnerabilities.

A **task** is listed in the receipt, and opened as an issue with
`--open-tasks`, when:

- the Scorecard aggregate is lower than in the previous receipt;
- a gated check is below its floor;
- OSV finds a critical or high vulnerability;
- cargo deny reports an error.

Each task has a stable key, so a finding that is still there the next night
doesn't open a second issue.

The release already ships its own CycloneDX SBOM (`release/sbom.cdx.json`,
[supply chain](/security/supply-chain/)). The nightly's `syft` SBOM is a
second, independent inventory of the same tree.

## Live metadata check (plan W6.2)

`npm run live:meta` fetches the production `index.html`, `robots.txt` and
`sitemap.xml` and fails unless the canonical link, `og:url`, `og:image`,
`twitter:image`, every URL in the JSON-LD, the `Sitemap:` line and every
sitemap `<loc>` point at `lumen-md.vercel.app`, and the domain the project
doesn't own appears nowhere in them. The pattern for that domain is built from
parts in `scripts/lib/liveMeta.mjs`, the same way the PR gate builds it, so
the repository never contains it.

```bash
npm run live:meta                                   # production, after every deploy
npm run live:meta -- --url https://<deployment>.vercel.app
npm run live:meta -- --dir dist                     # a build, before deploying it
npm run live:meta -- --self-test --json live-meta.json
```

`--self-test` first checks a clean copy of the pages. Then it plants a
foreign reference in each place (canonical, `og:image`, `og:url` on another
host, body text, `Sitemap:`, `<loc>`) and fails if the check misses any of
them.

Run it **after every production deploy**: the owner's merge session runs it
right after promoting. Every night the `triage` kind runs it too, so drift
shows up within a day. The command exits 1 on any problem. It fetches with
Node and falls back to `curl`, which follows `HTTPS_PROXY`.

## The GitHub rulesets (W11.S4)

No GitHub Actions run here, so only GitHub itself can stop a push to `main`
or a merge without review. The rules for `main` and `verify/*` are code, in
`security/github-ruleset.json`:

- a pull request with one approval, including approval of the most recent push;
- stale approvals are dismissed, and code owners must review;
- no force push and no deletion;
- signed commits;
- the `Vercel` and `lumen/buildkite` statuses.

The admin role may bypass only through a pull request, so every bypass is
recorded.

```bash
npm run security:ruleset-drift                         # compare with gh api repos/talstilkol/lumen-md/rulesets
node scripts/security/ruleset-drift.mjs --print-apply  # the owner's gh commands that create them (W10.O1)
```

The script checks the file against `security/github-ruleset.schema.json`
(GitHub's REST body for a ruleset) and the policy above, then reports every
difference from what GitHub has. It exits 1 on drift, and 2 when the API
can't be read, which never counts as a match. The `triage` kind runs it every
night.

## When a run is red: the local ci-doctor (R12.12)

Everything runs on this machine, from the log of a local or train run. No GitHub Actions and no network.

| Command | What it does |
|---|---|
| `npm run ci:filter -- run -- <cmd…>` | Runs a command and prints a short summary. It never cuts an error line. The full output is kept for 7 days in `.ci-doctor/`; get it back with `npm run ci:filter -- expand <id> --grep RE`. |
| `npm run ci:sig -- red.log` | Gives one signature per failure: a 12-digit key built from the test name, the error head and the first stack frame in the repo, all masked. Paths, timings, ids and colours don't change the key; another error does. Failures are grouped into kinds with Drain. |
| `npm run ci:kedb -- red.log` | Matches each failure against `scripts/ci-doctor/kedb.json`, the known errors with their cause, class (env / code / flaky) and workaround. A runbook's autonomy (suggest → ask → auto) is computed from its recorded outcomes with a Wilson interval. It is never written by hand, and one failure in the last three takes `auto` away. |
| `npm run ci:flake -- rerun <test file> --times 3` | Reruns the file alone and records each run. It then classifies the file as real, flaky, isolation (passes alone, fails in the full run) or unknown. Set `CI_DOCTOR_RUNNER` to the runner this machine has; the default is `npx vitest run {file}`. |
| `npm run ci:flake -- add <file> --test NAME --reason TEXT` | Quarantines a test. It is refused unless the history shows the test flaky, and the quarantine expires within 14 days. `ci:flake -- check` exits 1 on an expired or invalid entry. No gate reads the quarantine yet (W10.M12). |
| `npm run ci:culprit -- --good <sha> --bad <sha> --log red.log -- npx vitest run {files}` | Runs `git bisect` in a temporary worktree on the red log's failing files only. With `--first-parent` (the default) it names the train merge and its PR; with `--all` it names the commit. Your checkout is not touched. |
