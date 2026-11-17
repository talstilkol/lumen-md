/**
 * Plan W7.9 acceptance 2 on a held-out set: Yiddish → YIVO Latin → Yiddish
 * returns the original for at least 98 % of 500 words. The probe set
 * (fixtures/yiddish-probe-500.txt) shares no word with the set the rules were
 * written against (fixtures/yiddish-words.txt), and the romanisation itself
 * is checked against hand-written YIVO forms, so a rule that round-trips a
 * wrong romanisation (שכן → "shkhn" → שכן) does not pass.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HEBRAISMS, latinToYiddish, normalizeYiddish, yiddishToLatin } from "../text/yiddish";
import { HEBRAISMS_MORE } from "../text/yiddishHebraisms";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const words = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeYiddish);

const DEV = new Set(words(fixture("yiddish-words.txt")));
const PROBE = words(fixture("yiddish-probe-500.txt"));
const GOLD = fixture("yiddish-romanisation-gold.tsv")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t") as [string, string]);

describe("Yiddish round trip on a held-out probe set (W7.9)", () => {
  it("the probe set is at least 500 distinct words, none of them in the development set", () => {
    expect(new Set(PROBE).size).toBe(PROBE.length);
    expect(PROBE.length).toBeGreaterThanOrEqual(500);
    expect(PROBE.filter((w) => DEV.has(w))).toEqual([]);
  });

  it("Yiddish → Latin → Yiddish returns at least 98 % of the probe", () => {
    const lost = PROBE.filter((w) => latinToYiddish(yiddishToLatin(w)) !== w);
    expect(PROBE.length).toBeGreaterThanOrEqual(500);
    expect(1 - lost.length / PROBE.length, lost.join(" ")).toBeGreaterThanOrEqual(0.98);
  });

  it("Latin → Yiddish → Latin returns at least 98 % of the probe's romanisations", () => {
    const latin = PROBE.map(yiddishToLatin);
    const lost = latin.filter((l) => yiddishToLatin(latinToYiddish(l)) !== l);
    expect(1 - lost.length / latin.length, lost.join(" ")).toBeGreaterThanOrEqual(0.98);
  });

  it("romanises at least 98 % of the hand-written YIVO forms exactly", () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(100);
    const wrong = GOLD.filter(([y, l]) => yiddishToLatin(y) !== l).map(([y, l]) => `${y}: ${l} ≠ ${yiddishToLatin(y)}`);
    expect(1 - wrong.length / GOLD.length, wrong.join("; ")).toBeGreaterThanOrEqual(0.98);
  });

  it("reads Hebraisms by their spelling in a sentence, with punctuation and capitals", () => {
    expect(yiddishToLatin("דער בחור איז אַ מבֿין, אַ גרויסער!")).toBe("der bokher iz a meyvn, a groyser!");
    expect(latinToYiddish("Der Bokher iz a meyvn")).toBe(normalizeYiddish("דער בחור איז אַ מבֿין"));
    expect(yiddishToLatin("לשון־קודש")).toBe("loshn-koydesh");
  });
});

describe("the Hebraism tables (W7.9)", () => {
  const all = [...HEBRAISMS, ...HEBRAISMS_MORE];

  it("every entry comes back both ways", () => {
    expect(HEBRAISMS_MORE.length).toBeGreaterThanOrEqual(150);
    for (const [y, l] of all) {
      expect(yiddishToLatin(y), y).toBe(l);
      expect(latinToYiddish(l), l).toBe(normalizeYiddish(y));
    }
  });

  it("no two entries share a spelling or a romanisation", () => {
    const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(all.map(([y]) => normalizeYiddish(y)))).toEqual([]);
    expect(dup(all.map(([, l]) => l))).toEqual([]);
  });

  it("no romanisation of a Hebraism is also the romanisation of a non-Hebrew word of either set", () => {
    const heb = new Set(all.map(([y]) => normalizeYiddish(y)));
    const lat = new Set(all.map(([, l]) => l));
    const clash = [...DEV, ...PROBE].filter((w) => !heb.has(w) && lat.has(yiddishToLatin(w)));
    expect(clash).toEqual([]);
  });
});
