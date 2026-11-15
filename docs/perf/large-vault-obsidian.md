# Large-vault benchmark: lumen-md and Obsidian 1.15.1 on the same Mac

W11.Q2. The harness (`scripts/perf/large-vault.ts`) measures lumen-md's index
core. This page is the by-hand half: the two apps, on the same machine and
the same vault folder. Results go into the table at the end and into
[large-vault.md](./large-vault.md) for the harness numbers.

## 1. The vaults (once)

```bash
npm run perf:corpus-vault -- --record-pins --fetch --cache ~/.cache/lumen-corpus --notes 10000  --out ~/bench/vault-10k
npm run perf:corpus-vault -- --fetch --cache ~/.cache/lumen-corpus --notes 50000  --out ~/bench/vault-50k
npm run perf:corpus-vault -- --fetch --cache ~/.cache/lumen-corpus --notes 100000 --out ~/bench/vault-100k
git add scripts/perf/corpus-sources.json   # the pins the first run recorded
```

Check `corpus-manifest.json` in each folder: `origin` must be `real`, and
`shortfall` must be `{ long: 0, huge: 0 }` (200 long Ben-Yehuda texts and five
notes of 1–2 MB). Keep a pristine copy of each folder: both apps write their
own settings folder (`.obsidian/`, and lumen-md's), so each app opens its own
copy (`cp -c` on APFS is instant).

## 2. The harness (lumen-md's index core)

```bash
sudo purge && npm run perf:large-vault -- --vault ~/bench/vault-100k --cold-cache yes --report docs/perf/large-vault.md --targets
```

Run it for each size. `--targets` exits non-zero when a 100k target is missed.

## 3. The two apps, by hand

Same rules for both:
- Quit every other app; power adapter in; Low Power Mode off.
- Obsidian 1.15.1 with **no community plugins** (Settings → Community plugins → Turn on restricted mode) and default core plugins. Note the exact version (Settings → About).
- lumen-md desktop build from the commit under test (`npm run tauri build`), default settings.
- Three runs of each metric; record the median.

| # | Metric | How, in both apps |
|---|---|---|
| 1 | Cold open | `sudo purge`, start the app with the vault, stop the clock when the file list is shown and a search returns results. Obsidian: until the status bar's indexing progress is gone. |
| 2 | Warm open | Quit and start again without `purge`. |
| 3 | Search p50/p95 | The first 10 queries of the vault's `queries.json` (real article titles), typed into each app's search, time to the first results (screen recording at 60 fps, count frames). |
| 4 | Save→index | Type a new unique word into a note, wait 1 s, search for it; time until it is found. |
| 5 | Backlinks | Open `he/ישראל.md`, open its backlinks pane; time until it is filled. |
| 6 | Idle CPU | After load, 60 s idle: Activity Monitor → the app's processes, % CPU, sum. Also open a 1–2 MB Ben-Yehuda note once and check the idle CPU again (Obsidian's known 2 MB problem). |
| 7 | Peak memory | Activity Monitor → Memory, sum of the app's processes, the highest value seen during 1–6. |

lumen-md wins a metric when its median is lower. The target is lumen-md ≤
Obsidian on at least 5 of the 7 (W11.Q2).

## 4. Results

| date | vault | machine | app | 1 cold s | 2 warm s | 3 search ms (p50/p95) | 4 save→index ms | 5 backlinks ms | 6 idle CPU % | 7 peak MB |
|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | lumen-md | owed (W11.M8) | | | | | | |
| — | — | — | Obsidian 1.15.1 | owed (W11.M8) | | | | | | |
