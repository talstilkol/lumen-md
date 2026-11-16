# Lane state: stop anywhere, resume without repeating work

A lane's session can stop at any point: an API rate limit, a lost context,
a closed laptop. That is normal, not a failure (W8.10). Each lane keeps one
`STATE.md`, so whoever resumes the lane (the same agent, another agent or a
person) continues from the same point. They do not redo finished work, and
they do not push anything twice. Every Vercel deployment counts against the
daily quota, and a second push of the same work can queue a second build
behind someone else's train.

Keep the file outside the repository, in the lane's own folder of the
coordination area (for agents: `$S/lanes/<lane>/STATE.md`). A copy of the
template is at `$S/lanes/STATE.template.md`.

## When to write it

- **After every push**, before anything else: the new head goes into the
  Branches table. If the session stops between the push and this edit,
  `lane-state.mjs resume` reports it as `record`.
- **After every commit you mean to keep**: the task's status and the next step.
- **Every hour**, even with nothing new: update the `Updated` line, so a reader
  knows how old the file is.
- **Before you stop on purpose** (a hand-off, low context): every section.

Write it in place, in full. Do not append a log that the next reader has to
replay.

### Written for you: the hooks and the hourly tick

Two of those writes happen without anyone doing them. `npm install` and
`npm ci` install both hooks in every clone (the `prepare` script,
`scripts/install-git-hooks.mjs`; it keeps a hook that is not ours, and does
nothing in CI or with `LUMEN_NO_HOOKS=1`). The one thing a lane does is say
where its state lives:

```bash
git config lumen.laneStateDir "$S/lanes"    # or: lumen.laneState <STATE.md>, or $LUMEN_LANE_STATE(_DIR)
```

By hand, the same hooks: `npm run ci:local -- --install-hook` (pre-push) and
`node scripts/lane-state.mjs install-hook --state-dir "$S/lanes"`
(reference-transaction; it also sets the git config above).

- **After a push.** Git has no post-push hook. So the pre-push hook writes
  what it is about to send to `$(git rev-parse --git-path lumen-lane-pending.json)`.
  When origin accepts the push, git moves `refs/remotes/origin/<branch>` to that
  sha, and the `reference-transaction` hook then writes three things into the
  `STATE.md` whose Branches table lists the branch: the new head in `pushed`,
  one line in Pushes, and the Updated time. A rejected push records nothing.
  A fetch that moves the same ref to someone else's head is not logged as a
  push either; the hourly tick (or `resume`) picks that up.
  `--state <file>` names one STATE.md instead of a folder of lanes.
  `$LUMEN_LANE_STATE` / `$LUMEN_LANE_STATE_DIR` override the git config.
  With nothing set, the hooks do nothing.
- **Every hour.** The first ref change after the lane state is set (a
  commit, a fetch, a push) makes the reference-transaction hook start
  `lane-state.mjs watch` in the background for the lane's STATE.md, unless a
  watcher already runs for it (`$(git rev-parse --git-path lumen-lane-watch.json)`
  holds its pid). After a reboot the next ref change starts it again; when
  the STATE.md is deleted the watcher stops. `watch` runs `tick` now and
  every `--every-min` minutes (60 by default; `$LUMEN_LANE_TICK_MIN` for the
  one the hook starts). A tick writes the Updated time, and records any Branches
  head that origin has moved since. As a cron line instead:
  `0 * * * * cd <clone> && node scripts/lane-state.mjs tick <STATE.md>`.

The hooks write only these fields. Tasks, Next and Decisions stay yours.

## The template

```markdown
# Lane <letter> state

Updated: <UTC time> (<local time>) · session <session link>

## Branches

| branch | worktree | base | pushed | pr |
| --- | --- | --- | --- | --- |
| <branch> | <absolute worktree path> | <base branch> | <sha origin has, or —> | <#PR, or —> |

## Tasks

| plan id | branch | status | what ran (command → counts) | owed |
| --- | --- | --- | --- | --- |
| <W8.9> | <branch> | todo / doing / committed / pushed / PR open / verified | <npx vitest run x.test.ts → 12/12> | <what still has to run, and where> |

## Pushes

One line per push, newest last: time, branch, sha, deployment id and result.
A push that is not here did not happen as far as the lane knows.

## Waiting on

<external events: a build, a rate limit and when it lifts (exact message and
time), another lane's push, an owner command>

## Next

<one exact step: the command to run, or the file and change to make>

## Decisions

<choice: reason (the PR body carries these too)>
```

`pushed` is the head that origin has, not the local head. A branch never
pushed has `—`. `scripts/lane-state.mjs` reads the Branches table, so keep
its five columns in that order.

## Resuming a lane

1. Read the lane's brief and its `STATE.md` in full.
2. Run `node scripts/lane-state.mjs resume <STATE.md>`. It only reads: it
   fetches the listed branches, asks origin for their heads, and asks GitHub
   for PRs with those heads. It prints one action per branch:

   | action | meaning | do |
   | --- | --- | --- |
   | `nothing` | origin has the local head, and a PR exists | push nothing |
   | `open-pr` | origin has the local head, but no PR has it | open the PR; do not push |
   | `push` | local commits that origin lacks | run the pre-push check, push once, write the head into STATE.md |
   | `record` | origin is at a head that STATE.md does not have (the stop came between the push and the edit) | write that head into STATE.md; push nothing |
   | `look` | the worktree is gone, or origin has commits the worktree lacks | fetch and merge (never force), or recreate the worktree from origin |

   It exits 1 when a branch needs `look` or `record`, so a script can stop there.
3. Check `Waiting on`. A build still running is not started again. A rate
   limit stays in force until the time it names.
4. Continue from `Next`. Tasks marked verified are done: do not run them again,
   unless their branch's head changed since.

`node scripts/lane-state.mjs table <STATE.md>` prints the Branches table with
origin's current heads, ready to paste back.
