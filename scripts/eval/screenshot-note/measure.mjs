/**
 * The measuring half of the screenshot-to-note harness (plan W7.16, W10.B11).
 *
 * A measurement is the engine's own output scored against the gold. Before
 * W10.B11 the harness had `--engine gold`, which scored the gold against
 * itself and printed "CER 0%": a check of the arithmetic, reported as if it
 * were a result. That engine is gone, and `refuseSelfMeasurement` stops a run
 * whose numbers could not have come from an engine:
 *   • the engine was not called once per screenshot, or
 *   • every output is byte-identical to its gold (a pass-through).
 * The arithmetic itself is tested in screenshotNote.test.ts / ocrCer tests,
 * not reported as a score.
 */

/**
 * Run `engine(file, lang)` on every item and score it.
 * `S` is src/ai/screenshotNote.ts, `C` is src/ai/ocrCer.ts (passed in so this
 * file needs no TypeScript loader).
 */
export async function measureCases(items, engine, { S, C, fileOf }) {
  if (typeof engine !== "function") throw new TypeError("measureCases needs an engine to run: there is no gold-vs-gold mode");
  let calls = 0;
  const rows = [];
  const outputs = [];
  for (const it of items) {
    const t0 = performance.now();
    calls++;
    const raw = String(await engine(fileOf(it), it.lang));
    outputs.push(raw);
    // The clean-up the app runs; the injection guard (which needs the app's i18n) is tested in screenshotNote.test.ts.
    const markdown = S.cleanScreenshotMarkdown(raw);
    const ms = performance.now() - t0;
    const cer = C.measureItem(S.plainText(it.gold), S.plainText(markdown));
    rows.push({
      id: it.id,
      lang: it.lang,
      kind: it.kind,
      edits: cer.all.edits,
      length: cer.all.length,
      table: it.kind === "table" ? S.tableCorrect(markdown, it.gold) : null,
      codeBlock: it.kind === "error" || it.kind === "code" ? /```/.test(markdown) : null,
      identicalToGold: raw === it.gold,
      ms: Math.round(ms),
    });
  }
  return { rows, calls, outputs };
}

/** Problems that make a run not a measurement; empty when the numbers came from the engine. */
export function refuseSelfMeasurement(items, run) {
  const problems = [];
  if (run.calls !== items.length) problems.push(`the engine ran on ${run.calls} of ${items.length} screenshots`);
  if (items.length && run.rows.every((r) => r.identicalToGold)) problems.push(`all ${items.length} outputs are byte-identical to their gold: that is the gold scored against itself, not a measurement`);
  return problems;
}

/** The report of a run (only for a run `refuseSelfMeasurement` accepted). */
export function summarize(run, { engine, model }) {
  const { rows } = run;
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
  const report = {
    engine,
    model: model ?? null,
    date: new Date().toISOString().slice(0, 10),
    n: rows.length,
    engineCalls: run.calls,
    identicalToGold: rows.filter((r) => r.identicalToGold).length,
    perLang: {},
    tables: null,
    codeBlocks: null,
    secondsMax: Math.max(...rows.map((r) => r.ms)) / 1000,
    secondsMean: sum(rows, (r) => r.ms) / rows.length / 1000,
    rows,
  };
  for (const lang of ["he", "en"]) {
    const rs = rows.filter((r) => r.lang === lang);
    report.perLang[lang] = { n: rs.length, cer: sum(rs, (r) => r.edits) / Math.max(1, sum(rs, (r) => r.length)) };
  }
  const t = rows.filter((r) => r.table !== null);
  report.tables = { right: t.filter((r) => r.table).length, of: t.length };
  const c = rows.filter((r) => r.codeBlock !== null);
  report.codeBlocks = { fenced: c.filter((r) => r.codeBlock).length, of: c.length };
  return report;
}
