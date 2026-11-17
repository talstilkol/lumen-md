#!/usr/bin/env node
/**
 * The Yiddish spelling acceptance check (plan W7.9), run by hand with the
 * word list the app downloads (GPL-3.0, so it is never in the repository):
 *
 *   node scripts/eval/yiddish-spell.mjs --dict <folder with yi.aff and yi.dic> --text <a YIVO-spelled text> [--words 100]
 *
 * The text that goes with it: src/__tests__/fixtures/yiddish-yivo-text.txt (lines
 * starting with # are left out). Exit 0 when both targets are met, 1 when
 * not, 2 when there is nothing to check (fewer than N words, no slip).
 *
 * Takes the first N distinct words of the text (all spelled correctly, as
 * a YIVO text is), and for each makes one typical slip: a missing point
 * under alef (אַ → א), a missing dagesh (פּ → פ), one vov for two, ayin
 * for yud, a letter dropped. (No missing rafe or khirek: the list itself
 * writes YIVO without them, so they are not slips to it.) Reports how many correct words the checker accepts, how many
 * slips it flags, and for how many slips the right word is among its first
 * five suggestions. Plan targets: ≥ 95 % right, a correct suggestion for
 * ≥ 80 % of the slips.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const dict = opt("--dict");
const textFile = opt("--text");
const n = Number(opt("--words") ?? 100);
if (!dict || !textFile) {
  console.error("usage: node scripts/eval/yiddish-spell.mjs --dict <dir> --text <file> [--words 100]");
  process.exit(2);
}
const require = createRequire(opt("--nspell") ?? join(ROOT, "package.json"));
const nspell = require(opt("--nspell") ? opt("--nspell") : "nspell");
const { isKnownYiddish, lookupForms, yiddishSlipGuesses, yiddishWords, yivoForm } = await import(pathToFileURL(join(ROOT, "src/ai/yiddishSpell.ts")).href);
const { normalizeYiddish } = await import(pathToFileURL(join(ROOT, "src/text/yiddish.ts")).href);

const spell = nspell(readFileSync(join(dict, "yi.aff"), "utf8"), readFileSync(join(dict, "yi.dic"), "utf8"));
const seen = new Set();
const words = [];
const text = readFileSync(textFile, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
for (const { word } of yiddishWords(text)) {
  const w = normalizeYiddish(word);
  if (seen.has(w)) continue;
  seen.add(w);
  words.push(w);
  if (words.length >= n) break;
}

/** One typical slip, or null when the word has none of them. */
function slip(w) {
  const rules = [
    [/א[ַָ]/, "א"], // the point under alef left out
    [/([פכתב])ּ/, "$1"], // dagesh left out
    [/וו(?!ּ)/, "ו"], // one vov for two
    [/ע/, "י"], // ayin for yud
  ];
  for (const [re, to] of rules) if (re.test(w)) return w.replace(re, to);
  // A letter dropped (the second letter, with its point).
  const m = /^(.[\u05B0-\u05C2]*)(.[\u05B0-\u05C2]*)(.+)$/u.exec(w);
  return m && w.length > 3 ? m[1] + m[3] : null;
}

let accepted = 0;
const wrong = [];
for (const w of words) (isKnownYiddish(spell, w) ? accepted++ : wrong.push(w));
let flagged = 0;
let suggested = 0;
let slips = 0;
let realWord = 0;
for (const w of words) {
  const s = slip(w);
  if (!s || !isKnownYiddish(spell, w)) continue;
  // A slip that makes another real word is not a spelling error a word list can see: left out.
  if (isKnownYiddish(spell, s)) {
    realWord++;
    continue;
  }
  slips++;
  flagged++;
  const target = new Set(lookupForms(w));
  const sugg = [...new Set([...yiddishSlipGuesses(spell, s), ...spell.suggest(lookupForms(s).pop()).map(yivoForm)])].slice(0, 5);
  if (sugg.some((x) => lookupForms(x).some((f) => target.has(f)))) suggested++;
}
const right = accepted + flagged;
const total = words.length + slips;
console.log(`words ${words.length}: accepted ${accepted} (${((100 * accepted) / words.length).toFixed(1)} %)`);
console.log(`slips that make another real word, left out: ${realWord}`);
console.log(`slips ${slips}: flagged ${flagged}, right word in the first five suggestions ${suggested} (${((100 * suggested) / Math.max(1, slips)).toFixed(1)} %)`);
console.log(`identified correctly: ${right}/${total} (${((100 * right) / total).toFixed(1)} %)`);
if (wrong.length) console.log(`not accepted: ${wrong.join(" ")}`);
// A check with nothing to check is not a pass (W7.9): too few words, or no slip to suggest for.
if (words.length < n || slips === 0) {
  console.error(`yiddish-spell: only ${words.length} of ${n} words and ${slips} slips — not a check`);
  process.exit(2);
}
const ok = right / total >= 0.95 && suggested / slips >= 0.8;
console.log(ok ? "yiddish-spell: meets the plan targets (≥ 95 % right, ≥ 80 % suggested)" : "yiddish-spell: BELOW the plan targets");
process.exit(ok ? 0 : 1);
