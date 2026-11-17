#!/usr/bin/env node
/**
 * npm run support:check (plan W13.T2): the support policy holds.
 *
 *   1. docs/support-matrix.json is well formed (a typo cannot switch the check off);
 *   2. no web API that a supported runtime lacks is used without feature
 *      detection, in src/ (not tests) and public/*.js (the boot shell);
 *   3. package.json's browserslist is the matrix's floor (the build targets what we support);
 *   4. the policy is written in English and Hebrew and quotes the security
 *      support period of security/disclosure.json word for word, so the two cannot drift;
 *   5. the iOS deployment target and Android minimum are the ones the policy names.
 *
 * Exit 1 with every problem listed; the scan's rules are in scripts/lib/supportPolicy.mjs.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { matrixProblems, scan } from "./lib/supportPolicy.mjs";

export const MATRIX = "docs/support-matrix.json";

/** browserslist queries for the matrix's floor. */
export function browserslistFor(matrix) {
  const f = matrix.floor;
  return [`chrome >= ${f.chrome}`, `edge >= ${f.edge}`, `firefox >= ${f.firefox}`, `safari >= ${f.safari}`, `ios_saf >= ${f.safari}`, `and_chr >= ${f.chrome}`];
}

function sources(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__" && name !== "fixtures") walk(p);
      } else if (/\.(tsx?|m?js)$/.test(name) && !name.endsWith(".d.ts")) out.push({ path: relative(root, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(join(root, "src"));
  for (const name of readdirSync(join(root, "public"))) if (/\.m?js$/.test(name)) out.push({ path: `public/${name}`, text: readFileSync(join(root, "public", name), "utf8") });
  return out;
}

export function problems(root) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const matrix = JSON.parse(read(MATRIX));
  const out = matrixProblems(matrix).map((p) => `${MATRIX}: ${p}`);
  if (out.length) return out;
  for (const v of scan(sources(root), matrix)) out.push(`${v.path}:${v.line}: ${v.feature} is not in ${v.missing.join(", ")} at the supported floor, and this file does not feature-detect it — guard it (or add "// support-policy: guarded — <why>"): ${v.snippet}`);
  const pkg = JSON.parse(read("package.json"));
  const want = browserslistFor(matrix);
  if (JSON.stringify(pkg.browserslist) !== JSON.stringify(want)) out.push(`package.json browserslist must be ${JSON.stringify(want)} (the floor in ${MATRIX})`);
  const disclosure = JSON.parse(read("security/disclosure.json"));
  for (const [file, lang] of [["docs/support-policy.md", "en"], ["docs/support-policy.he.md", "he"]]) {
    if (!existsSync(join(root, file))) {
      out.push(`${file} is missing`);
      continue;
    }
    const text = read(file);
    if (!text.includes(disclosure.supportPeriod[lang])) out.push(`${file} must quote security/disclosure.json supportPeriod.${lang} word for word`);
    for (const line of disclosure.support ?? []) if (!text.includes(line[lang])) out.push(`${file} must quote the ${line.line} line's security fixes (security/disclosure.json) word for word`);
    for (const r of matrix.runtimes) if (!text.includes(lang === "en" ? r.min : r.minHe)) out.push(`${file}: the minimum for ${r.id} is not the matrix's ("${lang === "en" ? r.min : r.minHe}")`);
  }
  const ios = read("ios/App/App.xcodeproj/project.pbxproj");
  const targets = [...ios.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1]);
  const iosMin = /iOS and iPadOS (\d+)/.exec(matrix.runtimes.find((r) => r.id === "mobile-ios")?.min ?? "")?.[1];
  if (!targets.length || targets.some((t) => Number(t) !== Number(iosMin))) out.push(`ios: every IPHONEOS_DEPLOYMENT_TARGET must be ${iosMin}.0, the policy's minimum (found ${[...new Set(targets)].join(", ")})`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.cwd();
  const p = problems(root);
  for (const x of p) console.error(`✖ ${x}`);
  if (p.length) process.exit(1);
  const m = JSON.parse(readFileSync(join(root, MATRIX), "utf8"));
  console.log(`✓ support policy: floor Chrome/Edge ${m.floor.chrome}, Firefox ${m.floor.firefox}, Safari ${m.floor.safari}; ${m.features.length} web APIs checked, every use beyond the floor is feature-detected; browserslist, docs (en, he) and the iOS target agree`);
}
