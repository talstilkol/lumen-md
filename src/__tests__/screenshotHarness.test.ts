/**
 * W10.B11 (audit W7.16): the screenshot-to-note harness measures an engine,
 * never the gold against itself. "gold CER 0%" was the gold scored against
 * itself; the harness now refuses a run that did not use an engine's output.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as S from "../ai/screenshotNote";
import * as C from "../ai/ocrCer";
import { cases } from "../../scripts/eval/screenshot-note/cases.mjs";
// @ts-expect-error — a plain .mjs module of the eval scripts
import { measureCases, refuseSelfMeasurement, summarize } from "../../scripts/eval/screenshot-note/measure.mjs";

const items = cases().map(({ id, lang, kind, gold }) => ({ id, lang, kind, gold }));
const fileOf = (it: { id: string }) => `/shots/${it.id}.png`;
const goldByFile = new Map(items.map((it) => [fileOf(it), it.gold]));

describe("no gold-vs-gold measurement", () => {
  it("an 'engine' that hands back the gold is refused, though it was called for every screenshot", async () => {
    const passThrough = async (file: string) => goldByFile.get(file) ?? "";
    const run = await measureCases(items, passThrough, { S, C, fileOf });
    expect(run.calls).toBe(50);
    expect(refuseSelfMeasurement(items, run)).toEqual([expect.stringContaining("byte-identical to their gold")]);
  });

  it("there is no mode that scores without an engine", async () => {
    await expect(measureCases(items, null, { S, C, fileOf })).rejects.toThrow(/no gold-vs-gold mode/);
    expect(refuseSelfMeasurement(items, { calls: 0, rows: [] })).toContain("the engine ran on 0 of 50 screenshots");
  });

  it("run.mjs refuses --engine gold before reading anything (exit 2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "shot-gold-"));
    writeFileSync(join(dir, "cases.json"), JSON.stringify(items));
    const r = spawnSync(process.execPath, ["scripts/eval/screenshot-note/run.mjs", "measure", dir, "--engine", "gold"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not an engine/);
    expect(r.stdout).not.toMatch(/CER he/);
  });

  it("an engine's own, imperfect output is a measurement: it is scored, not refused", async () => {
    // A stand-in engine with real OCR-style damage (dropped final letters, merged spaces), so the arithmetic is visible.
    const damaged = async (file: string) => (goldByFile.get(file) ?? "").replace(/[םןץףך]/g, "").replace(/ {2,}/g, " ").replace(/\|/g, "I");
    const run = await measureCases(items, damaged, { S, C, fileOf });
    expect(refuseSelfMeasurement(items, run)).toEqual([]);
    const report = summarize(run, { engine: "test-damage" });
    expect(report.engineCalls).toBe(50);
    expect(report.identicalToGold).toBeLessThan(50);
    expect(report.perLang.he.cer).toBeGreaterThan(0);
    expect(report.tables.right).toBeLessThan(report.tables.of);
  });
});
