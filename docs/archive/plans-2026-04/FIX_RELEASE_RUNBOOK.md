# Runbook: release, commit slices, and rollback (Fix track)

## Commit sequence (recommended)

1. `feat(security): introduce shared markup/url sanitization layer`
2. `feat(blocks): harden LiveJs, HtmlPreview, Mermaid/Graphviz/PlantUML/LiveSvg runtime`
3. `feat(export): harden printable export pipeline`
4. `test(security): expand sanitizer + integration coverage for dynamic blocks`
5. `docs(release): publish hardening notes + runbook`

### Rule
- One commit per phase, no mixed refactors, no unrelated UI content changes in the same commit.

## Deployment gate (pre-release)
1. Confirm `FIX_MASTER_PLAN.md` marks critical items as complete.
2. Ensure no pending high-risk open `TODO` in security/release touched files.
3. Keep changelog entry aligned with the release scope.

## Rollback procedure

1. Identify the last known good commit hash: `GOOD_SHA`.
2. `git revert` the last release commit if a partial safe rollback is required, in reverse order.
3. If the release must be fully rolled back, reset the branch pointer to `GOOD_SHA` and re-deploy.
4. In production, update status in `CHANGELOG.md` under `[Unreleased]` with a short rollback note.
5. Keep localStorage migration/feature flags unchanged unless a follow-up migration was applied.

## Post-rollback checks
1. Open shell at `/` and validate editor + preview render path.
2. Run quick smoke (`npm run test:e2e -- e2e/smoke.spec.ts`) and a short security flow check.
3. Publish a follow-up note in `FIX_RELEASE_NOTES.md` before reopening the hardening track.
