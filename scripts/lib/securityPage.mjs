/**
 * Plan W11.S12 — the public security page, /security and /he/security,
 * written from what the repository holds: the findings register
 * (security/findings.json) and the plugin scorecards of W11.S14
 * (public/plugins/examples/scorecards/*.json). Shared by
 * scripts/security-page.mjs and its tests.
 */

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["open", "accepted", "fixed"];

/** Problems with the findings register. */
export function findingsProblems(data) {
  const out = [];
  if (!data?.audit || typeof data.audit.external !== "boolean" || !data.audit.en?.trim() || !data.audit.he?.trim()) out.push("audit: needs external (true/false) and the status in English and Hebrew");
  if (data?.audit?.external === true && !/^https:\/\//.test(String(data.audit.report ?? ""))) out.push("audit: an external audit needs the published report (https link)");
  const ids = new Set();
  for (const f of data?.findings ?? []) {
    const w = f?.id ?? "(no id)";
    if (!/^LUM-\d{4}-\d{3}$/.test(String(f?.id))) out.push(`${w}: id must be LUM-YYYY-NNN`);
    if (ids.has(f.id)) out.push(`${w}: listed twice`);
    ids.add(f.id);
    if (!STATUSES.includes(f.status)) out.push(`${w}: status must be ${STATUSES.join(", ")}`);
    if (!SEVERITIES.includes(f.severity)) out.push(`${w}: severity must be ${SEVERITIES.join(", ")}`);
    if (!f.en?.trim() || !f.he?.trim()) out.push(`${w}: needs the finding in English and Hebrew`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.opened))) out.push(`${w}: opened must be a date`);
    if (f.status === "fixed" && !String(f.fixedBy ?? "").trim()) out.push(`${w}: a fixed finding names the PR that fixed it (fixedBy)`);
  }
  return out;
}

/**
 * The findings register against W11.S1's audit record (security/crypto-audit.json):
 * the page may not say "audited" while the record has no external report,
 * nor "not audited" once it has one, and while there is none an open finding
 * must say so (area "sync").
 */
export function cryptoAuditProblems(findings, cryptoAudit) {
  if (!cryptoAudit) return [];
  const out = [];
  const audited = cryptoAudit.external !== null && cryptoAudit.external !== undefined;
  if (audited && !/^https:\/\//.test(String(cryptoAudit.external?.report ?? ""))) out.push("security/crypto-audit.json: an external audit needs its published report (https link)");
  if (Boolean(findings?.audit?.external) !== audited) out.push(`security/findings.json says external: ${Boolean(findings?.audit?.external)}, but security/crypto-audit.json ${audited ? "records an external audit" : "has no external audit"} (W11.S1)`);
  if (!audited && !(findings?.findings ?? []).some((f) => f.area === "sync" && f.status !== "fixed")) out.push("no external audit yet: an open finding (area sync) must say so");
  return out;
}

/** Privacy label lines for a plugin, from the permissions its manifest declares. */
export function privacyLabel(permissions, lang) {
  const L = {
    en: { "document:read": "Reads the open note", "document:write": "Changes the open note", "vault:read": "Reads notes in your vault", "vault:write": "Changes notes in your vault", "bases:read": "Reads rows of your Bases views", "bases:write": "Changes note properties (one approval per call)", "clipboard:write": "Writes to the clipboard", storage: "Keeps its own data on this device", settings: "Keeps its settings", notifications: "Shows notifications", network: (o) => `Can send data to ${o}`, none: "Collects nothing: no network access" },
    he: { "document:read": "קורא את הפתק הפתוח", "document:write": "משנה את הפתק הפתוח", "vault:read": "קורא פתקים בכספת", "vault:write": "משנה פתקים בכספת", "bases:read": "קורא שורות מתצוגות Bases", "bases:write": "משנה מאפייני פתקים (אישור לכל קריאה)", "clipboard:write": "כותב ללוח", storage: "שומר נתונים משלו במכשיר הזה", settings: "שומר את ההגדרות שלו", notifications: "מציג התראות", network: (o) => `יכול לשלוח נתונים אל ${o}`, none: "לא אוסף כלום: בלי גישה לרשת" },
  }[lang];
  const lines = [];
  for (const p of permissions) {
    if (p.startsWith("network:")) lines.push(L.network(p.slice(8)));
    else if (typeof L[p] === "string") lines.push(L[p]);
  }
  if (!permissions.some((p) => p.startsWith("network:"))) lines.push(L.none);
  return lines;
}

const T = {
  en: {
    title: "Security",
    description: "Lumen's security status in public: the external audit (none yet), the threat model, fuzzing, release provenance, every open finding, and a review scorecard with a privacy label for each plugin.",
    intro: "This page is written from the repository itself: the findings register (`security/findings.json`) and the plugin scorecards (`public/plugins/examples/scorecards/`). A test fails when the page is out of date, so an open finding can't be left off it.",
    audit: "External audit",
    e2ee: (scope) => `**Encrypted sync is experimental.** While no external audit is published, encrypted sync (E2EE) is behind an experimental flag that is off in every channel, beta included, and its setup screen says it has not had an external security audit (plan W11.S1). This cryptography is not audited, no text in the app may say it is, and a check enforces that. The audit covers ${scope}.`,
    e2eeAudited: (a) => `Encrypted sync was audited by ${a.auditor} (${a.date}): [the full report](${a.report})${a.openFindings ? `, [its open findings](${a.openFindings})` : ""}.`,
    threat: "Threat model",
    threatBody: "What is protected, who we defend against, and the known gaps: [Threat model](/security/threat-model/).",
    fuzz: "Fuzzing",
    fuzzBody: "The decoders are fuzzed (`npm run fuzz`, 1,000,000 inputs per decoder); how and what is covered: [Supply chain](/security/supply-chain/). Results per release are not published on this page yet.",
    fuzzRunsBody: "The decoders are fuzzed (`npm run fuzz`, 1,000,000 inputs per decoder); how and what is covered: [Supply chain](/security/supply-chain/). The published runs, from `security/fuzz-results.json` (a run passes with 0 crashes, 0 hangs and nothing over the slow limit):",
    fuzzCols: "| date | commit | decoder | inputs | seed | clock | crashes | hangs | over the slow limit | slowest |",
    fuzzNote: "Only the decoders listed here have a published run; the others are fuzzed by `npm run fuzz` but their results are not on this page yet.",
    slsa: "Release provenance (SLSA)",
    slsaBody: "Releases are built to carry signatures and SLSA provenance (`npm run release:sign`, `npm run release:verify`, plan W7.22); see [Supply chain](/security/supply-chain/). No signed release has been published yet: the first is 0.2.0-beta.1 (launch gate M0).",
    open: "Open findings",
    openIntro: "Every finding that is still open or accepted, with its severity. A finding leaves this list only when it is fixed, with the change that fixed it.",
    none: "No open findings.",
    cols: "| id | severity | area | finding | since |",
    plugins: "Plugin review scorecards",
    pluginsIntro: "Every version of every plugin in the registry goes through an automated review before it is listed (plan W11.S14): static analysis (eval, Function, obfuscation, minified-only bundles, undeclared network origins), its permissions against the previous version, its stylesheet (no remote `@import`, `url()`, `image-set()` or `src()`, escaped forms included, and no `var()`, `env()` or `attr()` inside those functions, because the review cannot see the value they put there), a public source and an open-source licence, and the packages in its lockfile against the known-bad list (`security/known-bad.json`; high or critical fails it). A version that fails is not listed; a listed version whose review failed is taken down within 24 hours. The privacy label comes from the permissions the manifest declares.",
    pcols: "| plugin | version | grade | score | privacy label |",
    transparency: "Transparency report",
    transparencyBody: "Every six months, the requests for user data the relay and the share server received, answered and rejected: [Transparency report](/security/transparency/). The store privacy labels are built from the privacy ledger, and a check fails when a route is missing from them (`store/privacy-labels.json`).",
    report: "Report a vulnerability",
    reportBody: "Privately, as [SECURITY.md](https://github.com/talstilkol/lumen-md/blob/main/SECURITY.md) explains.",
    securityTxt: "The same contact is in [`/.well-known/security.txt`](https://lumen-md.vercel.app/.well-known/security.txt) (RFC 9116); a check fails when the file expires.",
    cra: "Disclosure timelines (EU Cyber Resilience Act)",
    craBody: (c) => `The reporting duties of the CRA (${c.article}) apply from ${c.appliesFrom}. A free project that is not monetised is most likely outside them, but Lumen keeps the same clock for a vulnerability that is actively exploited:`,
    craCols: "| When | What Lumen publishes |",
    craRows: (c) => [
      `| ≤ ${c.earlyWarningHours} hours after learning it is exploited | Early warning: what is affected and what to do meanwhile, with no exploit details. |`,
      `| ≤ ${c.notificationHours} hours | Notification: the affected versions, the severity (CVSS 3.1) and the mitigations. |`,
      `| ≤ ${c.finalReportDays} days after a fix or mitigation is available | Final report: the GitHub security advisory (GHSA) with the description, severity, impact, root cause and fix, and a CVE requested through it. |`,
    ],
    craAfter: (c) => `For a severe incident the final report comes within ${c.severeIncidentFinalReportDays} days. If Lumen ever becomes a manufacturer under the CRA (for example through a paid relay), the same reports also go to the CSIRT and ENISA's single reporting platform, on the same clock.`,
    harbor: "Good-faith research (safe harbor)",
    harborBody: "We will not take legal action against research, or ask a host to act against it, when it follows SECURITY.md, tests only your own data and installations, does not read, change or delete other people's data, does not degrade the service for others, and gives us the time above before publishing. If someone else acts against you for such research, we will say publicly that it followed this policy.",
    support: "Supported versions",
    supportCols: "| Release line | Status | Security fixes |",
    status: { current: "current", previous: "previous", unsupported: "not supported" },
    hall: "Hall of fame",
    hallNone: "No reports credited yet. Reporters are credited here and in the advisory unless they ask not to be.",
    sev: { critical: "critical", high: "high", medium: "medium", low: "low", info: "info" },
    acc: " (accepted)",
  },
  he: {
    title: "אבטחה",
    description: "מצב האבטחה של Lumen בפומבי: ביקורת חיצונית (עוד אין), מודל האיום, fuzzing, מקור הגרסאות, כל ממצא פתוח, וכרטיס ניקוד עם תווית פרטיות לכל תוסף.",
    intro: "הדף הזה נכתב מהמאגר עצמו: רשימת הממצאים (`security/findings.json`) וכרטיסי הניקוד של התוספים (`public/plugins/examples/scorecards/`). בדיקה נכשלת כשהדף לא מעודכן, כך שאי אפשר להשמיט ממנו ממצא פתוח.",
    audit: "ביקורת חיצונית",
    e2ee: (scope) => `**הסנכרון המוצפן ניסיוני.** כל עוד לא פורסמה ביקורת חיצונית, הסנכרון המוצפן (E2EE) נמצא מאחורי דגל ניסיוני שכבוי בכל ערוץ, גם בבטא, ומסך ההגדרה שלו אומר שהוא לא עבר ביקורת אבטחה חיצונית (משימה W11.S1). ההצפנה הזו לא מבוקרת, שום טקסט באפליקציה לא יתאר אותה אחרת, ובדיקה אוכפת את זה. הביקורת תכסה את ${scope}.`,
    e2eeAudited: (a) => `הסנכרון המוצפן עבר ביקורת של ${a.auditor} (${a.date}): [הדוח המלא](${a.report})${a.openFindings ? `, [הממצאים הפתוחים שלו](${a.openFindings})` : ""}.`,
    threat: "מודל האיום",
    threatBody: "מה מוגן, ממי אנחנו מתגוננים, והפערים הידועים: [מודל האיום](/he/security/threat-model/).",
    fuzz: "Fuzzing",
    fuzzBody: "המפענחים עוברים fuzzing ‏(`npm run fuzz`, מיליון קלטים לכל מפענח); איך ומה מכוסה: [שרשרת האספקה](/he/security/supply-chain/). התוצאות לכל גרסה עוד לא מתפרסמות בדף הזה.",
    fuzzRunsBody: "המפענחים עוברים fuzzing ‏(`npm run fuzz`, מיליון קלטים לכל מפענח); איך ומה מכוסה: [שרשרת האספקה](/he/security/supply-chain/). ההרצות שפורסמו, מתוך `security/fuzz-results.json` (הרצה עוברת עם 0 קריסות, 0 תקיעות ושום קלט מעל מגבלת האיטיות):",
    fuzzCols: "| תאריך | commit | מפענח | קלטים | seed | שעון | קריסות | תקיעות | מעל מגבלת האיטיות | האיטי ביותר |",
    fuzzNote: "רק למפענחים שמופיעים כאן יש הרצה שפורסמה; האחרים עוברים fuzzing ב-`npm run fuzz`, אבל התוצאות שלהם עוד לא בדף הזה.",
    slsa: "מקור הגרסאות (SLSA)",
    slsaBody: "הגרסאות נבנות כך שיישאו חתימות ו-SLSA provenance ‏(`npm run release:sign`, ‏`npm run release:verify`, משימה W7.22); ראו [שרשרת האספקה](/he/security/supply-chain/). עוד לא פורסמה גרסה חתומה: הראשונה היא 0.2.0-beta.1 (שער ההשקה M0).",
    open: "ממצאים פתוחים",
    openIntro: "כל ממצא שעדיין פתוח או שהתקבל, עם החומרה שלו. ממצא יוצא מהרשימה רק כשהוא תוקן, עם השינוי שתיקן אותו.",
    none: "אין ממצאים פתוחים.",
    cols: "| מזהה | חומרה | תחום | ממצא | מאז |",
    plugins: "כרטיסי ניקוד של תוספים",
    pluginsIntro: "כל גרסה של כל תוסף ברשימה עוברת סקירה אוטומטית לפני שהיא מוצגת (משימה W11.S14): ניתוח סטטי (eval, ‏Function, הסתרת קוד, חבילה מוקטנת בלבד, יעדי רשת לא מוצהרים), ההרשאות שלה מול הגרסה הקודמת, גיליון הסגנון שלה (בלי `@import`, ‏`url()`, ‏`image-set()` או `src()` מרוחקים, גם בצורה מוסתרת ב-escapes, ובלי `var()`, ‏`env()` או `attr()` בתוך הפונקציות האלה, כי הסקירה לא רואה את הערך שהן מכניסות שם), מקור ציבורי ורישיון קוד פתוח, והחבילות שב-lockfile שלה מול רשימת הגרסאות הפגועות (`security/known-bad.json`; חומרה גבוהה או קריטית מכשילה אותה). גרסה שנכשלת לא מוצגת; גרסה מוצגת שהסקירה שלה נכשלה יורדת תוך 24 שעות. תווית הפרטיות נגזרת מההרשאות שהמניפסט מצהיר עליהן.",
    pcols: "| תוסף | גרסה | ציון | ניקוד | תווית פרטיות |",
    transparency: "דוח שקיפות",
    transparencyBody: "כל חצי שנה, בקשות למידע של משתמשים שהממסר ושרת השיתוף קיבלו, ענו עליהן ודחו: [דוח שקיפות](/he/security/transparency/). תוויות הפרטיות לחנויות נבנות מפנקס הפרטיות, ובדיקה נכשלת כשחסר בהן מסלול (`store/privacy-labels.json`).",
    report: "דיווח על חולשה",
    reportBody: "באופן פרטי, כמו ש-[SECURITY.md](https://github.com/talstilkol/lumen-md/blob/main/SECURITY.md) מסביר.",
    securityTxt: "אותו ערוץ קשר נמצא גם ב-[`/.well-known/security.txt`](https://lumen-md.vercel.app/.well-known/security.txt) ‏(RFC 9116); בדיקה נכשלת כשתוקף הקובץ פג.",
    cra: "לוחות זמנים לגילוי (חוק החוסן הקיברנטי של האיחוד האירופי, CRA)",
    craBody: (c) => `חובות הדיווח של ה-CRA ‏(${c.article}) חלות מ-${c.appliesFrom}. פרויקט חינמי שלא מרוויח כסף כנראה פטור מהן, אבל Lumen שומר על אותם זמנים לחולשה שמנוצלת בפועל:`,
    craCols: "| מתי | מה Lumen מפרסם |",
    craRows: (c) => [
      `| עד ${c.earlyWarningHours} שעות מרגע שנודע שהיא מנוצלת | התרעה מוקדמת: מה מושפע ומה לעשות בינתיים, בלי פרטי ניצול. |`,
      `| עד ${c.notificationHours} שעות | הודעה: הגרסאות המושפעות, החומרה (CVSS 3.1) ודרכי ההתגוננות. |`,
      `| עד ${c.finalReportDays} יום אחרי שיש תיקון או דרך התגוננות | דוח סופי: ה-advisory של GitHub ‏(GHSA) עם התיאור, החומרה, ההשפעה, שורש הבעיה והתיקון, ו-CVE שמתבקש דרכו. |`,
    ],
    craAfter: (c) => `באירוע חמור הדוח הסופי יוצא תוך ${c.severeIncidentFinalReportDays} יום. אם Lumen יהפוך אי פעם ל"יצרן" לפי ה-CRA (למשל דרך ממסר בתשלום), אותם דוחות יישלחו גם ל-CSIRT ולפלטפורמת הדיווח של ENISA, באותם זמנים.`,
    harbor: "מחקר בתום לב (safe harbor)",
    harborBody: "לא ננקוט צעדים משפטיים נגד מחקר, ולא נבקש מספק אחסון לפעול נגדו, כשהוא פועל לפי SECURITY.md, בודק רק על הנתונים וההתקנות שלכם, לא קורא, משנה או מוחק נתונים של אחרים, לא פוגע בשירות לאחרים, ונותן לנו את הזמן שלמעלה לפני פרסום. אם מישהו אחר יפעל נגדכם בגלל מחקר כזה, נאמר בפומבי שהוא פעל לפי המדיניות הזו.",
    support: "גרסאות נתמכות",
    supportCols: "| קו גרסאות | מצב | תיקוני אבטחה |",
    status: { current: "נוכחי", previous: "קודם", unsupported: "לא נתמך" },
    hall: "היכל התהילה",
    hallNone: "עוד אין דיווחים עם קרדיט. מדווחים מקבלים קרדיט כאן וב-advisory, אלא אם ביקשו שלא.",
    sev: { critical: "קריטית", high: "גבוהה", medium: "בינונית", low: "נמוכה", info: "מידע" },
    acc: " (התקבל)",
  },
};

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The page in one language. `cards` are scorecards (W11.S14). */
/**
 * The published fuzz runs (W11.S12): one row per run of security/fuzz-results.json.
 * @param {{ runs: Array<{ date: string, commit: string, target: string, inputs: number, seed: number, clock: string, crashes: number, hangs: number, slow: number, slowMs: number, maxMs: number }> } | null} fuzz
 */
export function fuzzRows(fuzz, lang) {
  const n = (x) => x.toLocaleString(lang === "he" ? "he-IL" : "en-US");
  return (fuzz?.runs ?? []).map((r) => `| ${r.date} | \`${r.commit}\` | ${r.target} | ${n(r.inputs)} | ${r.seed} | ${r.clock === "cpu" ? "CPU" : r.clock} | ${r.crashes} | ${r.hangs} | ${r.slow} (> ${r.slowMs} ms) | ${Math.round(r.maxMs)} ms |`);
}

/** Problems with the fuzz results register: a run without its numbers, or one that did not pass and is not a finding. */
export function fuzzResultsProblems(fuzz) {
  if (fuzz === null) return [];
  const out = [];
  if (!Array.isArray(fuzz?.runs) || !fuzz.runs.length) return ["security/fuzz-results.json: runs must be a non-empty list"];
  for (const [i, r] of fuzz.runs.entries()) {
    const at = `security/fuzz-results.json runs[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) out.push(`${at}: date must be YYYY-MM-DD`);
    if (!/^[0-9a-f]{10,40}$/.test(r.commit ?? "")) out.push(`${at}: commit must be a sha`);
    for (const k of ["inputs", "seed", "crashes", "hangs", "slow", "slowMs", "maxMs"]) if (typeof r[k] !== "number" || r[k] < 0) out.push(`${at}: ${k} must be a number`);
    if (typeof r.target !== "string" || !r.target) out.push(`${at}: target missing`);
    if ((r.crashes || r.hangs || r.slow) && !r.finding) out.push(`${at}: a run with crashes, hangs or slow inputs names its finding (LUM-…)`);
  }
  return out;
}

export function renderSecurityPage(findings, cards, lang, cryptoAudit = null, disclosure = null, fuzz = null) {
  const t = T[lang];
  const open = findings.findings.filter((f) => f.status !== "fixed").sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.id < b.id ? -1 : 1));
  const listed = [...cards].filter((c) => c.passed).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : 1));
  return [
    "---",
    `title: ${t.title}`,
    `description: ${t.description}`,
    // W13.D1 (#1247): the page's Diátaxis type.
    "type: reference",
    "---",
    "",
    "<!-- Written by scripts/security-page.mjs from security/findings.json and the plugin scorecards. Do not edit by hand. -->",
    "",
    t.intro,
    "",
    `## ${t.audit}`,
    "",
    findings.audit[lang],
    ...(findings.audit.external && findings.audit.report ? ["", `[${findings.audit.report}](${findings.audit.report})`] : []),
    ...(cryptoAudit ? ["", cryptoAudit.external ? t.e2eeAudited(cryptoAudit.external) : t.e2ee((cryptoAudit.scope ?? []).map((s) => `\`${s}\``).join(", "))] : []),
    "",
    `## ${t.threat}`,
    "",
    t.threatBody,
    "",
    `## ${t.fuzz}`,
    "",
    ...(fuzz?.runs?.length ? [t.fuzzRunsBody, "", t.fuzzCols, `|${" --- |".repeat(10)}`, ...fuzzRows(fuzz, lang), "", t.fuzzNote] : [t.fuzzBody]),
    "",
    `## ${t.slsa}`,
    "",
    t.slsaBody,
    "",
    `## ${t.open}`,
    "",
    t.openIntro,
    "",
    ...(open.length ? [t.cols, "|---|---|---|---|---|", ...open.map((f) => `| ${f.id} | ${t.sev[f.severity]}${f.status === "accepted" ? t.acc : ""} | ${cell(f.area)} | ${cell(f[lang])} | ${f.opened} |`)] : [t.none]),
    "",
    `## ${t.plugins}`,
    "",
    t.pluginsIntro,
    "",
    t.pcols,
    "|---|---|---|---|---|",
    ...listed.map((c) => `| \`${c.id}\` | ${c.version} | ${c.grade} | ${c.score} | ${cell(privacyLabel(c.permissions.declared, lang).join("; "))} |`),
    "",
    `## ${t.transparency}`,
    "",
    t.transparencyBody,
    "",
    `## ${t.report}`,
    "",
    t.reportBody,
    "",
    ...(disclosure ? disclosureSection(t, disclosure, lang) : []),
  ].join("\n");
}

/** W13.X2: the disclosure part of the page, from security/disclosure.json. */
function disclosureSection(t, d, lang) {
  const c = d.cra;
  return [
    t.securityTxt,
    "",
    `### ${t.cra}`,
    "",
    t.craBody(c),
    "",
    t.craCols,
    "|---|---|",
    ...t.craRows(c),
    "",
    t.craAfter(c),
    "",
    `### ${t.harbor}`,
    "",
    t.harborBody,
    "",
    `### ${t.support}`,
    "",
    ...(d.supportPeriod ? [d.supportPeriod[lang], ""] : []),
    t.supportCols,
    "|---|---|---|",
    ...d.support.map((s) => `| ${cell(s.line)} | ${t.status[s.status]} | ${cell(s[lang])} |`),
    "",
    `### ${t.hall}`,
    "",
    ...(d.hallOfFame.length ? d.hallOfFame.map((h) => `- ${h.url ? `[${cell(h.name)}](${h.url})` : cell(h.name)} — ${cell(h.advisory)} (${h.date})`) : [t.hallNone]),
    "",
  ];
}

/**
 * D1 §4: security.txt is renewed before it lapses. `expires` is its Expires
 * value; renewBy must be at least 30 days before it, and the check fails
 * from renewBy on, a month before the file itself would expire.
 */
export function renewalProblems(d, expires, now = Date.now()) {
  const rb = Date.parse(`${d?.securityTxt?.renewBy ?? ""}T00:00:00Z`);
  const ex = Date.parse(String(expires ?? ""));
  if (!Number.isFinite(rb) || !Number.isFinite(ex)) return ["securityTxt.renewBy and security.txt's Expires must both be dates"];
  const out = [];
  if (ex - rb < 30 * 86_400_000) out.push(`securityTxt.renewBy ${d.securityTxt.renewBy} is less than 30 days before Expires ${expires}`);
  if (+now >= rb) out.push(`security.txt is due for renewal since ${d.securityTxt.renewBy}: move Expires up to a year ahead and renewBy with it`);
  return out;
}

/** Problems with security/disclosure.json (W13.X2). */
export function disclosureProblems(d) {
  const out = [];
  const c = d?.cra ?? {};
  // The CRA's Article 14 clock; the page may promise faster, never slower.
  if (!(c.earlyWarningHours > 0 && c.earlyWarningHours <= 24)) out.push("cra.earlyWarningHours: at most 24 (CRA Art. 14(2)(a))");
  if (!(c.notificationHours > 0 && c.notificationHours <= 72)) out.push("cra.notificationHours: at most 72 (CRA Art. 14(2)(b))");
  if (!(c.finalReportDays > 0 && c.finalReportDays <= 14)) out.push("cra.finalReportDays: at most 14 (CRA Art. 14(2)(c))");
  if (!(c.severeIncidentFinalReportDays > 0 && c.severeIncidentFinalReportDays <= 30)) out.push("cra.severeIncidentFinalReportDays: at most one month (CRA Art. 14(4)(c))");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.appliesFrom ?? "")) || !String(c.article ?? "").trim()) out.push("cra: needs appliesFrom (a date) and article");
  if (!Array.isArray(d?.support) || !d.support.some((s) => s.status === "current")) out.push("support: at least one release line with status current");
  for (const s of d?.support ?? []) {
    if (!["current", "previous", "unsupported"].includes(s.status)) out.push(`support ${s.line}: status must be current, previous or unsupported`);
    if (!String(s.en ?? "").trim() || !String(s.he ?? "").trim()) out.push(`support ${s.line}: needs the period in English and Hebrew`);
  }
  // D1 §3: the product's support period (CRA Art. 13(8)-(10)): five years at least, an end date, ten years of downloads, free moves to the newest line.
  const sp = d?.supportPeriod;
  if (!sp) out.push("supportPeriod: the product's support period (CRA Art. 13(8))");
  else {
    if (!(Number.isInteger(sp.minYears) && sp.minYears >= 5)) out.push("supportPeriod.minYears: at least 5 (CRA Art. 13(8))");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sp.notBefore ?? "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(sp.decided ?? "")) || Date.parse(sp.notBefore) < Date.parse(sp.decided) + 5 * 365 * 86_400_000) out.push("supportPeriod.notBefore: a date at least five years after the decision (decided)");
    if (!(Number.isInteger(sp.updatesAvailableYears) && sp.updatesAvailableYears >= 10)) out.push("supportPeriod.updatesAvailableYears: at least 10 (CRA Art. 13(9))");
    if (sp.newestLineFree !== true) out.push("supportPeriod.newestLineFree: true — fixes only in the newest line need a free move to it (CRA Art. 13(10))");
    if (!String(sp.en ?? "").includes(String(sp.notBefore ?? "").slice(0, 4)) || !String(sp.he ?? "").includes(String(sp.notBefore ?? "").slice(0, 4))) out.push("supportPeriod: needs the period in English and Hebrew, with its end year");
  }
  // D1 §4: security.txt's Expires is renewed by renewBy, at least 30 days ahead of it.
  const rb = d?.securityTxt?.renewBy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rb ?? ""))) out.push("securityTxt.renewBy: the date to renew security.txt's Expires by (YYYY-MM-DD)");
  if (!Array.isArray(d?.hallOfFame)) out.push("hallOfFame: a list (empty until a report is credited)");
  for (const h of d?.hallOfFame ?? []) if (!String(h.name ?? "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(h.date)) || !String(h.advisory ?? "").trim()) out.push("hallOfFame: each entry needs name, date and advisory");
  return out;
}
