# Contributing to Lumen

Thanks for your interest in Lumen! This document explains how to set up the project, the conventions we follow, and how to submit changes.

## Setup

```bash
git clone <repo-url>
cd "md editor"
npm install
npm run dev        # http://localhost:5173
```

For desktop:

```bash
npm run tauri:dev
```

For mobile (after `npx cap add ios|android`):

```bash
npm run build
npx cap sync
npx cap run ios   # or android
```

## Branches

- `main` — protected, always green.
- `track/<area>` — feature branches by area (e.g. `track/observability`, `track/types`).
- `fix/<short-desc>` — bug fixes.
- `chore/<short-desc>` — tooling, deps, docs.

## Commits

Use Conventional Commits:

- `feat(scope): summary`
- `fix(scope): summary`
- `chore(scope): summary`
- `docs(scope): summary`
- `test(scope): summary`
- `refactor(scope): summary`

Scopes are area names: `editor`, `renderer`, `collab`, `storage`, `ui`, `ai`, `i18n`, `infra`, etc.

## Pull Requests

1. Open against `main`.
2. Ensure CI passes: `npm run typecheck && npm run test && npm run build`.
3. Add a short description: what changed, why.
4. Link any related issue.
5. One of the maintainers will review.

## Testing

- Unit tests live in `src/__tests__/` and run with Vitest.
- Add a test for any non-trivial change.
- Run locally: `npm run test` (single-shot) or `npm run test:watch`.

## Code Style

- TypeScript strict mode is enabled — fix type errors, do not suppress them.
- Avoid `any`; prefer `unknown` + narrowing.
- Prefer existing utilities (`src/lib/`) before adding new ones.
- For UI changes, keep components small and composable.
- Use `t("key")` from `src/i18n/index.ts` for any user-facing string.

## Questions

Open a discussion on the repo, or comment on the relevant issue.

By contributing, you agree your contributions will be licensed under the project's [MIT License](LICENSE).
