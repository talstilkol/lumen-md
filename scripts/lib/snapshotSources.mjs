/**
 * What produces each snapshot (W10.D20, audit r3): the test that writes it,
 * every module that test imports (transitively), the input documents it
 * reads, and the packages. The PR gate's "regenerated, not edited" check
 * (prGate.mjs `handEditedSnapshots`) asks this, so a README edit no longer
 * vouches for a hand-edited commandIds.snapshot.json.
 *
 *   vitest     src/**\/__snapshots__/…   its test (SNAPSHOT_TESTS, or the
 *              `<name>.snap` beside `<name>`), that test's import closure
 *              and its input documents (SNAPSHOT_INPUTS)
 *   Playwright visual/__baselines__/…     the visual specs, the harness and
 *              e2e/<spec>-snapshots/…     its config, or its own spec; and the
 *                                         app (src/ outside tests, public/,
 *                                         index.html, vite.config)
 * A snapshot this map does not know is produced only by the packages (fail
 * closed: add its test here).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/** Vitest snapshots written by a test whose name is not beside them. */
export const SNAPSHOT_TESTS = [
  { snapshot: /^src\/__tests__\/__snapshots__\/commandIds\.snapshot\.json$/, tests: ["src/__tests__/commandIds.test.ts"] },
  { snapshot: /^src\/__tests__\/__snapshots__\/render\//, tests: ["src/__tests__/renderSnapshot.test.ts"] },
  { snapshot: /^src\/__tests__\/__snapshots__\/render-docs\//, tests: ["src/__tests__/renderSnapshotDocs.test.ts"] },
];

/** Files a snapshot test reads at run time (readFileSync), beyond its imports. */
export const SNAPSHOT_INPUTS = [
  {
    snapshot: /^src\/__tests__\/__snapshots__\/render\//,
    inputs: [/^public\/templates\/.+\.md$/, /^public\/tutorials\/index\.md$/, /^public\/plugins\/(?:CONTEST|JUDGING_RUBRIC|CONTRIBUTING)\.md$/, /^(?:CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|DEPLOY)\.md$/, /^eval\/golden\/bidi\/dev\/lines\.json$/],
  },
  { snapshot: /^src\/__tests__\/__snapshots__\/render-docs\//, inputs: [/^(?:TERMS|PRIVACY|RELEASE|RELEASE_NOTES_2026-05-01|MASTER_PLAN)\.md$/] },
];

const PACKAGES = /^package(?:-lock)?\.json$/;
const TOOLING = /^(?:vite|vitest)\.config\.[cm]?[jt]s$/;
const APP = (f) => /^src\/(?!__tests__\/)/.test(f) || /^public\//.test(f) || f === "index.html" || TOOLING.test(f);
const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json", "/index.ts", "/index.tsx", "/index.js"];
const SPEC = /(?:from\s*|import\s*\(\s*|import\s+|vi\.mock\(\s*|vi\.doMock\(\s*|require\(\s*|new URL\(\s*)["']((?:\.{1,2}\/|@\/)[^"'?]+)(?:\?[^"']*)?["']/g;
const GLOB = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|"[^"]+"|'[^']+')/g;

function globRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Every repo file `test` imports, directly or through other files (relative
 * and `@/` specifiers, `vi.mock`, dynamic imports, `import.meta.glob`), the
 * test included. `read` returns a file's text or null.
 */
export function importClosure(test, read, list = () => []) {
  const seen = new Set();
  const globs = [];
  const queue = [test];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const text = read(file);
    if (text === null || text === undefined) continue;
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const dir = dirname(file);
    for (const m of text.matchAll(SPEC)) {
      const base = m[1].startsWith("@/") ? join("src", m[1].slice(2)) : normalize(join(dir, m[1]));
      const hit = EXTS.map((e) => base + e).find((p) => read(p) !== null && read(p) !== undefined);
      if (hit) queue.push(hit);
    }
    for (const m of text.matchAll(GLOB)) {
      const pats = m[1].startsWith("[") ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [m[1].slice(1, -1)];
      for (const p of pats.filter((x) => !x.startsWith("!"))) {
        const re = globRegex(normalize(join(dir, p)));
        globs.push(re);
        for (const f of list()) if (re.test(f)) queue.push(f);
      }
    }
  }
  return { files: seen, globs };
}

const fsRead = (root) => {
  const cache = new Map();
  return (f) => {
    if (!cache.has(f)) cache.set(f, existsSync(join(root, f)) && statSync(join(root, f)).isFile() ? readFileSync(join(root, f), "utf8") : null);
    return cache.get(f);
  };
};

/** The tests that write `snapshot`. */
export function snapshotTests(snapshot) {
  const known = SNAPSHOT_TESTS.filter((r) => r.snapshot.test(snapshot)).flatMap((r) => r.tests);
  if (known.length) return known;
  // vitest's default: <dir>/__snapshots__/<test file>.snap
  const m = /^(.*)\/__snapshots__\/([^/]+)\.snap$/.exec(snapshot);
  return m ? [`${m[1]}/${m[2]}`] : [];
}

/**
 * A function telling whether a change to a file can change `snapshot`.
 * @param {string} snapshot
 * @param {{ read?: (file: string) => string | null, list?: () => string[], root?: string }} [io]
 */
export function producersOf(snapshot, io = {}) {
  const read = io.read ?? fsRead(io.root ?? ".");
  const list = io.list ?? (() => []);
  const e2e = /^e2e\/(.+)-snapshots\//.exec(snapshot);
  if (e2e) return (f) => PACKAGES.test(f) || APP(f) || f === `e2e/${e2e[1]}` || /^playwright\.config\./.test(f);
  if (/^visual\/__baselines__\//.test(snapshot)) return (f) => PACKAGES.test(f) || APP(f) || (/^visual\//.test(f) && !/^visual\/__baselines__\//.test(f)) || /^playwright\.visual\.config\./.test(f) || f === "scripts/lib/visualGate.mjs";
  const files = new Set();
  const globs = [];
  for (const t of snapshotTests(snapshot)) {
    const c = importClosure(t, read, list);
    for (const f of c.files) files.add(f);
    globs.push(...c.globs);
  }
  const inputs = SNAPSHOT_INPUTS.filter((r) => r.snapshot.test(snapshot)).flatMap((r) => r.inputs);
  return (f) => PACKAGES.test(f) || TOOLING.test(f) || files.has(f) || globs.some((g) => g.test(f)) || inputs.some((re) => re.test(f));
}
