# Plugin Contest Judging Rubric

Each submission is scored 0–100 across five dimensions by a panel of 3 core team members + 2 community maintainers.

## Innovation (30 points)

| Score | Criteria |
|---|---|
| 25–30 | Solves a unique problem no existing plugin addresses; novel UX pattern |
| 15–24 | Clever twist on existing idea; meaningful differentiation |
| 5–14 | Incremental improvement; "me too" plugin |
| 0–4 | Already exists as a Lumen built-in or popular plugin |

## Polish (25 points)

| Score | Criteria |
|---|---|
| 21–25 | Production-ready: responsive UI, dark/light mode, error handling, i18n strings |
| 11–20 | Good UI, minor rough edges, some missing edge cases |
| 1–10 | Works but unpolished; no error states; hardcoded English |
| 0 | Crashes or unusable on basic workflows |

## Performance (20 points)

| Score | Criteria |
|---|---|
| 16–20 | <1ms impact on editor startup; lazy-loads everything; no memory leaks |
| 8–15 | Minor startup cost (<50ms); reasonable lazy loading |
| 1–7 | Noticeable slowdown (>100ms); bundles heavy deps unconditionally |
| 0 | Freezes editor or leaks memory |

## Community (15 points)

| Score | Criteria |
|---|---|
| 13–15 | Active GitHub discussion >20 comments; demo video >1k views; PRs from others |
| 6–12 | Healthy discussion; author responsive to questions |
| 1–5 | Minimal engagement; author ghosts issues |
| 0 | No README; no install instructions |

## Code Quality (10 points)

| Score | Criteria |
|---|---|
| 9–10 | TypeScript strict; unit tests >80% coverage; clean architecture |
| 5–8 | Mostly typed; some tests; readable structure |
| 1–4 | JS or loose TS; no tests; spaghetti |
| 0 | Security vulnerabilities; eval() user input |

## Tie-breaker

If two entries score identically:
1. Fewer dependencies (smaller bundle)
2. Earlier submission timestamp
3. Community vote (GitHub Discussions upvotes)
