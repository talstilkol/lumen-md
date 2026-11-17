# Unused-file gate (plan 0.16, tightened by audit A3)

CI step **"Unused files"** (`npm run unused` = `node scripts/check-unused-files.mjs`)
fails when a production file under `src/` is not reachable from the app.

**Entry points:** the module scripts of the root `*.html` pages and `public/*.html`
(and pages in folders of their own, `bench/models.html`), plus every code file outside
`src/` that is not a test — `scripts/`, `eval/`, the root configs, and the executables and
packages that reuse `src/` (`bin/`, `api-server/`, `mcp-server/`, `packages/`, `extension/` …).
A script that bundles a source file by its path (`build("src/types/api.ts")`) reaches it too.
**Edges:** static and dynamic imports, re-exports, `require`, `vi.mock`,
`new URL("…", import.meta.url)` workers and `import.meta.glob`, resolved relative to the file
or through the `@/` alias.

**Tests are not entry points** (since audit A3, round 2): `*.test.*`, `*.spec.*`, `*.eval.*`,
`__tests__/`, `__mocks__/`, `e2e/` and `tests/`. Before, a module that only its own test
imported passed the gate — built, tested and unreachable from the app. The gate still walks
the tests' imports, to tell the two cases apart in its message.

The scan is textual, so it can only err towards "used".

| Situation | What to do |
| --- | --- |
| ✗ `… only tests reach it, nothing in the app` | wire it in the way its plan task intends (a command, a menu, a view, a setting), delete it, or — when it is a library on purpose — list it in `scripts/unused-files.library.json` with the reason |
| ✗ `… nothing imports it, not even a test` | delete it |
| ✗ `… is in unused-files.library.json but the app reaches it now` | take it off the list |
| ✗ `… is in unused-files.library.json but no test reaches it either` | it is dead: delete it |
| ✗ `… is no longer an orphan` (baseline) | `node scripts/check-unused-files.mjs --prune` and commit the baseline |

**The library list** (`scripts/unused-files.library.json`) is for files the app does not
reach by design: eval harnesses and their fixtures, measurement harnesses, and seams whose
engine is owed (a model export, an installed package, an owner decision). Each entry says
why, in one sentence, and what would wire it. It is not a baseline: a new entry is a
reviewed decision in its own PR, never a way to pass the gate.

`src/__tests__/appReachable.test.ts` walks the graph from `index.html` alone and checks the
modules audit A3 found unreachable; a module that falls out of the app again turns it red.

`--json` prints the counts; `--write` rebuilds the baseline from scratch and is an
owner decision (it can hide new dead code). The baseline is empty.

Unused **exports** and **dependencies** — the rest of knip — need the `knip` package,
which is added on a machine with registry access (`npm install -D knip --package-lock-only`).
