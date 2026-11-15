# Corpora used outside the golden sets

The golden sets each have their own `SOURCES.md` in their folder. This file
names the public corpora that other measurements download, so their licences
and attribution are in one place. None of them is committed to the repo.

## Large-vault benchmark (W11.Q1, W11.Q2, W2.22)

`scripts/perf/corpus-vault.mjs` downloads these, checks each against the
sha256 pinned in `scripts/perf/corpus-sources.json`, and turns them into a
vault of 10k, 50k or 100k notes. origin: real.

| Source | Use | Licence | Attribution |
|---|---|---|---|
| Hebrew Wikipedia, `hewiki-20261101-pages-articles.xml.bz2` | about 2/3 of the notes | CC BY-SA 4.0 | Hebrew Wikipedia contributors, https://he.wikipedia.org |
| English Wikipedia, `enwiki-20261101-pages-articles1.xml-p1p41242.bz2` | the other third | CC BY-SA 4.0 | English Wikipedia contributors, https://en.wikipedia.org |
| Project Ben-Yehuda, `public_domain_dump` commit 5e4277f (VERSION 2026-03) | 200 long texts and 5 notes of 1–2 MB | public domain | Project Ben-Yehuda, https://benyehuda.org |

- **CC BY-SA 4.0:** a generated vault is an adaptation of the articles. If a
  vault, or a part of it, is ever published (it is not: the benchmark only
  reads it), it must carry this attribution, a link to the licence
  (https://creativecommons.org/licenses/by-sa/4.0/) and the same licence.
  Each note keeps its article title in `title:`, which identifies the source
  page.
- **Pins:** the sha256 values are recorded by the owner's first run
  (`--record-pins`), because the cloud sandbox cannot reach
  dumps.wikimedia.org or GitHub archives. Until then the script refuses to
  run on a downloaded dump.
