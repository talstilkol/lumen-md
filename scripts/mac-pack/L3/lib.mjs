/**
 * Mac pack, lane L3 (wave g6): the pure parts of the runner and the e2e
 * summary, so they can be tested without a Mac.
 *
 * A pack entry (plan/mac-pack/L3.json) is { id, cmd, expect, needs, minutes }.
 * `expect` is machine-checkable:
 *
 *   { "exit": 0 }                                 the command's exit code
 *   { "json": { "file": "a/*.json", "path": [...], "op": ">=", "value": 95 } }
 *                                                 a field of a JSON file the command wrote
 *                                                 (`*` in the last segment: the newest match)
 *   { "exit": 0, "json": [ {...}, {...} ] }       all of them
 *
 * A path is an array of keys; an object in it picks the array element whose
 * fields match ({ "id": "asr-web" }). Ops: == != >= <= > < exists len>= every==
 * ("every==": the value at the path is a non-empty array or object whose
 * every element equals `value`).
 */

/** The value at `path` in `obj`, or undefined. */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (key && typeof key === "object") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((el) => el && typeof el === "object" && Object.entries(key).every(([k, v]) => el[k] === v));
    } else cur = cur[key];
  }
  return cur;
}

/** Both numbers: "96" >= 95 is not a pass (JavaScript would coerce it). */
const nums = (a, b) => typeof a === "number" && typeof b === "number";

const OPS = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">=": (a, b) => nums(a, b) && a >= b,
  "<=": (a, b) => nums(a, b) && a <= b,
  ">": (a, b) => nums(a, b) && a > b,
  "<": (a, b) => nums(a, b) && a < b,
  exists: (a) => a !== undefined && a !== null,
  "len>=": (a, b) => (Array.isArray(a) ? a.length : a && typeof a === "object" ? Object.keys(a).length : -1) >= b,
  "every==": (a, b) => {
    const vals = Array.isArray(a) ? a : a && typeof a === "object" ? Object.values(a) : [];
    return vals.length > 0 && vals.every((v) => v === b);
  },
};

export const EXPECT_OPS = Object.keys(OPS);

/** Shape errors of one `expect` (empty when it is valid). */
export function expectErrors(expect) {
  const errs = [];
  if (!expect || typeof expect !== "object") return ["expect is not an object"];
  const keys = Object.keys(expect).filter((k) => k !== "says");
  if (!keys.length) errs.push("expect checks nothing");
  for (const k of keys) if (k !== "exit" && k !== "json") errs.push(`unknown expect key ${k}`);
  if ("exit" in expect && !Number.isInteger(expect.exit)) errs.push("exit is not an integer");
  if ("json" in expect) {
    const list = Array.isArray(expect.json) ? expect.json : [expect.json];
    for (const j of list) {
      if (!j || typeof j.file !== "string" || !j.file) errs.push("json.file missing");
      if (!Array.isArray(j?.path)) errs.push("json.path is not an array");
      if (!OPS[j?.op]) errs.push(`unknown op ${j?.op}`);
      if (j?.op !== "exists" && !("value" in (j ?? {}))) errs.push(`op ${j?.op} needs a value`);
    }
  }
  return errs;
}

/**
 * Check one `expect` against a finished command. `readJson(file)` returns the
 * parsed file (resolving a trailing `*`), or throws. → { ok, detail[] }.
 */
export function checkExpect(expect, { exit, readJson }) {
  const detail = [];
  let ok = true;
  if ("exit" in expect) {
    const good = exit === expect.exit;
    ok &&= good;
    detail.push(`exit ${exit}${good ? "" : ` (want ${expect.exit})`}`);
  }
  if ("json" in expect) {
    for (const j of Array.isArray(expect.json) ? expect.json : [expect.json]) {
      let doc;
      try {
        doc = readJson(j.file);
      } catch (e) {
        ok = false;
        detail.push(`${j.file}: ${e.message}`);
        continue;
      }
      const v = getPath(doc, j.path);
      const good = OPS[j.op](v, j.value);
      ok &&= good;
      detail.push(`${j.file} ${JSON.stringify(j.path)} = ${JSON.stringify(v)?.slice(0, 120)} ${good ? "✓" : `✗ (want ${j.op} ${JSON.stringify(j.value) ?? ""})`.trim()}`);
    }
  }
  return { ok, detail };
}

/** Shape errors of a whole pack (array of entries). */
export function packErrors(pack) {
  const errs = [];
  if (!Array.isArray(pack)) return ["the pack is not an array"];
  const ids = new Set();
  for (const e of pack) {
    const where = e?.id ?? "(no id)";
    if (typeof e?.id !== "string" || !e.id) errs.push("an entry has no id");
    else if (ids.has(e.id)) errs.push(`duplicate id ${e.id}`);
    else ids.add(e.id);
    if (typeof e?.cmd !== "string" || !e.cmd.trim()) errs.push(`${where}: no cmd`);
    if (!Array.isArray(e?.needs)) errs.push(`${where}: needs is not an array`);
    if (!(typeof e?.minutes === "number" && e.minutes > 0)) errs.push(`${where}: minutes is not a positive number`);
    for (const x of expectErrors(e?.expect)) errs.push(`${where}: ${x}`);
  }
  for (const e of pack) for (const n of e?.needs ?? []) if (/^L3-/.test(n) && !ids.has(n)) errs.push(`${e.id}: needs unknown entry ${n}`);
  const pos = new Map(pack.map((e, i) => [e?.id, i]));
  for (const [i, e] of pack.entries()) for (const n of e?.needs ?? []) if (pos.has(n) && pos.get(n) >= i) errs.push(`${e.id}: needs ${n}, which comes later`);
  return errs;
}

/**
 * Playwright's JSON reporter files → per project and per spec file:
 * { projects: { name: { passed, failed, flaky, skipped, shards } }, specs: { file: { project: { passed, failed, flaky, skipped } } } }.
 * `reports` is [{ project, json }]. A test's status is Playwright's:
 * expected (passed), unexpected (failed), flaky, skipped.
 */
export function summarizePlaywright(reports) {
  const projects = {};
  const specs = {};
  const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  const KEY = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" };
  for (const { project, json } of reports) {
    const p = (projects[project] ??= { passed: 0, failed: 0, flaky: 0, skipped: 0, shards: 0 });
    p.shards++;
    const walk = (suite, file) => {
      const f = suite.file ?? file;
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const k = KEY[t.status] ?? "failed";
          const name = t.projectName || project;
          bump((projects[name] ??= { passed: 0, failed: 0, flaky: 0, skipped: 0, shards: 0 }), k);
          const s = ((specs[normalizeSpec(f)] ??= {})[name] ??= { passed: 0, failed: 0, flaky: 0, skipped: 0 });
          bump(s, k);
        }
      }
      for (const child of suite.suites ?? []) walk(child, f);
    };
    for (const s of json?.suites ?? []) walk(s, s.file);
    for (const e of json?.errors ?? []) if (e) p.failed++;
  }
  return { projects, specs };
}

/** "e2e/x.spec.ts", whatever prefix the reporter used ("x.spec.ts", "/abs/…/e2e/x.spec.ts"). */
export function normalizeSpec(file) {
  const f = String(file ?? "").replaceAll("\\", "/");
  const i = f.lastIndexOf("e2e/");
  return i >= 0 ? f.slice(i) : `e2e/${f.replace(/^\.?\//, "")}`;
}

/**
 * Did these specs pass in these projects? Each needs ≥ 1 passed test and 0
 * failed or flaky ones in every project (a spec that only skips in a
 * project, e.g. a Chromium-only spec in WebKit, counts as missing there
 * unless `allowSkipOnly`). → { ok, problems[] }.
 */
export function specVerdict(summary, specs, projects, { allowSkipOnly = [] } = {}) {
  const problems = [];
  for (const spec of specs) {
    const per = summary.specs[normalizeSpec(spec)];
    for (const p of projects) {
      const c = per?.[p];
      if (!c) problems.push(`${spec} [${p}]: not in the run`);
      else if (c.failed || c.flaky) problems.push(`${spec} [${p}]: ${c.failed} failed, ${c.flaky} flaky`);
      else if (!c.passed && !allowSkipOnly.includes(p)) problems.push(`${spec} [${p}]: 0 passed (${c.skipped} skipped)`);
    }
  }
  return { ok: problems.length === 0, problems };
}
