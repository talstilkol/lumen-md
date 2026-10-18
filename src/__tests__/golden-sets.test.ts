// @vitest-environment node
/**
 * Golden sets (plan 7.1): the committed dev splits under eval/golden/, the
 * rules in scripts/lib/golden.mjs, and the samplers in scripts/golden/.
 *
 *   - every set validates: manifest, sha256 of each committed file, dev canary
 *     in every text file, SOURCES.md + LICENSE, counts, licence gate;
 *   - no test-split file is in the repo (no test/ folder, and no committed
 *     file but a manifest carries a test canary);
 *   - the samplers are deterministic: the same (dummy) seed gives the same
 *     items and the same sha256, another seed other items, dev and test never
 *     overlap, and dev does not depend on the secret seed.
 *
 * Only a dummy seed is used here; the real GOLDEN_SEED exists only in CI.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CANARY_PREFIX,
  canaryGuid,
  contentHash,
  freezeSet,
  loadSet,
  newCanary,
  partHash,
  scanForTestData,
  splitHash,
  splitPool,
  splitPoolWith,
  validateAll,
  validateSet,
  writeSplitPart,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/lib/golden.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { checkDatasets } from "../../scripts/lib/licenses.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { typos } from "../../scripts/golden/sets/mt-typos.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { synthetic as piiSynthetic, validIsraeliId, luhnValid, luhnDigit, ibanValid, ibanIL, idCheckDigit } from "../../scripts/golden/sets/pii.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { hard } from "../../scripts/golden/sets/langid.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { bipia } from "../../scripts/golden/sets/injection.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { heq } from "../../scripts/golden/sets/retrieval.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { lines as ocrLines, pages as ocrPages, pngWithText } from "../../scripts/golden/sets/ocr.mjs";

type Item = { id: string; [k: string]: unknown };
const repo = resolve(__dirname, "../..");
const golden = join(repo, "eval", "golden");
const DUMMY = "dummy-seed-for-tests-only";

/** The ten sets of appendix 20.3 and their sizes (7.1 acceptance: 80 / 250 / 100 / 150 / 200 / 130 / 250 / 50 / 130 / 240). */
const TARGETS: Record<string, number> = { "asr-he": 80, "mt-he-en": 250, nikud: 100, "ocr-he": 150, "typos-he": 200, retrieval: 130, "ner-pii": 250, caption: 50, injection: 130, langid: 240 };

const hashItems = (items: Item[]) => contentHash({ id: "", items });

describe("eval/golden — the committed sets", () => {
  const results = validateAll(golden);

  it("holds exactly the ten sets of appendix 20.3, at their planned sizes", () => {
    expect(Object.fromEntries(results.map((r: { name: string; manifest: { target: number } }) => [r.name, r.manifest?.target]))).toEqual(TARGETS);
  });

  it.each(Object.keys(TARGETS))("%s validates: frozen, sha256, canary, counts, SOURCES.md + LICENSE", (name) => {
    const r = results.find((x: { name: string }) => x.name === name);
    expect(r.problems).toEqual([]);
    expect(r.manifest.frozen).toBe(true);
    expect(canaryGuid(r.manifest.canary)).toBeTruthy();
    expect(canaryGuid(r.manifest.test.canary)).toBeTruthy();
  });

  it("commits at most about a quarter of each part (dev), and none of the owner's material", () => {
    for (const r of results)
      for (const p of r.manifest.parts) {
        expect(p.dev + p.test).toBe(p.items);
        expect(p.dev / p.items).toBeLessThanOrEqual(0.35);
        if (p.status === "owner-pending") expect(p.dev).toBe(0);
      }
  });

  it("has no test split in the repo: no test/ folder, no committed file with a test canary", () => {
    for (const name of Object.keys(TARGETS)) expect(existsSync(join(golden, name, "test"))).toBe(false);
    expect(scanForTestData(repo)).toEqual([]);
  });

  it("passes the licence gate (0.10): every declared licence is one a dataset may carry", () => {
    const dirs = Object.keys(TARGETS).map((name) => {
      const dir = join(golden, name);
      const files = readdirSync(dir);
      return { name, files, sources: readFileSync(join(dir, "SOURCES.md"), "utf8"), license: readFileSync(join(dir, "LICENSE"), "utf8") };
    });
    for (const f of checkDatasets(dirs)) expect([f.name, f.level]).not.toEqual([f.name, "fail"]);
  });

  it("loads every dev split through loadSet, and refuses a test split without its folder", () => {
    for (const name of Object.keys(TARGETS)) {
      const { items, manifest } = loadSet(golden, name);
      const committed = manifest.parts.filter((p: { status: string; devFiles?: string[] }) => p.status !== "local-only" && (p.devFiles ?? []).length).reduce((a: number, p: { dev: number }) => a + p.dev, 0);
      expect(items.length).toBe(committed);
    }
    expect(() => loadSet(golden, "langid", { split: "test" })).toThrow(/testDir/);
  });
});

describe("the rules (scripts/lib/golden.mjs) on a fixture set", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "lumen-golden-"));
    const dir = join(root, "toy");
    mkdirSync(join(dir, "dev"), { recursive: true });
    const manifest = {
      schema: 1,
      set: "toy",
      title: "Toy",
      metric: "accuracy",
      target: 12,
      license: "CC0-1.0",
      canary: newCanary(),
      version: 0,
      frozen: false,
      status: "partial",
      parts: [{ id: "a", items: 12, dev: 3, test: 9, status: "built", license: "CC0-1.0", devFiles: ["dev/a.json"] }],
      test: { canary: newCanary(), items: 9, sha256: null, parts: { a: null } },
      files: {},
      changelog: [],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeSplitPart(join(dir, "dev"), { manifest, partId: "a", split: "dev", items: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] });
    writeFileSync(join(dir, "SOURCES.md"), `# toy\n${manifest.canary}\n`);
    writeFileSync(join(dir, "LICENSE"), "CC0-1.0\n");
    freezeSet(dir, { reason: "fixture for the tests", today: "2026-10-18" });
    return { root, dir, manifest };
  }

  it("a fresh fixture validates as version 1", () => {
    const { root, dir } = fixture();
    try {
      const r = validateSet(dir, "toy");
      expect(r.problems).toEqual([]);
      expect(r.manifest.version).toBe(1);
      expect(r.manifest.status).toBe("partial");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches a changed file, a missing canary, a leaked test canary and a test/ folder", () => {
    const { root, dir, manifest } = fixture();
    try {
      writeFileSync(join(dir, "SOURCES.md"), "# toy, edited, without the canary\n");
      writeFileSync(join(dir, "notes.txt"), `copied from CI: ${manifest.test.canary}\n`);
      mkdirSync(join(dir, "test"));
      writeFileSync(join(dir, "test", "a.json"), "{}");
      const problems = validateSet(dir, "toy").problems.join("\n");
      expect(problems).toMatch(/sha256 mismatch: SOURCES\.md/);
      expect(problems).toMatch(/canary GUID missing from SOURCES\.md/);
      expect(problems).toMatch(/notes\.txt carries the TEST canary/);
      expect(problems).toMatch(/a test-split file is in the repo: test\/a\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a frozen set changes only through a new version with a reason", () => {
    const { root, dir, manifest } = fixture();
    try {
      writeFileSync(join(dir, "SOURCES.md"), `# toy v2\n${manifest.canary}\n`);
      expect(() => freezeSet(dir, {})).toThrow(/needs --reason/);
      const { manifest: m } = freezeSet(dir, { reason: "fixed a typo in the sources", today: "2026-10-19" });
      expect(m.version).toBe(2);
      expect(m.changelog.at(-1)).toEqual({ version: 2, date: "2026-10-19", reason: "fixed a typo in the sources" });
      expect(validateSet(dir, "toy").problems).toEqual([]);
      expect(freezeSet(dir, {}).changed).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches counts that do not add up and a dev share above 35%", () => {
    const { root, dir } = fixture();
    try {
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      m.parts[0].dev = 5;
      m.parts[0].test = 7;
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
      const problems = validateSet(dir, "toy").problems.join("\n");
      expect(problems).toMatch(/dev is 5\/12, more than 35% is committed/);
      expect(problems).toMatch(/3 items, the manifest says 5/);
      expect(problems).toMatch(/test\.items is 9/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies a CI-built test split against its recorded sha256", () => {
    const { root, dir, manifest } = fixture();
    const ci = mkdtempSync(join(tmpdir(), "lumen-golden-ci-"));
    try {
      const split = join(ci, "toy", "test");
      writeSplitPart(split, { manifest, partId: "a", split: "test", items: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}` })) });
      const loaded = loadSet(root, "toy", { split: "test", testDir: ci });
      expect(loaded.items).toHaveLength(9);
      expect(loaded.unverified).toEqual(["a"]);
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      m.test.parts.a = "0".repeat(64);
      m.test.sha256 = splitHash({ a: m.test.parts.a });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
      freezeSet(dir, { reason: "record a (wrong) hash for the test", today: "2026-10-19" });
      expect(() => loadSet(root, "toy", { split: "test", testDir: ci })).toThrow(/does not match its recorded sha256/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(ci, { recursive: true, force: true });
    }
  });
});

describe("samplers are deterministic for a (dummy) seed", () => {
  const opts = (part: string, nDev: number, nTest: number, secret = DUMMY) => ({ set: "t", part, nDev, nTest, secret });
  const ids = (xs: Item[]) => xs.map((x) => x.id);

  function expectSplit(run: (secret: string) => { dev: Item[]; test: Item[] }, nDev: number, nTest: number) {
    const a = run(DUMMY);
    const b = run(DUMMY);
    const c = run(`${DUMMY}-other`);
    expect(a.dev).toHaveLength(nDev);
    expect(a.test).toHaveLength(nTest);
    expect(hashItems(a.test)).toBe(hashItems(b.test));
    expect(hashItems(a.dev)).toBe(hashItems(b.dev));
    expect(hashItems(a.test)).not.toBe(hashItems(c.test));
    expect(hashItems(a.dev)).toBe(hashItems(c.dev)); // dev never depends on the secret
    const dev = new Set(ids(a.dev));
    expect(ids(a.test).filter((i) => dev.has(i))).toEqual([]);
  }

  it("splitPool and splitPoolWith", () => {
    const pool = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}` }));
    expectSplit((s) => splitPool(pool, opts("p", 10, 30, s)), 10, 30);
    expectSplit((s) => splitPoolWith(pool, opts("q", 5, 20, s), (x: Item, seed: string) => ({ id: x.id, seed: seed.length })), 5, 20);
    expect(() => splitPool(pool, { ...opts("p", 10, 30), secret: undefined })).toThrow(/GOLDEN_SEED/);
  });

  it("the same seed gives the same sha256 of a written split", () => {
    const manifest = { set: "t", canary: CANARY_PREFIX + "00000000-0000-4000-8000-000000000000", test: { canary: newCanary() }, parts: [{ id: "p", dev: 10, test: 30, license: "CC0-1.0" }] };
    const pool = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, text: `item ${i}` }));
    const dirs = [mkdtempSync(join(tmpdir(), "g1-")), mkdtempSync(join(tmpdir(), "g2-"))];
    try {
      const shas = dirs.map((d) => {
        const { test } = splitPool(pool, opts("p", 10, 30));
        writeSplitPart(d, { manifest, partId: "p", split: "test", items: test });
        return partHash(d, "p");
      });
      expect(shas[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(shas[0]).toBe(shas[1]);
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });

  it("typos-he/synthetic: sentences and injected errors", () => {
    const sentences = [
      "הממשלה החליטה היום על תוכנית חדשה לשיפור התחבורה הציבורית בערים הגדולות",
      "המשתתפים בכנס דיברו על חשיבות החינוך והמדע בחברה המודרנית שלנו",
      "בשבוע הבא תיפתח התערוכה החדשה במוזיאון העירוני במרכז העיר",
      "החוקרים פרסמו את תוצאות המחקר בכתב העת המדעי החשוב ביותר בתחום",
      "הקבוצה ניצחה במשחק האחרון של העונה וזכתה באליפות הארצית",
    ];
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `typo-${i}`, line: i + 1, he: sentences[i % sentences.length] + ` ${["היום", "אתמול", "מחר", "שוב"][i % 4]}` }));
    const vocab = new Map<string, number>();
    for (const it of items) for (const w of it.he.split(" ")) vocab.set(w, 9);
    expectSplit((s) => typos.select({ items, vocab }, opts("synthetic", 5, 12, s)), 5, 12);
    for (const it of typos.select({ items, vocab }, opts("synthetic", 5, 12)).test)
      for (const e of it.errors) {
        expect(it.text.slice(e.start, e.end)).toBe(e.wrong);
        expect(e.wrong).not.toBe(e.right);
      }
  });

  it("ner-pii/synthetic: templates, names and numbers; every ID, card and IBAN valid, every look-alike not", () => {
    const lists = {
      first: { f: ["נועה", "מיכל", "שירה", "יעל"], m: ["דניאל", "יוסי", "עומר", "איתי"], n: ["אור", "גל", "שחר", "טל"] },
      last: ["כהן", "לוי", "מזרחי", "פרץ", "ביטון"],
      cities: ["חיפה", "ירושלים", "באר שבע", "נתניה"],
      streets: ["הרצל", "ויצמן", "הנביאים", "בלפור"],
    };
    const run = (s: string) => piiSynthetic.select({ lists, items: Array.from({ length: 300 }, (_, i) => ({ id: `${i < 200 ? "pos" : "neg"}-${String(i).padStart(4, "0")}` })) }, opts("synthetic", 9, 30, s));
    expectSplit(run, 9, 30);
    const { test } = run(DUMMY);
    expect(test.filter((x: Item) => x.kind === "positive")).toHaveLength(20);
    expect(new Set(test.map((x: Item) => x.text)).size).toBe(test.length);
    expect(validIsraeliId("12345678" + idCheckDigit("12345678"))).toBe(true);
    expect(validIsraeliId("123456782")).toBe(true); // the textbook example
    expect(validIsraeliId("123456789")).toBe(false);
    expect(luhnValid("4580 0000 0000 000" + luhnDigit("458000000000000"))).toBe(true);
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
    expect(ibanValid(ibanIL("0108000000099999999"))).toBe(true);
  });

  it("langid/hard, injection/bipia, retrieval/heq", () => {
    expectSplit((s) => splitPool(hard.pool().items, opts("hard", 10, 30, s)), 10, 30);
    const attacks = Array.from({ length: 75 }, (_, i) => ({ id: `C${i % 15}#${i}`, cat: `Cat ${i % 15}`, k: i, text: `attack ${i}` }));
    const emails = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), context: `SUBJECT: s${i}\nline 1\nline 2\nline 3`, question: `Q: question ${i}?` }));
    expectSplit((s) => bipia.select({ items: attacks, emails }, opts("bipia", 8, 22, s)), 8, 22);
    const paras = Array.from({ length: 60 }, (_, i) => ({ id: `heq-d${String(i).padStart(3, "0")}`, origin: i % 2 ? "Wikipedia" : "Geektime", sameArticle: [], qas: [0, 1, 2].map((k) => ({ id: `q${i}-${k}`, question: `שאלה ${i}/${k}?`, answers: [{ text: "תשובה" }] })) }));
    expectSplit((s) => heq.select({ items: paras }, opts("heq", 12, 38, s)), 12, 38);
  });

  it("ocr-he plans: per font 5 dev / 15 test lines, pages; texts never shared between dev and test", () => {
    const unit = (p: string, i: number) => ({ id: `${p}${i}`, text: `טקסט ${p} ${i}`, work: i });
    const pools = { proseLines: Array.from({ length: 200 }, (_, i) => unit("l", i)), prosePages: Array.from({ length: 200 }, (_, i) => unit("p", i)), nikud: Array.from({ length: 40 }, (_, i) => unit("n", i)) };
    const runLines = (s: string) => ocrLines.select({ pools }, opts("lines", 30, 90, s));
    expectSplit(runLines, 30, 90);
    const { dev, test } = runLines(DUMMY);
    const used = (xs: Item[]) => new Set(xs.flatMap((x) => (x.sources as Array<{ unit: string }>).map((u) => u.unit)));
    const devUnits = used(dev);
    expect([...used(test)].filter((u) => devUnits.has(u))).toEqual([]);
    expect(test.filter((x: Item) => x.condition === "nikud")).toHaveLength(12);
    const runPages = (s: string) => ocrPages.select({ pools }, opts("pages", 4, 11, s));
    expect(hashItems(runPages(DUMMY).test)).toBe(hashItems(runPages(DUMMY).test));
    const png: Buffer = pngWithText(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55", "hex"), "canary-x");
    expect(png.subarray(37, 41).toString("latin1")).toBe("tEXt");
    expect(png.toString("latin1")).toContain("canary-x");
  });

  it("Python (scripts/golden/hf_build.py) samples and hashes exactly like Node", () => {
    const py = spawnSync("python3", ["--version"]);
    if (py.status !== 0) return; // CI images have python3; skip where it is missing
    const pool = Array.from({ length: 60 }, (_, i) => ({ id: `x-${String(i).padStart(3, "0")}`, text: `t${i}` }));
    const code = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location('hb', ${JSON.stringify(join(repo, "scripts/golden/hf_build.py"))})`,
      "hb = importlib.util.module_from_spec(spec); spec.loader.exec_module(hb)",
      "pool = [{'id': f'x-{i:03d}', 'text': f't{i}'} for i in range(60)]",
      `d, t = hb.split_pool(pool, 's', 'p', 7, 20, ${JSON.stringify(DUMMY)})`,
      "print(json.dumps({'dev': [x['id'] for x in d], 'test': [x['id'] for x in t], 'h': hb.content_hash({'id': 'a', 'text': 'שלום \"x\"\\n', 'n': 3, 'l': ['b', 'א']})}))",
    ].join("\n");
    const r = spawnSync("python3", ["-I", "-B", "-c", code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    const node = splitPool(pool, { set: "s", part: "p", nDev: 7, nTest: 20, secret: DUMMY });
    expect(out.dev).toEqual(ids(node.dev));
    expect(out.test).toEqual(ids(node.test));
    expect(out.h).toBe(contentHash({ id: "a", text: 'שלום "x"\n', n: 3, l: ["b", "א"] }));
  });
});

describe("the licence gate on a copy of the sets", () => {
  it("scripts/licenses.mjs reports no dataset failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-golden-lic-"));
    try {
      cpSync(golden, join(dir, "eval", "golden"), { recursive: true });
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "x", dependencies: {} } } }));
      mkdirSync(join(dir, "models"));
      writeFileSync(join(dir, "models", "registry.json"), JSON.stringify({ entries: [] }));
      const r = spawnSync(process.execPath, [join(repo, "scripts/licenses.mjs"), "--root", dir, "--json", join(dir, "r.json"), "--all"], { encoding: "utf8" });
      const report = JSON.parse(readFileSync(join(dir, "r.json"), "utf8"));
      expect(report.datasets).toHaveLength(10);
      expect(report.datasets.filter((d: { level: string }) => d.level === "fail")).toEqual([]);
      expect(r.stdout).toMatch(/10 eval datasets/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
