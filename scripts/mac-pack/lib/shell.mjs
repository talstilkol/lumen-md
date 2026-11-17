/**
 * Shell-command surgery for the Mac pack aggregator (scripts/mac-pack/run-all.mjs).
 *
 * The lanes' commands repeat the same expensive steps: `npm ci` and the
 * browser install, `npm run models:day`, and a Playwright run per entry. The
 * aggregator runs each of those once, then rewrites the entries' commands:
 * a top-level segment that a shared step already did becomes `true`, and a
 * `npx playwright test <specs> --project=…` segment reads its slice of the one
 * shared Playwright report (scripts/mac-pack/pw-from-shared.mjs) instead of
 * starting the browsers again. Only top-level segments before any `cd` are
 * touched; loops, subshells, pipes and anything after a `cd` run as written.
 */

/**
 * Split `cmd` at its top-level separators (&&, ||, ;, |, &), outside quotes,
 * parentheses, $( ) and do/done, then/fi, { } blocks. Returns
 * [{text, start, end, before, after, depth}] where `before`/`after` are the
 * separators around the segment ("" at either end).
 */
export function splitTop(cmd) {
  const segs = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  let prevSep = "";
  let block = 0;
  const push = (end, sep) => {
    const raw = cmd.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    segs.push({ text, start: start + lead, end: start + lead + text.length, before: prevSep, after: sep, block: segBlock });
    prevSep = sep;
  };
  let segBlock = 0;
  const wordAt = (i) => {
    const m = cmd.slice(i).match(/^[A-Za-z{}]+/);
    const prev = i === 0 ? " " : cmd[i - 1];
    return m && /[\s;&|(]/.test(prev) ? m[0] : null;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const w = wordAt(i);
    if (w && /^(do|then|\{|case)$/.test(w) && /[\s;]|$/.test(cmd[i + w.length] ?? " ")) block++;
    if (w && /^(done|fi|\}|esac)$/.test(w) && /[\s;&|)]|$/.test(cmd[i + w.length] ?? " ")) block = Math.max(0, block - 1);
    let sep = null;
    if (cmd.startsWith("&&", i) || cmd.startsWith("||", i)) sep = cmd.slice(i, i + 2);
    else if (c === ";" || c === "|") sep = c;
    else if (c === "&" && cmd[i - 1] !== ">" && cmd[i + 1] !== ">") sep = "&";
    if (!sep) continue;
    push(i, sep);
    i += sep.length - 1;
    start = i + 1;
    segBlock = block;
  }
  push(cmd.length, "");
  return segs.filter((s) => s.text);
}

/** Words of one simple command (quotes removed; no expansion). */
export function words(text) {
  const out = [];
  let cur = "";
  let quote = null;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      any = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
      continue;
    }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}

const SHARED_PROJECTS = ["chromium", "firefox", "webkit"];

/**
 * A `[PLAYWRIGHT_JSON_OUTPUT_NAME=<f>] npx playwright test <specs…> --project=<p>…
 * [--reporter=…]` segment, or null when it uses anything the shared run did
 * not (another env var, a grep, a config, a trace, a redirect, a project
 * outside chromium/firefox/webkit, or no --project at all).
 */
export function parsePlaywright(text) {
  if (/[<>$`]/.test(text)) return null;
  const w = words(text);
  let out = null;
  while (w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[0])) {
    const [k, ...v] = w.shift().split("=");
    if (k !== "PLAYWRIGHT_JSON_OUTPUT_NAME") return null;
    out = v.join("=");
  }
  if (w.slice(0, 3).join(" ") !== "npx playwright test") return null;
  const specs = [];
  const projects = [];
  let reporter = null;
  const rest = w.slice(3);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--project=")) projects.push(a.slice(10));
    else if (a === "--project") projects.push(rest[++i]);
    else if (a.startsWith("--reporter=")) reporter = a.slice(11);
    else if (a === "--reporter") reporter = rest[++i];
    else if (a.startsWith("-")) return null;
    else specs.push(a);
  }
  if (!projects.length || projects.some((p) => !SHARED_PROJECTS.includes(p))) return null;
  const json = (reporter ?? "").split(",").includes("json");
  if (json && !out) return null; // the JSON would go to stdout; run it as written
  return { specs, projects, out: json ? out : null };
}

/** The shell-quoted form of one word. */
const q = (s) => (/^[\w./=,:@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

/**
 * Rewrite `cmd` for the shared steps.
 *   shared: { setup?: {ok}, modelsDay?: {ok}, e2e?: {ok, report} }
 * Returns {cmd, replaced: [what], blockedBy: [shared step ids that failed]}.
 */
export function rewrite(cmd, shared) {
  const segs = splitTop(cmd);
  const edits = [];
  const replaced = [];
  const blockedBy = new Set();
  for (const s of segs) {
    if (s.block > 0) continue;
    if (/^cd\s/.test(s.text)) break;
    const piped = s.before === "|" || s.after === "|" || s.before === "||" || s.after === "||";
    if (piped) continue;
    const kind = sharedKind(s.text);
    if (kind && shared[kind]) {
      if (!shared[kind].ok) blockedBy.add(kind);
      edits.push([s.start, s.end, "true"]);
      replaced.push(`${kind}: ${s.text}`);
      continue;
    }
    const pw = shared.e2e ? parsePlaywright(s.text) : null;
    if (pw) {
      if (!shared.e2e.ok) blockedBy.add("e2e");
      const args = ["node", "scripts/mac-pack/pw-from-shared.mjs", "--report", shared.e2e.report, ...(pw.out ? ["--out", pw.out] : []), ...pw.projects.map((p) => `--project=${p}`), ...pw.specs];
      edits.push([s.start, s.end, args.map(q).join(" ")]);
      replaced.push(`e2e slice: ${s.text.slice(0, 120)}`);
    }
  }
  let out = cmd;
  for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + t + out.slice(b);
  return { cmd: out, replaced, blockedBy: [...blockedBy] };
}

/** Which shared step a top-level segment repeats, if any. */
export function sharedKind(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "npm ci" || /^npx playwright install( chromium| firefox| webkit)*$/.test(t)) return "setup";
  if (t === "npm run models:day" || t === "npm run models:day -- --yes") return "modelsDay";
  return null;
}

/** The commands of the shared steps. */
export const SHARED_CMDS = {
  setup: "npm ci && npx playwright install chromium firefox webkit",
  modelsDay: "npm run models:day -- --yes",
  e2e: (report) => `PLAYWRIGHT_JSON_OUTPUT_NAME=${report} npx playwright test ${SHARED_PROJECTS.map((p) => `--project=${p}`).join(" ")} --reporter=json`,
};

/** True when `cmd` moves the checked-out branch (it must run on its own, not inside the aggregate). */
export function movesHead(cmd) {
  const bare = cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''"); // why: a grep pattern such as -g "git pull" moves nothing
  return /\bgit\s+(?:-\S+\s+)*(switch|checkout|reset|pull|rebase|merge(?!-base)|worktree\s+add|clean)\b/.test(bare);
}
