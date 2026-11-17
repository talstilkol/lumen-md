#!/usr/bin/env node
/**
 * One owner index for every lane's owner pack (integrator INT6a, wave g6).
 *
 *   node scripts/mac-pack/owner-index.mjs           write plan/owner-pack/index.md and index.he.md
 *   node scripts/mac-pack/owner-index.mjs --check   exit 1 when either file is not what the JSON gives
 *
 * Reads every plan/owner-pack/L*.json. Several lanes ask for the same owner
 * action (switch Buildkite on, the e2e receipt key, the GitHub security
 * settings…): those become ONE row that lists every lane item it answers.
 * An item that names several shared actions is listed under each of them
 * (review 12, L1). Items no topic claims stay one row each, merged only when
 * two lanes name the same plan task. The "do these first" order is the TOPICS order below:
 * each of those unblocks other rows. Everything else follows, the rows that
 * answer the most items first.
 *
 * The Hebrew file's own sentences are machine-written and need a native
 * speaker's review; the decision texts are the lanes' (English) words.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Shared owner actions. `first` rows are the "do these first" list, in this
 * order; `re` is matched against an item's decision text.
 */
export const TOPICS = [
  { key: "promote-main", first: true, re: /promot(?:e|ing) main|promote:main|main in steps|train stack into main|e2e receipt public key|which key signs that receipt/i, en: "Promote main to the train (fast-forward) and pick the key that signs the e2e receipt", he: "לקדם את main לרכבת (fast-forward) ולבחור את המפתח שחותם על קבלת ה-e2e", why: { en: "Every release, rescan and production check waits for main to move; #1099 already made main fast-forwardable to train 7.", he: "כל שחרור, סריקה מחדש ובדיקת ייצור מחכים לכך ש-main יזוז; ‏#1099 כבר הפך את main ל-fast-forward לרכבת 7." } },
  { key: "github-security", first: true, re: /private vulnerability reporting|secret scanning|push protection|GitHub security settings/i, en: "Turn on the GitHub security settings: private vulnerability reporting, secret scanning, push protection, the ruleset, the human-reviewed label", he: "להפעיל את הגדרות האבטחה של GitHub: דיווח פרטי על חולשות, סריקת סודות, push protection, ה-ruleset והתווית human-reviewed", why: { en: "Draft #1101 and SECURITY.md's first channel wait on it, and so does every sensitive PR's label.", he: "טיוטה #1101 והערוץ הראשון ב-SECURITY.md מחכים לזה, וכך גם התווית של כל PR רגיש." } },
  { key: "buildkite", first: true, re: /Turn Buildkite on|Buildkite (?:Free )?organi[sz]ation|Buildkite API token|Buildkite's `pr-check`|Same Buildkite decision|PR security scanners/i, en: "Switch Buildkite on once: one organisation, one pipeline from .buildkite/pipeline.yml, a linux agent and the Mac agent", he: "להפעיל את Buildkite פעם אחת: ארגון אחד, צינור אחד מ-.buildkite/pipeline.yml, סוכן linux וסוכן ה-Mac", why: { en: "One switch-on answers every lane's PR-check, scanner, Lighthouse and ci-doctor item at once.", he: "הפעלה אחת עונה בבת אחת על כל פריטי בדיקת ה-PR, הסורקים, Lighthouse ו-ci-doctor של כל המסלולים." } },
  { key: "vercel-ignore", first: true, re: /Ignored Build Step|Same setting as W10\.O3/i, en: "Set the Vercel project's Ignored Build Step to `bash scripts/vercel-ignore.sh`", he: "להגדיר בפרויקט Vercel את Ignored Build Step ל-`bash scripts/vercel-ignore.sh`", why: { en: "Five minutes in the dashboard; it stops wasted builds on every push.", he: "חמש דקות בלוח הבקרה; זה עוצר בניות מיותרות בכל push." } },
  { key: "reviewers", first: true, re: /second maintainer|human reviewers?|second reviewer|reviewer signing keys|Review receipts/i, en: "Name a second maintainer or reviewer, create the reviewer signing keys, and sign the receipts the sensitive PRs owe", he: "למנות מתחזק או סוקר שני, ליצור את מפתחות החתימה של הסוקרים ולחתום על הקבלות שה-PR הרגישים חייבים", why: { en: "Security, vault, sync and plugin PRs cannot be called reviewed without it.", he: "בלי זה אי אפשר לומר שה-PR של אבטחה, כספת, סנכרון ותוספים נסקרו." } },
  { key: "model-mirror", first: true, re: /model mirror|model-mirror|release assets on|GitHub Releases? (?:of this repo|on talstilkol)|Pin the 24 models|menaked/i, en: "Publish the models on this repo's GitHub Releases behind the model-mirror Worker (pinned revisions, sha256 in models/registry.json)", he: "לפרסם את המודלים ב-GitHub Releases של המאגר מאחורי ה-Worker של model-mirror (גרסאות נעוצות, sha256 ב-models/registry.json)", why: { en: "models:day, nikud, translation and the golden runs on the Mac read from the mirror.", he: "models:day, הניקוד, התרגום וריצות ה-golden ב-Mac קוראים מהמראה." } },
  { key: "release-keys", first: true, re: /release key|beta\.1|first release so the downloads page/i, en: "Make the offline release key and updater key, then cut and sign 0.2.0-beta.1", he: "ליצור את מפתח השחרור הלא-מקוון ואת מפתח העדכונים, ואז לחתוך ולחתום את 0.2.0-beta.1", why: { en: "The downloads page, the updater drill and the M0 launch gate all wait for a signed release.", he: "דף ההורדות, תרגיל העדכון ושער ההשקה M0 מחכים כולם לשחרור חתום." } },
  { key: "deploy-sites", re: /content[- ]frame|share server|live-share server|relay on Cloudflare/i, en: "Deploy the separate sites: the content frame on its own origin, the share server and the relay", he: "לפרוס את האתרים הנפרדים: מסגרת התוכן במקור משלה, שרת השיתוף והממסר" },
  { key: "second-host", re: /second (?:deployment )?host|Cloudflare Pages|Workers Builds/i, en: "Set up the second host (Cloudflare) for the site and the nightly factory", he: "להקים את המארח השני (Cloudflare) לאתר ולמפעל הלילי" },
  { key: "sponsors", re: /Sponsors|Open Collective/i, en: "Open GitHub Sponsors and Open Collective, then merge the prepared switch", he: "לפתוח GitHub Sponsors ו-Open Collective, ואז למזג את המתג המוכן" },
  { key: "discussions", re: /GitHub Discussions|open Discussions|Open GitHub Discussions/i, en: "Turn on GitHub Discussions and publish the docs site", he: "להפעיל את GitHub Discussions ולפרסם את אתר התיעוד" },
  { key: "percy", re: /Percy|BrowserStack/i, en: "Open the BrowserStack open-source plan (Percy and Automate), or decide not to use it", he: "לפתוח את תוכנית הקוד הפתוח של BrowserStack ‏(Percy ו-Automate), או להחליט לוותר" },
  { key: "signpath", re: /SignPath/i, en: "Apply to SignPath Foundation for free Windows signing", he: "להגיש בקשה ל-SignPath Foundation לחתימת Windows בחינם" },
  { key: "renovate", re: /Renovate|dependabot/i, en: "Dependencies: clear the dependabot PRs, run a real audit, install Renovate", he: "תלויות: לסגור את ה-PR של dependabot, להריץ audit אמיתי, להתקין את Renovate" },
  { key: "people", re: /usability|unmoderated|Recruit|beta of 50|participants/i, en: "Recruit people: usability rounds, the closed Hebrew beta, reviewers", he: "לגייס אנשים: סבבי שמישות, הבטא העברית הסגורה, סוקרים" },
  { key: "crypto-review", re: /crypto review|review of the sync|security review of the sync|E2EE primitives/i, en: "Order the external crypto review and accept the audited-library switch", he: "להזמין סקירת קריפטו חיצונית ולאשר את המעבר לספריות שנבדקו" },
  { key: "heldout-key", re: /held-out (?:recipient|evaluator) key/i, en: "Hold the held-out evaluator key and seal the test split", he: "להחזיק את מפתח המעריך של הסט הסמוי ולחתום את פיצול המבחן" },
  { key: "oauth", re: /OAuth/i, en: "Register the sync OAuth apps (Google Drive, Dropbox)", he: "לרשום את אפליקציות ה-OAuth לסנכרון (Google Drive, ‏Dropbox)" },
  { key: "cas-real", re: /CAS (?:conformance|probe)|real Google Drive/i, en: "Run the storage checks against real accounts (WebDAV, S3/R2/B2, Drive)", he: "להריץ את בדיקות האחסון מול חשבונות אמיתיים (WebDAV, ‏S3/R2/B2, ‏Drive)" },
  { key: "real-exports", re: /Notion (?:exports|database export)|real exports|real files per format/i, en: "Provide real exports (Notion and the other importers) with consent", he: "לספק ייצואים אמיתיים (Notion ושאר המייבאים) בהסכמה" },
  { key: "legal-packet", re: /legal packet/i, en: "Send the legal packet to a privacy clinic", he: "לשלוח את החבילה המשפטית לקליניקה לפרטיות" },
  { key: "voice", re: /neural (?:TTS )?voice|voice licence|CC0 Hebrew voice/i, en: "Choose the Hebrew voice whose weights and training data allow shipping", he: "לבחור את הקול העברי שהמשקלות ונתוני האימון שלו מתירים הפצה" },
];

/** Every item of every lane's owner pack. */
export function loadOwnerPacks(root) {
  const dir = join(root, "plan/owner-pack");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^L\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5)));
  return files.flatMap((f) => {
    const list = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return list.map((x) => ({ lane: f.slice(0, -5), ...x }));
  });
}

const prOf = (x) => {
  const p = x.draftPr;
  if (!p) return null;
  if (typeof p === "object") return p.number ? `#${p.number}` : p.title ?? null;
  const m = String(p).match(/#(\d+)/);
  return m ? `#${m[1]}` : String(p);
};
const cmdOf = (x) => x.check ?? x.cmd ?? x.ownerCmd ?? null;
const taskOf = (x) => x.task ?? (String(x.id).match(/(?:^|[-/.])((?:W\d+\.)?[A-Z]?\d+(?:\.\d+)?|R\d+\.\d+)$/)?.[1] ?? null);

/** Rows: [{key, title:{en,he}, why?, first, items:[…]}] in index order. */
export function group(items) {
  const rows = new Map();
  for (const x of items) {
    const text = `${x.decision ?? ""}`;
    // Review 12, L1: an item that asks for several shared actions is listed under each of them, not only the first.
    const ts = TOPICS.filter((tp) => tp.re.test(text));
    const keys = ts.length ? ts.map((t) => [t.key, t]) : [[`task:${taskOf(x) ?? x.id}`, null]];
    for (const [key, t] of keys) {
      if (!rows.has(key)) rows.set(key, t ? { key, topic: t, first: !!t.first, items: [] } : { key, topic: null, first: false, items: [] });
      rows.get(key).items.push(x);
    }
  }
  const firsts = TOPICS.filter((t) => t.first).map((t) => rows.get(t.key)).filter(Boolean);
  const rest = [...rows.values()].filter((r) => !r.first).sort((a, b) => b.items.length - a.items.length || new Set(b.items.map((i) => i.lane)).size - new Set(a.items.map((i) => i.lane)).size || a.items[0].id.localeCompare(b.items[0].id, "en"));
  return [...firsts, ...rest];
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const short = (s, n = 220) => {
  const t = esc(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const L = {
  en: { title: "Owner pack — one index for every lane", gen: "Generated by `node scripts/mac-pack/owner-index.mjs` from plan/owner-pack/L*.json; do not edit by hand.", counts: (i, r, l) => `${i} lane items, ${r} owner actions after merging the ones several lanes ask for, from ${l} lanes.`, first: "Do these first", firstNote: "Each of these unblocks other rows; do them in this order.", rest: "Everything else", restNote: "Rows that answer the most lane items come first.", items: "Lane items", rec: "Recommendation", pr: "Draft PR", check: "Check", why: "Why first", lanePacks: "The lanes' own packs", none: "—" },
  he: { title: "חבילת הבעלים — אינדקס אחד לכל המסלולים", gen: "נוצר על ידי `node scripts/mac-pack/owner-index.mjs` מתוך plan/owner-pack/L*.json; לא לערוך ידנית. המשפטים בעברית בקובץ הזה נכתבו במכונה וצריכים סקירה של דובר/ת עברית; טקסט ההחלטות הוא של המסלולים (באנגלית).", counts: (i, r, l) => `${i} פריטים של מסלולים, ${r} פעולות בעלים אחרי איחוד מה שכמה מסלולים מבקשים, מתוך ${l} מסלולים.`, first: "לעשות קודם", firstNote: "כל אחת מאלה משחררת שורות אחרות; לעשות לפי הסדר.", rest: "כל השאר", restNote: "קודם השורות שעונות על הכי הרבה פריטים.", items: "פריטי המסלולים", rec: "המלצה", pr: "PR טיוטה", check: "בדיקה", why: "למה קודם", lanePacks: "החבילות של המסלולים", none: "—" },
};

/** The index in `lang` ("en" | "he"). */
export function render(items, lang = "en") {
  const t = L[lang];
  const rows = group(items);
  const lanes = [...new Set(items.map((i) => i.lane))];
  const out = [`# ${t.title}`, "", t.gen, "", t.counts(items.length, rows.length, lanes.length), ""];
  if (lang === "he") out.splice(1, 0, "", '<div dir="rtl">');
  const block = (r, n) => {
    const title = r.topic ? r.topic[lang] : esc(r.items[0].decision);
    const lines = [`### ${n}. ${title}`, ""];
    if (r.topic?.why) lines.push(`- **${t.why}:** ${r.topic.why[lang]}`);
    lines.push(`- **${t.items}:** ${r.items.map((i) => `${i.lane} \`${i.id}\`${taskOf(i) ? ` (${taskOf(i)})` : ""}`).join(", ")}`);
    const recs = new Map(); // recommendation text → the first item that gives it
    for (const i of r.items) if (i.recommendation && !recs.has(short(i.recommendation, 160))) recs.set(short(i.recommendation, 160), i.id);
    if (recs.size) lines.push(`- **${t.rec}:** ${recs.size === 1 ? [...recs.keys()][0] : [...recs].map(([x, id]) => `\`${id}\` ${x}`).join(" · ")}`);
    const prs = [...new Set(r.items.map(prOf).filter(Boolean))];
    if (prs.length) lines.push(`- **${t.pr}:** ${prs.join(", ")}`);
    const cmds = [...new Set(r.items.map(cmdOf).filter(Boolean))];
    for (const c of cmds) lines.push(`- **${t.check}:** \`${short(c, 300).replace(/`/g, "'")}\``);
    if (r.topic) for (const i of r.items) lines.push(`  - \`${i.id}\`: ${short(i.decision)}`);
    lines.push("");
    return lines;
  };
  let n = 0;
  out.push(`## ${t.first}`, "", t.firstNote, "");
  for (const r of rows.filter((x) => x.first)) out.push(...block(r, ++n));
  out.push(`## ${t.rest}`, "", t.restNote, "");
  for (const r of rows.filter((x) => !x.first)) out.push(...block(r, ++n));
  out.push(`## ${t.lanePacks}`, "", ...lanes.map((l) => `- ${l}: [${l}${lang === "he" ? ".he" : ""}.md](${l}${lang === "he" ? ".he" : ""}.md), [${l}.json](${l}.json)`), "");
  if (lang === "he") out.push("</div>", "");
  return out.join("\n");
}

export function main(argv, root = ROOT) {
  const items = loadOwnerPacks(root);
  const want = { "plan/owner-pack/index.md": render(items, "en"), "plan/owner-pack/index.he.md": render(items, "he") };
  if (argv.includes("--check")) {
    const stale = Object.entries(want).filter(([f, body]) => !existsSync(join(root, f)) || readFileSync(join(root, f), "utf8") !== body).map(([f]) => f);
    if (stale.length) console.error(`owner-index: out of date: ${stale.join(", ")} (run node scripts/mac-pack/owner-index.mjs)`);
    else console.log(`owner-index: up to date (${items.length} items)`);
    return stale.length ? 1 : 0;
  }
  for (const [f, body] of Object.entries(want)) writeFileSync(join(root, f), body);
  console.log(`owner-index: ${items.length} items → ${group(items).length} rows → plan/owner-pack/index.md, index.he.md`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
