# Clean-room check: the entity graph and types against israelconnect

Plan W12.E1 and W12.E8 say: clean reimplementation, israelconnect (AGPL-3.0) is a design reference only until R12.1. This page records an independent check of that claim.

## Method

`scripts/clean-room-scan.mjs` cuts both code bases into tokens. It drops comments and the contents of strings, and keeps identifiers, keywords, numbers and punctuation. Then it hashes every window of 40 tokens. If a window appears on both sides, that is a shared run. Runs that touch each other are merged.

A window is reported only if it holds at least 8 distinct identifiers that are not keywords. This means a list of strings, a table of numbers or a stock idiom is not reported as a copy.

These parts of the reference are skipped:
- its `data/`, `history/`, `gold/`, `docs/` and `research/` directories, which are never read;
- `vendor/` and test fixtures;
- generated or minified files (any file with a line over 2,000 characters).

The reference is only read, never copied, and nothing leaves the machine.

`src/__tests__/cleanRoomScan.test.ts` (4 tests) checks the scanner itself:
- a copied function is found after its comments, strings, types and layout have changed;
- an independent function for the same job is not reported;
- stock idioms and long string tables are not reported.

## Result (16.11, lumen-md verify/train-7 af2d0d7ce5, israelconnect 715fdf84)

| scope | our files | reference files | shared runs |
|---|---|---|---|
| `src/entities`, `src/types`, `src/graph`, `src/ui/EntityGraphScreen.tsx`, `mcp-server/src` | 69 | 4,840 | 2 |
| all of `src`, `mcp-server/src` and `scripts` | 3,687 | 4,840 | 10 |

The reference files are israelconnect `app/`, `tools/` and `desktop/`.

Both runs in the entity and types scope are idioms. Neither is copied logic:

- `src/graph/renderer.ts:87-90` vs `app/js/render_engine.js:108`. This is the standard WebGL shader compile: `createShader` → `shaderSource` → `compileShader` → `getShaderParameter(COMPILE_STATUS)` → throw `getShaderInfoLog`. Every WebGL tutorial uses this sequence.
- `src/ui/EntityGraphScreen.tsx:82-85` vs `app/js/storage.js:119`. This is a browser download: `createElement("a")`, `href = URL.createObjectURL(new Blob([text], …))`, `download = name`, `click()`.

The other 8 runs in the whole-repo scan are of the same kind and are outside the entity graph:
- the same Blob download (`src/academic/app.ts`, `src/views/bases/basesCsv.ts`);
- the textbook Levenshtein inner loop (`src/ai/dictation/textMetrics.ts`, `src/eval/public/metrics.ts`, `scripts/bench/metrics.mjs`, `scripts/golden/evals/asr-he.mjs`);
- a Python anchor helper and a bidi browser check in two scripts (`scripts/golden/hf_build.py`, `scripts/lib/gif.mjs`).

No file in `src/entities/` or `src/types/` shares a 40-token run with israelconnect code.

## Repeat

```
node scripts/clean-room-scan.mjs --ref ../israelconnect/app --ref ../israelconnect/tools --ref ../israelconnect/desktop src/entities src/types src/graph src/ui/EntityGraphScreen.tsx mcp-server/src
```

The command exits 1 when it finds a shared run, so the 2 idiom runs above make it exit 1 today. Read each run before you call it a copy.

What this check cannot see: a port that renames every identifier and reorders the code. A human reading the code and the history is still the stronger proof. That is the owner's review, and it is owed with R12.1.
