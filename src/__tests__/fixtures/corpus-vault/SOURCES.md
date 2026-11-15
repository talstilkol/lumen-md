# corpus-vault fixtures (W11.Q1)

origin: synthetic

`hewiki-sample.xml` and `enwiki-sample.xml` were written for the test of
`scripts/perf/corpus-vault.mjs`. They use the real dump format (MediaWiki
export schema 0.11, the shape of `*-pages-articles.xml`) and the wikitext
constructs real articles use (an infobox, categories, a file with a nested
link in its caption, references, a table, lists, a redirect, a talk page, a
stub, an interlanguage link), but **the article text is not from Wikipedia**:
it is a few sentences written for this test (CC0). They test the converter,
not anything about real-world size or content.

The real corpus is never committed. The generator downloads the Hebrew and
English Wikipedia dumps (CC BY-SA 4.0) and Project Ben-Yehuda's
public_domain_dump (public domain) and checks each against the sha256 in
`scripts/perf/corpus-sources.json`; see `eval/golden/SOURCES.md`.

The Ben-Yehuda part of the test uses the real fragments in
`../benyehuda/` (see its SOURCES.md).
