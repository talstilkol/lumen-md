/**
 * The M3 launch kit's checks (plan W11.L3): every claim has a receipt in the
 * repository, nothing calls the cryptography audited, and each text is within
 * its site's limits. Pure functions over the files' text; scripts/launch-kit.mjs
 * reads the files and writes the generated "Sources" lists.
 */

export const KIT_FILES = ["show-hn.md", "product-hunt.md", "press-kit.en.md", "press-kit.he.md", "demo-60s.md"];

/** Limits of the places the texts go (characters, markers not counted). */
export const LIMITS = { hnTitle: 80, phTagline: 60, phDescription: 260, phFirstComment: 800, demoSeconds: 60 };

const MARK = /\[\^([a-z0-9-]+)\]/g;
const HAS_MARK = /\[\^[a-z0-9-]+\]/;
const SOURCES = /<!-- launch-kit:sources -->[\s\S]*?<!-- \/launch-kit:sources -->/;

/** Words that make a sentence a checkable claim: it then needs a marker. */
const CLAIM_WORDS = [
  /\d/,
  /\b(licen[cs]e|MIT|open[- ]source|offline|account|private|privacy|encrypt\w*|AES|Argon2id|sandbox\w*|plugins?|AI|WebGPU|import\w*|export\w*|niqqud|prefix\w*|languages?|desktop|local-first|audit\w*|finding|scorecard)\b/i,
  /(רישיון|קוד פתוח|בלי אינטרנט|חשבון|פרטיות|הצפנ|בלי רשת|ארגז חול|תוספים|תוסף|ייבוא|ייצוא|ניקוד|תחיליות|שפות|שולחן העבודה|ביקורת|ממצא)/,
];
/** "Audited" and its kin: allowed only in a sentence that says it is not so. */
const AUDIT = /\b(audited|certified|military[- ]grade|bank[- ]grade|unbreakable|independently (reviewed|verified))\b|מבוקר|עבר(ה)? ביקורת|מאושר(ת)?|מוסמכ(ת)?|בלתי ניתנ(ת)? לפריצה/i;
const NEGATION = /\b(not|no|never|n't|hasn't|has not|don't|isn't)\b|(^|\s)(לא|אין|טרם|אל)(\s|$)/i;
/** The taken domain (the project's name with the .md TLD), built so this file doesn't spell it. */
const BANNED_DOMAIN = new RegExp(`\\blumen\\.${"m"}d\\b`, "i");

const norm = (s) => s.replace(/\s+/g, " ").trim();
/**
 * Sections pasted as they are into a site's one-line fields (they can't carry
 * markers): their limits are checked, and the same claims are made, with
 * receipts, in the text below them.
 */
export const VERBATIM = ["Title", "Link", "Name", "Tagline", "Topics", "Gallery"];

/** The text a reader sees: no generated sources, no comments, no quote blocks (the drafts' notes to the owner), no one-line fields. */
export function body(md) {
  let out = md;
  for (const h of VERBATIM) out = out.replace(new RegExp(`^## ${h}\\s*\\n[\\s\\S]*?(?=^## |<!-- launch-kit:sources)`, "m"), "");
  return out
    .replace(SOURCES, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n");
}
/** What a reader reads: no markers, no emphasis marks. */
const visible = (s) => norm(s.replace(MARK, "").replace(/\*\*|__/g, ""));

/** A Markdown section's text, by its `## Heading`. */
export function section(md, heading) {
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |<!-- launch-kit:sources|$(?![\\s\\S]))`, "m").exec(md);
  return m ? m[1].trim() : null;
}

/** Sentences (and table cells / list items) of the readable text. */
function sentences(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^\|?\s*-{3,}/.test(line)) continue;
    // A table row is one unit: one marker backs the shot, its English and its Hebrew.
    if (line.startsWith("|")) {
      out.push(line);
      continue;
    }
    for (const s of line.replace(/^[-*]\s+/, "").split(/(?<=[.!?;:](?:\[\^[a-z0-9-]+\])*)\s+(?=[A-Z\u0590-\u05FF\u200F„"“*])/u)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

/** Problems with the kit. `files`: name → text; `claims`: the ledger; `readRepo(path)` → text or null. */
export function kitProblems(files, ledger, readRepo) {
  const problems = [];
  const claims = ledger?.claims ?? {};
  if (ledger?.format !== "lumen-launch-claims/1") problems.push("claims.json: unknown format");
  // Receipts: the file exists and contains the quote.
  for (const [id, c] of Object.entries(claims)) {
    if (!c.en || !c.source || !c.quote) {
      problems.push(`claims.json ${id}: needs en, source and quote`);
      continue;
    }
    if (/^https?:/.test(c.source)) {
      problems.push(`claims.json ${id}: the receipt must be a file in this repository, not a URL`);
      continue;
    }
    const text = readRepo(c.source);
    if (text === null) problems.push(`claims.json ${id}: ${c.source} does not exist`);
    else if (!norm(text).includes(norm(c.quote))) problems.push(`claims.json ${id}: ${c.source} no longer says "${c.quote}"`);
    if (AUDIT.test(c.en) && !NEGATION.test(c.en)) problems.push(`claims.json ${id}: claims an audit`);
  }
  const used = new Set();
  for (const name of KIT_FILES) {
    const md = files[name];
    if (md === undefined) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (!SOURCES.test(md)) problems.push(`${name}: no launch-kit:sources block`);
    else if (md.match(SOURCES)[0] !== sourcesBlock(md, claims)) problems.push(`${name}: the Sources list is out of date (run node scripts/launch-kit.mjs --write)`);
    if (BANNED_DOMAIN.test(md)) problems.push(`${name}: names the taken domain; the site is lumen-md.vercel.app`);
    const text = body(md);
    for (const m of text.matchAll(MARK)) {
      used.add(m[1]);
      if (!claims[m[1]]) problems.push(`${name}: [^${m[1]}] is not in claims.json`);
    }
    for (const s of sentences(text)) {
      const plain = visible(s);
      if (AUDIT.test(plain) && !NEGATION.test(plain)) problems.push(`${name}: claims an audit: "${plain}"`);
      if (CLAIM_WORDS.some((re) => re.test(plain)) && !HAS_MARK.test(s) && !isExempt(plain)) problems.push(`${name}: a claim without a receipt: "${plain}"`);
    }
  }
  // Limits.
  const hn = files["show-hn.md"];
  if (hn) {
    const title = section(hn, "Title");
    if (!title) problems.push("show-hn.md: no Title");
    else {
      if (!title.startsWith("Show HN: ")) problems.push("show-hn.md: the title must start with \"Show HN: \"");
      if ([...visible(title)].length > LIMITS.hnTitle) problems.push(`show-hn.md: the title is ${[...visible(title)].length} > ${LIMITS.hnTitle} characters`);
    }
    if (!/^https:\/\/lumen-md\.vercel\.app\/?$/.test(section(hn, "Link") ?? "")) problems.push("show-hn.md: the Link must be https://lumen-md.vercel.app");
  }
  const ph = files["product-hunt.md"];
  if (ph) {
    for (const [h, max] of [["Tagline", LIMITS.phTagline], ["Description", LIMITS.phDescription], ["First comment", LIMITS.phFirstComment]]) {
      const t = section(ph, h);
      if (!t) problems.push(`product-hunt.md: no ${h}`);
      else if ([...visible(t)].length > max) problems.push(`product-hunt.md: the ${h.toLowerCase()} is ${[...visible(t)].length} > ${max} characters`);
    }
  }
  const demo = files["demo-60s.md"];
  if (demo) {
    const spans = [...demo.matchAll(/^\|\s*(\d+):(\d\d)–(\d+):(\d\d)\s*\|/gm)].map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
    let at = 0;
    for (const [a, b] of spans) {
      if (a !== at || b <= a) problems.push(`demo-60s.md: shots must follow on without gaps (${a}s after ${at}s)`);
      at = b;
    }
    if (at !== LIMITS.demoSeconds) problems.push(`demo-60s.md: the shots add up to ${at} s, not ${LIMITS.demoSeconds}`);
  }
  // The security section: each press kit says there has been no external audit.
  // A sentence, backed by the security page, that says there has been no external audit.
  const saysNoAudit = (md) => sentences(body(md)).some((x) => x.includes("[^no-external-audit]") && NEGATION.test(visible(x)) && /external|חיצוני/i.test(visible(x)));
  for (const name of ["press-kit.en.md", "press-kit.he.md", "show-hn.md"]) if (files[name] && !saysNoAudit(files[name])) problems.push(`${name}: must say that there has been no external audit ([^no-external-audit])`);
  for (const id of Object.keys(claims)) if (!used.has(id)) problems.push(`claims.json ${id}: not used by any file`);
  return problems;
}

/** Lines that point rather than claim: owner placeholders and the source link. */
function isExempt(s) {
  return /^(OWNER:|Source: https:\/\/github\.com\/talstilkol\/lumen-md$)/.test(s);
}

/**
 * The generated Sources list for a file: each marker it uses, with its receipt.
 * A Hebrew file (its title in Hebrew) takes a claim's `he` text where claims.json
 * has one (R8-L8), and the English otherwise.
 */
export function sourcesBlock(md, claims) {
  const ids = [...new Set([...body(md).matchAll(MARK)].map((m) => m[1]))];
  const hebrew = /[\u05D0-\u05EA]/.test(md.split("\n", 1)[0] ?? "");
  const line = (id) => (hebrew && claims[id].he ? `[^${id}]: ${claims[id].he} קבלה: \`${claims[id].source}\`.` : `[^${id}]: ${claims[id].en} Receipt: \`${claims[id].source}\`.`);
  const lines = ids.map((id) => (claims[id] ? line(id) : `[^${id}]: (not in claims.json)`));
  return `<!-- launch-kit:sources -->\n${lines.length ? `\n## Sources\n\n${lines.join("\n")}\n\n` : ""}<!-- /launch-kit:sources -->`;
}

/** A section as it is pasted: markers taken out. */
export function plain(md, heading) {
  const t = section(md, heading);
  return t === null ? null : t.replace(MARK, "").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

export function withSources(md, claims) {
  return md.replace(SOURCES, sourcesBlock(md, claims));
}
