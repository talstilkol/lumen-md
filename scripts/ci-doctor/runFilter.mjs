// from talstilkol/tasker (owner's code): src/pipeline/run-filter/index.js @ a696fd2, R12.12.
// Copied as it is, with three local changes: estimateTokens is inlined (tasker's
// tokens-router is not here), the saved-output hint names this script instead of
// `tasker expand`, and a small CLI is added at the end.
// Comments are tasker's own (Hebrew). The golden rule: an error line is never cut.
// TK-H7 — מסנן פלט פקודות: מחזיר לסוכן פלט קצר ומובנה, שומר את המלא לדיסק (tasker expand <id>).
// כלל הזהב: שורת שגיאה אף פעם לא נחתכת. רק הצלחות/רעש מקוצרים. בדיקות golden על פלטים אמיתיים של כלים (tests/fixtures/run-filter).
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
/** tasker's tokens-router default: characters per token (an estimate, marked as such in the ledger). */
export const DEFAULT_CHARS_PER_TOKEN = 3.6;
export function estimateTokens(text, ratio = DEFAULT_CHARS_PER_TOKEN) { return Math.ceil(String(text ?? '').length / ratio); }

export const ERR_RE = /\b(?:error|errors|fail|failed|failure|failures|exception|traceback|panic|fatal|not ok|\w*Error)\b|^E\s{2,}|✖|✗|^\.?\/?[\w.\/-]+\.\w+:\d+(?::\d+)?: /i; // האחרון: אבחון בסגנון file:line:col (go, gcc, mypy)
const PASSTHROUGH_LINES = 40, PASSTHROUGH_CHARS = 2500;

// ---------- עזרים ----------
const shape = (l) => l.replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
/** דה-דופ: רצף שורות זהות-בצורה (מספרים מנורמלים) → שורה אחת + ×N. שורות שגיאה לא מאוחדות לעולם. */
export function dedupe(lines) {
  const out = []; let i = 0;
  while (i < lines.length) {
    let j = i + 1; const s = shape(lines[i]);
    if (!ERR_RE.test(lines[i])) while (j < lines.length && shape(lines[j]) === s && !ERR_RE.test(lines[j])) j++;
    out.push(j - i > 1 ? `${lines[i]}  [×${j - i}]` : lines[i]); i = j;
  }
  return out;
}
const stripCwd = (text, cwd) => (cwd ? text.split(cwd.endsWith('/') ? cwd : cwd + '/').join('') : text);

// ---------- פילטרים ----------
export const FILTERS = {
  // node --test / TAP: רק בלוקי not ok (בלי פריימים פנימיים של node) + סיכום
  tap(text) {
    const L = text.split('\n'); const out = []; let inFail = false; let summary = [];
    for (const l of L) {
      if (/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(l)) { summary.push(l.slice(2)); continue; }
      if (/^\s*not ok \d+/.test(l)) { inFail = true; out.push(l.trim()); continue; }
      if (/^\s*ok \d+/.test(l) || /^# Subtest:/.test(l) || /^TAP version/.test(l) || /^\d+\.\.\d+$/.test(l)) { inFail = false; continue; }
      if (inFail) { if (/^\s*\.\.\.\s*$/.test(l)) { inFail = false; continue; } if (/\(node:(internal|async_hooks)/.test(l) || /^\s+(duration_ms|type):/.test(l) || /^\s*---\s*$/.test(l)) continue; out.push(l); }
    }
    const fail = +(summary.find((s) => s.startsWith('fail '))?.split(' ')[1] ?? 0); const pass = summary.find((s) => s.startsWith('pass '))?.split(' ')[1];
    return { summary: `${pass ?? '?'} עברו · ${fail} נכשלו`, body: [...out, summary.filter((s) => /^(tests|pass|fail|skipped|todo|cancelled) /.test(s)).join(' · ')].filter(Boolean), counts: { pass: +pass || 0, fail } };
  },
  // pytest: FAILURES/ERRORS + short summary; בלי שורת נקודות ובלי כותרת session
  pytest(text) {
    const L = text.split('\n'); const start = L.findIndex((l) => /^=+ (FAILURES|ERRORS) =+$/.test(l));
    const last = [...L].reverse().find((l) => /\b(passed|failed|error)\b.* in [\d.]+s/.test(l)) || '';
    const body = start >= 0 ? L.slice(start).filter((l) => !/^\.0 = <list_iterator/.test(l)) : L.filter((l) => ERR_RE.test(l) || /passed|failed/.test(l));
    const m = (k) => +((last.match(new RegExp(`(\\d+) ${k}`)) || [])[1] || 0);
    return { summary: `${m('passed')} עברו · ${m('failed')} נכשלו${m('error') ? ` · ${m('error')} שגיאות` : ''}`, body: dedupe(body), counts: { pass: m('passed'), fail: m('failed') + m('errors') + m('error') } };
  },
  // jest / vitest (UNVERIFIED מול פלט אמיתי — golden סינתטי): בלוקי ● / FAIL + שורות סיכום
  jest(text) {
    const L = text.split('\n'); const out = []; let inBlock = false;
    for (const l of L) {
      if (/^\s*(FAIL|✗|×)\s/.test(l) || /^\s*●\s/.test(l) || (/^\s*❯\s/.test(l) && ERR_RE.test(l))) { inBlock = true; out.push(l); continue; }
      if (/^\s*(PASS|✓)\s/.test(l)) { inBlock = false; continue; }
      if (/^\s*(Test Files|Tests|Test Suites|Snapshots|Time|Duration)\s/.test(l)) { inBlock = false; out.push(l.trim()); continue; }
      if (inBlock && !/^\s*at .*(node_modules|node:internal)/.test(l)) out.push(l);
    }
    const tests = L.find((l) => /^\s*Tests\s/.test(l)) || ''; const n = (k) => +((tests.match(new RegExp(`(\\d+) ${k}`)) || [])[1] || 0);
    return { summary: `${n('passed')} עברו · ${n('failed')} נכשלו`, body: dedupe(out), counts: { pass: n('passed'), fail: n('failed') } };
  },
  // tsc: כל השגיאות, מקובצות לפי קובץ
  tsc(text) {
    const by = new Map(); const other = []; let n = 0;
    for (const l of text.split('\n')) {
      const m = l.match(/^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/) || l.match(/^(.+?):(\d+):(\d+) - (error|warning) (TS\d+): (.*)$/);
      if (m) { n++; (by.get(m[1]) || by.set(m[1], []).get(m[1])).push(`  ${m[2]}:${m[3]} ${m[5]} ${m[6]}`); } else if (l.trim() && ERR_RE.test(l)) other.push(l);
    }
    const body = []; for (const [f, ls] of by) body.push(`${f} (${ls.length})`, ...ls);
    return { summary: `${n} שגיאות ב-${by.size} קבצים`, body: [...body, ...other], counts: { errors: n } };
  },
  // eslint stylish: כבר מקובץ; מוסר נתיבים מוחלטים (stripCwd) ושורות ריקות
  eslint(text) {
    const L = text.split('\n').filter((l) => l.trim()); const sum = L.find((l) => /✖ \d+ problems?/.test(l)) || '';
    const e = +((sum.match(/(\d+) errors?/) || [])[1] || 0), w = +((sum.match(/(\d+) warnings?/) || [])[1] || 0);
    return { summary: `${e} שגיאות · ${w} אזהרות`, body: L.map((l) => l.replace(/\s{2,}/g, ' ')), counts: { errors: e, warnings: w } };
  },
  // git diff: סטטיסטיקה לכל קובץ + עד 40 שורות שינוי לקובץ
  'git-diff'(text) {
    const files = []; let cur = null;
    for (const l of text.split('\n')) {
      const m = l.match(/^diff --git a\/(.+?) b\//); if (m) { cur = { f: m[1], add: 0, del: 0, lines: [] }; files.push(cur); continue; }
      if (!cur || /^(index |--- |\+\+\+ )/.test(l)) continue;
      if (/^\+/.test(l)) cur.add++; else if (/^-/.test(l)) cur.del++;
      cur.lines.push(l);
    }
    const body = []; const PER = 40;
    for (const f of files) { body.push(`── ${f.f} (+${f.add} −${f.del})`); const changed = f.lines.filter((l) => /^[+-@]/.test(l)); body.push(...changed.slice(0, PER)); if (changed.length > PER) body.push(`  … עוד ${changed.length - PER} שורות בקובץ הזה (node scripts/ci-doctor/runFilter.mjs expand <id> --grep ${JSON.stringify(f.f)})`); }
    return { summary: `${files.length} קבצים · +${files.reduce((s, f) => s + f.add, 0)} −${files.reduce((s, f) => s + f.del, 0)}`, body, counts: { files: files.length } };
  },
  // git status: קבוצות; קבצים לא במעקב מקובצים לפי תבנית שם
  'git-status'(text) {
    const L = text.split('\n'); const out = []; let section = null; const untracked = [];
    for (const l of L) {
      if (/^On branch|^Your branch|^HEAD detached/.test(l)) { out.push(l); continue; }
      if (/^Changes to be committed|^Changes not staged|^Untracked files|^Unmerged paths/.test(l)) { section = l.replace(':', ''); out.push(l); continue; }
      if (/^\s+\(use "git/.test(l) || !l.trim()) continue;
      if (section?.startsWith('Untracked')) { if (/^\t/.test(l)) { untracked.push(l.trim()); continue; } section = null; }
      if (/^\t/.test(l)) out.push(l.replace(/^\t/, '  ')); else if (!/^no changes added|^nothing added/.test(l)) out.push(l);
    }
    if (untracked.length) {
      const groups = new Map(); for (const f of untracked) { const k = f.replace(/\d+/g, '*'); (groups.get(k) || groups.set(k, []).get(k)).push(f); }
      for (const [k, fs] of groups) out.push(fs.length > 3 ? `  ${k}  [×${fs.length}]` : fs.map((f) => `  ${f}`).join('\n'));
    }
    return { summary: `${untracked.length} לא במעקב`, body: out.join('\n').split('\n'), counts: { untracked: untracked.length } };
  },
  // npm: שגיאות ואזהרות (מאוחדות); טקסט העזרה הקבוע (Usage/Options) מושמט עם ציון
  npm(text) {
    const L = text.split('\n'); const out = []; let help = false; let omitted = 0;
    for (const l of L) {
      if (/^npm (error|ERR!) (Clean install|Usage:|Options:|Run "npm help)/.test(l)) help = true;
      if (help && /^npm (error|ERR!)/.test(l) && !/A complete log|\.log$/.test(l)) { omitted++; continue; }
      if (/^npm (error|ERR!|warn|WARN)/.test(l) && l.replace(/^npm (error|ERR!|warn|WARN)\s*/, '').trim()) out.push(l);
      else if (/^(added|removed|changed|up to date|found) /.test(l)) out.push(l);
    }
    if (omitted) out.push(`(הושמטו ${omitted} שורות טקסט עזרה קבוע של npm)`);
    const errs = out.filter((l) => /^npm (error|ERR!)/.test(l)).length;
    return { summary: errs ? `${errs} שורות שגיאה` : 'הצליח', body: dedupe(out), counts: { errors: errs } };
  },
  // כללי: דה-דופ, שורות שגיאה עם הקשר ±2, traceback מלא, ראש וזנב של השאר
  generic(text) {
    const L = dedupe(text.split('\n')); const keep = new Set();
    L.forEach((l, i) => {
      if (ERR_RE.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(L.length - 1, i + 2); k++) keep.add(k);
      if (/^Traceback \(most recent call last\)/.test(l)) { let k = i; do { keep.add(k); k++; } while (k < L.length && /^\s/.test(L[k])); if (k < L.length) keep.add(k); } // עד שורת החריגה (הראשונה שאינה מוזחת), כולל
    });
    for (let k = 0; k < Math.min(10, L.length); k++) keep.add(k);
    for (let k = Math.max(0, L.length - 15); k < L.length; k++) keep.add(k);
    const body = []; let gap = 0;
    L.forEach((l, i) => { if (keep.has(i)) { if (gap) body.push(`  … (${gap} שורות רעש הושמטו)`); gap = 0; body.push(l); } else gap++; });
    if (gap) body.push(`  … (${gap} שורות רעש הושמטו)`);
    const errs = L.filter((l) => ERR_RE.test(l)).length;
    return { summary: errs ? `${errs} שורות עם שגיאה` : 'אין שגיאות מזוהות', body, counts: { errorLines: errs } };
  },
};

/** detectFamily(cmd, args, text) — לפי הפקודה, ואם לא ברור לפי צורת הפלט */
export function detectFamily(cmd, args = [], text = '') {
  const c = basename(cmd || ''); const a = args.join(' ');
  if (c === 'git' && args[0] === 'diff') return 'git-diff';
  if (c === 'git' && args[0] === 'status' && !args.includes('--porcelain') && !args.includes('-s')) return 'git-status';
  if (/^TAP version 13/m.test(text) || (c === 'node' && args.includes('--test'))) return 'tap';
  if (c === 'pytest' || /(^|\s)-m pytest\b/.test(a) || /^=+ (test session starts|FAILURES) =+$/m.test(text)) return 'pytest';
  if (c === 'tsc' || /\b(npx )?tsc\b/.test(a) || /\(\d+,\d+\): error TS\d+/.test(text)) return 'tsc';
  if (c === 'eslint' || /\beslint\b/.test(a) || /✖ \d+ problems? \(/.test(text)) return 'eslint';
  if (c === 'jest' || c === 'vitest' || /\b(jest|vitest)\b/.test(a) || /^\s*(Test Files|Test Suites)\s/m.test(text)) return 'jest';
  if (['npm', 'pnpm', 'yarn'].includes(c) && /^(i|install|ci|add|update)$/.test(args[0] || '')) return 'npm';
  if (/^npm (error|ERR!)/m.test(text) && !/^TAP/m.test(text)) return 'npm';
  return 'generic';
}

/** filterOutput({cmd,args,text,code,cwd}) → {family, summary, text, counts, passthrough} */
export function filterOutput({ cmd, args = [], text, code = 0, cwd = null, force = false }) {
  const clean = stripCwd(String(text ?? '').replace(/\r\n/g, '\n').replace(/\x1b\[[0-9;]*m/g, ''), cwd);
  if (!force && clean.split('\n').length <= PASSTHROUGH_LINES && clean.length <= PASSTHROUGH_CHARS) return { family: 'passthrough', summary: '', text: clean.trimEnd(), counts: {}, passthrough: true };
  const family = detectFamily(cmd, args, clean);
  const r = FILTERS[family](clean, { code });
  return { family, summary: r.summary, text: r.body.join('\n').trimEnd(), counts: r.counts, passthrough: false };
}

/** בדיקת כלל הזהב: כל שורה מהמקור שמזוהה כשגיאה מופיעה (אחרי הנרמול של הפילטר) בפלט */
export function lostErrorLines(raw, filtered, { cwd = null, family = null } = {}) {
  const norm = (s) => s.replace(/^#\s+/, '').replace(/\s+/g, ' ').trim();
  const out = filtered.split('\n').map(norm).join(' \u0000 '); const lost = []; let npmHelp = false;
  for (const l of stripCwd(raw.replace(/\x1b\[[0-9;]*m/g, ''), cwd).split('\n')) {
    if (!ERR_RE.test(l) || !l.trim()) continue;
    if (family === 'npm' && /^npm (error|ERR!)\s*$/.test(l)) continue;
    if (family === 'npm' && /^npm (error|ERR!) (Clean install|Usage:|Options:|Run "npm help)/.test(l)) npmHelp = true;
    if (npmHelp && /^npm (error|ERR!)/.test(l) && !/A complete log|\.log$/.test(l)) continue; // טקסט עזרה קבוע — מושמט במכוון ומדווח בפלט
    const n = norm(l); if (out.includes(n)) continue;
    const tsc = l.match(/^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/); if (tsc && out.includes(norm(`${tsc[2]}:${tsc[3]} ${tsc[4]} ${tsc[5]}`))) continue;
    lost.push(l);
  }
  return lost;
}

// ---------- הרצה + שמירה ----------
const INTERACTIVE = new Set(['vim', 'vi', 'nano', 'less', 'more', 'top', 'htop', 'ssh', 'man', 'watch']);
export function isInteractive(cmd, args = []) {
  const c = basename(cmd); if (INTERACTIVE.has(c)) return true;
  if (args.some((a) => a === '--watch' || a === '-w' || a === '--ui')) return true;
  if (['node', 'python3', 'python', 'irb', 'psql'].includes(c) && args.length === 0) return true;
  return false;
}

export function saveFull(dataDir, { cmd, args, text, code }, now = Date.now()) {
  const dir = join(dataDir, 'runs-output'); mkdirSync(dir, { recursive: true });
  const id = createHash('sha1').update(`${now}|${cmd}|${args.join(' ')}|${text.length}`).digest('hex').slice(0, 10);
  writeFileSync(join(dir, `${id}.txt.gz`), gzipSync(Buffer.from(`$ ${[cmd, ...args].join(' ')}\n# exit ${code}\n${text}`)));
  return id;
}
export function readFull(dataDir, id, { grep = null, context = 0 } = {}) {
  if (!/^[0-9a-f]{10}$/.test(id)) throw new Error('מזהה לא תקין');
  const f = join(dataDir, 'runs-output', `${id}.txt.gz`); if (!existsSync(f)) throw new Error(`אין פלט שמור ${id} (נמחק אחרי 7 ימים?)`);
  const text = gunzipSync(readFileSync(f)).toString('utf8'); if (!grep) return text;
  const re = new RegExp(grep, 'i'); const L = text.split('\n'); const keep = new Set();
  L.forEach((l, i) => { if (re.test(l)) for (let k = Math.max(0, i - context); k <= Math.min(L.length - 1, i + context); k++) keep.add(k); });
  return [...keep].sort((a, b) => a - b).map((i) => `${i + 1}: ${L[i]}`).join('\n');
}
export function pruneOld(dataDir, { days = 7, now = Date.now() } = {}) {
  const dir = join(dataDir, 'runs-output'); let n = 0; if (!existsSync(dir)) return 0;
  for (const f of readdirSync(dir)) { if (!/^[0-9a-f]{10}\.txt\.gz$/.test(f)) continue; const p = join(dir, f); if (now - statSync(p).mtimeMs > days * 864e5) { unlinkSync(p); n++; } }
  return n;
}

/** execCapture(cmd,args,{cwd,timeoutMs}) → {code, text} — stdout+stderr לפי סדר ההגעה, בלי shell */
export function execCapture(cmd, args, { cwd, timeoutMs = 0, env = process.env } = {}) {
  return new Promise((resolve) => {
    const chunks = []; let child;
    try { child = spawn(cmd, args, { cwd, env, shell: false }); } catch (e) { resolve({ code: 127, text: String(e.message) }); return; }
    const t = timeoutMs ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;
    child.stdout.on('data', (d) => chunks.push(d)); child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (e) => { chunks.push(Buffer.from(`${cmd}: ${e.code === 'ENOENT' ? 'command not found' : e.message}\n`)); });
    child.on('close', (code, sig) => { if (t) clearTimeout(t); resolve({ code: code ?? (sig ? 124 : 1), text: Buffer.concat(chunks).toString('utf8') }); });
  });
}

/** runFiltered(cmd,args,{cwd,dataDir,store,now}) → {code, output, id, family, rawTokens, outTokens, addedTokens} */
export async function runFiltered(cmd, args, { cwd = process.cwd(), dataDir, store = null, now = Date.now(), exec = execCapture } = {}) {
  const { code, text } = await exec(cmd, args, { cwd });
  const f = filterOutput({ cmd, args, text, code, cwd });
  const rawTokens = estimateTokens(text);
  if (f.passthrough) { store?.append('run-filter.jsonl', { at: new Date(now).toISOString(), cmd: basename(cmd), family: 'passthrough', exit: code, rawTokens, outTokens: rawTokens, addedTokens: 0 }); return { code, output: text, id: null, family: 'passthrough', rawTokens, outTokens: rawTokens, addedTokens: 0 }; }
  const id = saveFull(dataDir, { cmd, args, text, code }, now); pruneOld(dataDir, { now });
  const header = `[ci-doctor run] ${[basename(cmd), ...args].join(' ').slice(0, 80)} → exit ${code} · ${f.summary} · פלט מלא: node scripts/ci-doctor/runFilter.mjs expand ${id}`;
  const output = `${header}\n${f.text}\n`; const outTokens = estimateTokens(output); const addedTokens = estimateTokens(header);
  store?.append('run-filter.jsonl', { at: new Date(now).toISOString(), cmd: basename(cmd), family: f.family, exit: code, rawTokens, outTokens, addedTokens, estimated: true });
  return { code, output, id, family: f.family, rawTokens, outTokens, addedTokens };
}

export function runFilterReport(store, { days = 7, now = Date.now() } = {}) {
  const rows = store.readJsonl('run-filter.jsonl').filter((r) => Date.parse(r.at) >= now - days * 864e5);
  const raw = rows.reduce((s, r) => s + r.rawTokens, 0), out = rows.reduce((s, r) => s + r.outTokens, 0);
  return { days, runs: rows.length, rawTokens: raw, outTokens: out, savedTokens: raw - out, byFamily: rows.reduce((m, r) => ((m[r.family] = (m[r.family] || 0) + 1), m), {}), note: 'טוקנים מקורבים (תווים/יחס); net = כבר כולל את שורת הכותרת שהעטיפה מוסיפה' };
}

// ---------- CLI (lumen-md) ----------
// node scripts/ci-doctor/runFilter.mjs run -- <cmd> [args…]   short output; the full output is kept 7 days in .ci-doctor/
// node scripts/ci-doctor/runFilter.mjs expand <id> [--grep RE] [--context N]
const DATA_DIR = resolve(process.env.CI_DOCTOR_DIR || '.ci-doctor');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === 'run') {
    const argv = rest[0] === '--' ? rest.slice(1) : rest;
    if (!argv.length) { console.error('usage: runFilter.mjs run -- <cmd> [args…]'); process.exit(2); }
    const r = await runFiltered(argv[0], argv.slice(1), { dataDir: DATA_DIR });
    process.stdout.write(r.output); process.exitCode = r.code;
  } else if (sub === 'expand' && rest[0]) {
    const gi = rest.indexOf('--grep'), ci = rest.indexOf('--context');
    process.stdout.write(readFull(DATA_DIR, rest[0], { grep: gi >= 0 ? rest[gi + 1] : null, context: ci >= 0 ? Number(rest[ci + 1]) : 0 }) + '\n');
  } else { console.error('usage: runFilter.mjs run -- <cmd> [args…] | expand <id> [--grep RE] [--context N]'); process.exit(2); }
}
