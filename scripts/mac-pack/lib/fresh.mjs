/**
 * Shell checks read only what this run wrote (review 12, H1).
 *
 * A Mac pack `check` is a shell command (`jq -e … eval/results/x.json`,
 * `grep -q … /tmp/lumen-mac/L5/y.txt`, `ls eval/results/z/*.json`). Many of
 * those files are committed to the repo or left by an earlier run, so a
 * check that only reads them proves nothing about this run. Before an entry
 * runs, every file its check reads that is older than this run is moved
 * aside (into .mac-pack/aside/<id>/, git-ignored); after the check, anything
 * the run did not write again is put back, so a committed file is never lost.
 * When the check runs, a file it reads that is still older than the run makes
 * the check fail as stale, without running it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { globFiles } from "./expect.mjs";
import { splitTop, words } from "./shell.mjs";

export const ASIDE_DIR = ".mac-pack/aside";
/** File times come from a coarse kernel clock that can lag Date.now() by a tick; older than this is older than the run. */
export const CLOCK_SLACK_MS = 1000;

/** The contents of each `$( … )` in `text`, and `text` with them replaced by a placeholder. */
function substitutions(text) {
  const inner = [];
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      for (; j < text.length && depth; j++) depth += text[j] === "(" ? 1 : text[j] === ")" ? -1 : 0;
      inner.push(text.slice(i + 2, j - 1));
      out += "SUBST";
      i = j - 1;
    } else out += text[i];
  }
  return { inner, out };
}

/** Every simple command of `cmd` as its words, including those inside `$( … )` and `( … )`. */
export function simpleCommands(cmd) {
  const out = [];
  for (const seg of splitTop(cmd)) {
    const { inner, out: text } = substitutions(seg.text);
    for (const s of inner) out.push(...simpleCommands(s));
    let t = text.trim();
    while (/^[!(]\s*/.test(t)) t = t.replace(/^[!(]\s*/, "");
    t = t.replace(/\)\s*$/, "");
    if (t.includes("&&") || t.includes("||") || t.includes(";") || t.includes("|")) {
      out.push(...simpleCommands(t));
      continue;
    }
    const w = words(t);
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift();
    if (w.length) out.push(w);
  }
  return out;
}

const SCRIPT = /\.(mjs|cjs|js|ts|sh|py)$/;
const TOOL_DIR = /^(\.\/)?(scripts|tools|bin|node_modules|src)\//;
const operands = (args) => args.filter((a) => !a.startsWith("-"));

/** The paths a check reads as data: jq/grep inputs, `test -s/-f/-e`, `ls`/`cat`, a built binary. */
export function readPaths(cmd) {
  const paths = [];
  for (const w of simpleCommands(cmd)) {
    const [prog, ...args] = w;
    if (prog === "jq") paths.push(...operands(args).slice(1));
    else if (prog === "grep") {
      const hasE = args.some((a, i) => a === "-e" && args[i + 1] !== undefined);
      const ops = operands(args.filter((a, i) => args[i - 1] !== "-e"));
      paths.push(...(hasE ? ops : ops.slice(1)));
    } else if (prog === "test" || prog === "[") {
      for (let i = 0; i < args.length - 1; i++) if (/^-[sfer]$/.test(args[i])) paths.push(args[i + 1]);
    } else if (["ls", "cat", "head", "tail", "wc", "stat"].includes(prog)) paths.push(...operands(args));
    else if (prog.includes("/") && !SCRIPT.test(prog) && !TOOL_DIR.test(prog)) paths.push(prog);
  }
  return [...new Set(paths.filter((p) => p && !/[$<>`]|SUBST/.test(p) && !/(^|\/)(node_modules|\.git)(\/|$)/.test(p)))];
}

/** [base, rel] for a path that is absolute or relative to `root`. */
const split = (root, p) => (isAbsolute(p) ? ["/", p.slice(1)] : [root, p.replace(/^\.\//, "")]);
const mtimeOf = (abs) => {
  try {
    return statSync(abs).mtimeMs;
  } catch {
    return 0; // why: a file that is not there is the oldest possible
  }
};

/** The existing files a check reads: globs expanded; a directory stands for its top-level entries. */
export function readFiles(root, cmd) {
  const out = [];
  for (const p of readPaths(cmd)) {
    const [base, rel] = split(root, p);
    for (const f of globFiles(base, rel)) {
      const abs = join(base, f);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue; // why: vanished between the listing and now
      }
      if (st.isDirectory()) for (const n of readdirSync(abs)) out.push(join(abs, n));
      else out.push(abs);
    }
  }
  return [...new Set(out)];
}

/** Files a check reads that are older than `since` (not written by this run). */
export function staleReads(root, cmd, since) {
  return readFiles(root, cmd).filter((abs) => !statSync(abs).isDirectory() && mtimeOf(abs) < since - CLOCK_SLACK_MS);
}

const asideRoot = (root, id) => join(root, ASIDE_DIR, id.replace(/[^\w.-]+/g, "_"));

/** Move aside every file the check reads that is older than `since`. Returns how many. */
export function setAside(root, id, cmd, since) {
  const dir = asideRoot(root, id);
  const moved = [];
  readFiles(root, cmd).forEach((abs, i) => {
    if (mtimeOf(abs) >= since - CLOCK_SLACK_MS) return; // why: written earlier in this same run (a need's output)
    const to = join(dir, String(i));
    mkdirSync(dir, { recursive: true });
    cpSync(abs, to, { recursive: true, preserveTimestamps: true });
    rmSync(abs, { recursive: true, force: true });
    moved.push({ from: abs, to });
  });
  if (moved.length) writeFileSync(join(dir, "manifest.json"), JSON.stringify(moved));
  return moved.length;
}

/** Put back what was moved aside for `id` and not written again by the run. */
export function restoreAside(root, id) {
  const dir = asideRoot(root, id);
  const man = join(dir, "manifest.json");
  if (!existsSync(man)) return 0;
  let n = 0;
  for (const { from, to } of JSON.parse(readFileSync(man, "utf8"))) {
    if (existsSync(from) || !existsSync(to)) continue; // why: the run wrote it again; its new copy stands
    mkdirSync(dirname(from), { recursive: true });
    cpSync(to, from, { recursive: true, preserveTimestamps: true });
    n++;
  }
  rmSync(dir, { recursive: true, force: true });
  return n;
}

/** Put back everything an interrupted earlier run left aside. */
export function restoreAll(root) {
  const base = join(root, ASIDE_DIR);
  if (!existsSync(base)) return 0;
  let n = 0;
  for (const id of readdirSync(base)) n += restoreAside(root, id);
  return n;
}
