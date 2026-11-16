/**
 * The Mac pack aggregator's judge (scripts/mac-pack/run-all.mjs).
 *
 * Every lane wrote its `expect` in its own shape. `normalize` turns each one
 * into a list of machine checks plus the parts only a person can judge
 * (`manual`); `judge` runs the checks against one entry's run. A result file
 * only counts when it was written after `since` (the start of the run): a
 * file left over from an earlier run is not evidence.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── glob ──────────────────────────────────────────────────────────────────

/** A glob (`*`, `?`, `**`, `{a,b}`) as a RegExp over a root-relative path. */
export function globRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Root-relative paths that match `glob`, newest first. */
export function globFiles(root, glob) {
  const clean = glob.replace(/^\.\//, "");
  if (!/[*?{]/.test(clean)) return existsSync(join(root, clean)) ? [clean] : [];
  const parts = clean.split("/");
  const fixed = [];
  for (const p of parts) {
    if (/[*?{]/.test(p)) break;
    fixed.push(p);
  }
  const base = fixed.join("/");
  const re = globRegex(clean);
  const out = [];
  const deep = clean.includes("**");
  const depth = parts.length - fixed.length;
  const walk = (dir, level) => {
    let names;
    try {
      names = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return; // why: a directory that is not there simply matches nothing
    }
    for (const d of names) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (deep || level + 1 < depth) walk(rel, level + 1);
      } else if (re.test(rel)) out.push(rel);
    }
  };
  walk(base, 0);
  return out.sort((a, b) => mtime(root, b) - mtime(root, a) || a.localeCompare(b));
}

const mtime = (root, rel) => {
  try {
    return statSync(join(root, rel)).mtimeMs;
  } catch {
    return 0; // why: a file that vanished counts as the oldest
  }
};

// ── values and paths ──────────────────────────────────────────────────────

/** `path` is "a.b.c", ".a.b", ["a","b"], or [] for the root. */
export function getPath(obj, path) {
  const keys = Array.isArray(path) ? path : String(path).replace(/^\./, "").split(".").filter(Boolean);
  let cur = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** One comparison; `op` is ==, !=, >=, >, <=, <, len>=, exists. */
export function compare(actual, op, value) {
  switch (op) {
    case "==":
      return actual === value || (typeof value === "number" && Number(actual) === value && actual !== null && actual !== "");
    case "!=":
      return actual !== value;
    case ">=":
      return typeof actual === "number" && actual >= value;
    case ">":
      return typeof actual === "number" && actual > value;
    case "<=":
      return typeof actual === "number" && actual <= value;
    case "<":
      return typeof actual === "number" && actual < value;
    case "len>=":
      return Array.isArray(actual) && actual.length >= value;
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

/** A path check in any lane's spelling: {path, op, value} | {path, equals} | {path, gte} | {path, op:"count", where, gte}. */
function pathCheck(c) {
  if (c.op === "count") return { path: c.path ?? [], op: "count", where: c.where ?? {}, value: c.gte ?? c.value ?? 1 };
  if ("equals" in c) return { path: c.path, op: "==", value: c.equals };
  if ("gte" in c) return { path: c.path, op: ">=", value: c.gte };
  if ("lte" in c) return { path: c.path, op: "<=", value: c.lte };
  return { path: c.path, op: c.op ?? "==", value: c.value };
}

/** Evaluate one path check on parsed JSON. */
export function evalPath(json, pc) {
  const actual = getPath(json, pc.path);
  if (pc.op === "count") {
    const list = Array.isArray(actual) ? actual : [];
    const n = list.filter((x) => Object.entries(pc.where).every(([k, v]) => x?.[k] === v)).length;
    return { ok: n >= pc.value, actual: n };
  }
  return { ok: compare(actual, pc.op, pc.value), actual };
}

/** The last line of `text` that parses as JSON (a command's own result line). */
export function lastJson(text) {
  const lines = String(text ?? "").trim().split("\n").reverse();
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      return JSON.parse(t);
    } catch {
      // why: a log line that only looks like JSON; keep looking
    }
  }
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return undefined; // why: no JSON at all means the check fails, not the runner
  }
}

// ── the string form (L4, L7) ──────────────────────────────────────────────

const VALUE = (s) => {
  const t = s.trim().replace(/[.,]$/, "");
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const q = t.match(/^["'](.*)["']$/);
  return q ? q[1] : undefined;
};

/** ".a.b OP V" → a path check, or null when the text is not one. */
function parseCond(text) {
  const m = text.trim().match(/^(\.[\w.[\]-]+)\s*(==|!=|>=|<=|>|<)\s*(\S+)$/);
  if (!m || m[1].includes("[")) return null;
  const value = VALUE(m[3]);
  if (value === undefined) return null;
  return { path: m[1], op: m[2], value };
}

/**
 * The string form: clauses split on ";". "exit N" is the exit check;
 * "<file>.json: .a == 1 && .b >= 2" and "exit 0 and <file>.json .ok == true"
 * are JSON checks; "e2e: …" and "commands: …" describe what the entry's own
 * runner judges; anything else is for a person.
 */
export function parseExpectString(s) {
  const checks = [];
  const manual = [];
  const info = [];
  let exit;
  for (const raw of s.split(/;\s+/)) {
    let clause = raw.trim().replace(/\.$/, "");
    if (!clause) continue;
    const ex = clause.match(/^exit (\d+)\b\s*(.*)$/);
    if (ex) {
      exit = Number(ex[1]);
      clause = ex[2].replace(/^and\s+/, "").trim();
      if (!clause) continue;
      if (!/^\S+\.json\b/.test(clause)) {
        manual.push(clause);
        continue;
      }
    }
    if (/^(e2e|commands|one Playwright run)\b/.test(clause)) {
      info.push(clause);
      continue;
    }
    const fm = clause.match(/^(\S+\.json):?\s+(\..*)$/);
    if (fm && !fm[1].includes("<")) {
      const parts = fm[2].split(/\s+(?:&&|and)\s+/);
      const conds = parts.map(parseCond);
      conds.forEach((c, i) => (c ? checks.push({ kind: "json", file: fm[1], ...c }) : manual.push(`${fm[1]}: ${parts[i]}`)));
      continue;
    }
    manual.push(clause);
  }
  if (exit !== undefined) checks.unshift({ kind: "exit", value: exit });
  return { checks, manual, info };
}

// ── normalize every shape ─────────────────────────────────────────────────

/** {checks, manual, info} for one entry's `expect`. */
export function normalize(expect) {
  if (typeof expect === "string") return parseExpectString(expect);
  const x = expect ?? {};
  const checks = [];
  const manual = [];
  const info = [];
  if (typeof x.exit === "number") checks.push({ kind: "exit", value: x.exit });
  if (Array.isArray(x.json)) for (const c of x.json) checks.push({ kind: "json", file: c.file, ...pathCheck(c) });
  else if (typeof x.json === "string") for (const c of x.checks ?? []) checks.push({ kind: "json", file: x.json, ...pathCheck(c) });
  else if (x.json && typeof x.json === "object") {
    if ("path" in x.json) checks.push({ kind: "json", file: x.json.file, ...pathCheck(x.json) });
    else for (const [k, v] of Object.entries(x.json)) if (k !== "file") checks.push({ kind: "json", file: x.json.file, path: [k], op: "==", value: v });
  }
  if (typeof x.file === "string" && x.regex) checks.push({ kind: "regex", file: x.file, regex: x.regex, group1Gte: x.group1Gte });
  else if (typeof x.file === "string") checks.push({ kind: "files", globs: [x.file] });
  if (Array.isArray(x.files)) checks.push({ kind: "files", globs: x.files });
  if (typeof x.stdout === "string") checks.push({ kind: "stdout", contains: x.stdout });
  else if (x.stdout && typeof x.stdout === "object") checks.push({ kind: "stdoutJson", ...pathCheck(x.stdout) });
  if (typeof x.stdoutLastLine === "string") {
    const m = x.stdoutLastLine.match(/^(==|!=|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
    if (m) checks.push({ kind: "stdoutLastLine", op: m[1], value: Number(m[2]) });
    else manual.push(`last line of the output: ${x.stdoutLastLine}`);
  }
  if (x.count) checks.push({ kind: "count", glob: x.count.glob, gte: x.count.gte ?? 1 });
  if (typeof x.check === "string") checks.push({ kind: "shell", cmd: x.check });
  for (const k of ["note", "says", "means"]) if (typeof x[k] === "string") info.push(x[k]);
  if (typeof x.after === "string") manual.push(`afterwards: ${x.after}`);
  return { checks, manual, info };
}

// ── judge ─────────────────────────────────────────────────────────────────

const describe = (c) => {
  switch (c.kind) {
    case "exit":
      return c.value === 0 ? "exit 0" : "exit ≠ 0 (a planted failure must be refused)";
    case "json":
      return `${c.file}: ${Array.isArray(c.path) ? c.path.join(".") || "(root)" : c.path} ${c.op} ${JSON.stringify(c.value)}${c.where ? ` where ${JSON.stringify(c.where)}` : ""}`;
    case "regex":
      return `${c.file} matches /${c.regex}/${c.group1Gte !== undefined ? ` with $1 ≥ ${c.group1Gte}` : ""}`;
    case "files":
      return `exists: ${c.globs.join(", ")}`;
    case "stdout":
      return `output contains ${JSON.stringify(c.contains)}`;
    case "stdoutJson":
      return `output JSON ${Array.isArray(c.path) ? c.path.join(".") : c.path} ${c.op} ${JSON.stringify(c.value)}`;
    case "stdoutLastLine":
      return `last output line ${c.op} ${c.value}`;
    case "count":
      return `${c.glob}: at least ${c.gte} file(s)`;
    case "shell":
      return `exit 0 of: ${c.cmd}`;
    default:
      return c.kind;
  }
};

/** The newest file for `glob` written at or after `since`, else a reason. */
function freshFile(root, glob, since) {
  const all = globFiles(root, glob);
  if (!all.length) return { error: "missing" };
  const fresh = all.filter((f) => mtime(root, f) >= since);
  if (!fresh.length) return { error: `stale: ${all[0]} is older than this run` };
  return { file: fresh[0] };
}

/**
 * Judge one entry. `run` is {code, stdout}; `shell(cmd)` runs a `check`
 * command and returns its exit code. Returns [{kind, desc, ok, actual}].
 */
export async function judge(checks, run, { root, since = 0, shell }) {
  const out = [];
  for (const c of checks) {
    const r = { kind: c.kind, desc: describe(c), ok: false };
    try {
      if (c.kind === "exit") {
        r.actual = run.code;
        r.ok = c.value === 0 ? run.code === 0 : run.code !== 0 && run.code !== null;
      } else if (c.kind === "json" || c.kind === "regex") {
        const f = freshFile(root, c.file, since);
        if (f.error) r.actual = f.error;
        else {
          const text = readFileSync(join(root, f.file), "utf8");
          if (c.kind === "regex") {
            const m = text.match(new RegExp(c.regex));
            r.actual = m ? m[0] : "no match";
            r.ok = !!m && (c.group1Gte === undefined || Number(m[1]) >= c.group1Gte);
          } else {
            const v = evalPath(JSON.parse(text), c);
            r.ok = v.ok;
            r.actual = v.actual;
          }
        }
      } else if (c.kind === "files") {
        const res = c.globs.map((g) => freshFile(root, g, since));
        r.ok = res.every((x) => !x.error);
        r.actual = res.map((x, i) => x.file ?? `${c.globs[i]}: ${x.error}`);
      } else if (c.kind === "count") {
        const n = globFiles(root, c.glob).filter((f) => mtime(root, f) >= since).length;
        r.actual = n;
        r.ok = n >= c.gte;
      } else if (c.kind === "stdout") {
        r.ok = String(run.stdout ?? "").includes(c.contains);
        r.actual = r.ok ? "found" : "not found";
      } else if (c.kind === "stdoutJson") {
        const j = lastJson(run.stdout);
        const v = j === undefined ? { ok: false, actual: "no JSON in the output" } : evalPath(j, c);
        r.ok = v.ok;
        r.actual = v.actual;
      } else if (c.kind === "stdoutLastLine") {
        const last = String(run.stdout ?? "").trim().split("\n").pop()?.trim();
        r.actual = last;
        r.ok = last !== "" && compare(Number(last), c.op, c.value);
      } else if (c.kind === "shell") {
        r.actual = await shell(c.cmd);
        r.ok = r.actual === 0;
      }
    } catch (e) {
      r.ok = false;
      r.actual = `error: ${e.message}`;
    }
    out.push(r);
  }
  return out;
}

export const _test = { freshFile, resolve };
