/**
 * Plan W6.44: what "10" means in each of the 19 areas, as code.
 *
 * Source: plan/research-2026-11-12-evening.md, part (e) ("מה זה 10 בכל
 * תחום"). Each bar is a list of metrics; each metric names the receipt that
 * can prove it (`from`) and the target. scripts/plan/areas.mjs computes the
 * score from signed receipts only: a metric with no receipt is "not
 * measured" and earns nothing.
 *
 * `from`, one of:
 *   { metric: "<id>" }            a sealed receipt's `metrics["<id>"]` (number or boolean)
 *   { suite: "<prefix>" }         a factory `full` receipt (W6.5): every suite whose name
 *                                 starts with the prefix ran and is ok → true, else false
 *   { owner: "<step>", check }    an owner-session receipt (W6.20): that check passed → true
 *   { real: "<type>" }            a `real` / `safari` receipt (W6.6, W6.7) of that type,
 *                                 every check or platform ok → true
 * `target`: { op: ">=" | "<=", value } for numbers, or { op: "true" } for booleans.
 * `unit` is for display only.
 */

const m = (id, en, he, op, value, unit, from = { metric: id }) => ({ id, en, he, target: op === "true" ? { op } : { op, value }, unit, from });
const yes = (id, en, he, from) => m(id, en, he, "true", undefined, "", from);

/** @type {Record<number, ReturnType<typeof m>[]>} */
export const BARS = {
  1: [
    m("editor.commonmark", "CommonMark 0.31.2 spec examples passing, 3 browsers", "דוגמאות CommonMark 0.31.2 עוברות, 3 דפדפנים", ">=", 0.995, "ratio"),
    m("editor.gfm", "GFM spec examples passing, 3 browsers", "דוגמאות GFM עוברות, 3 דפדפנים", ">=", 0.99, "ratio"),
    m("editor.paste-corpus", "Paste from the real corpus (W6.38) faithful", "הדבקה מהקורפוס האמיתי (W6.38) נאמנה", ">=", 0.98, "ratio"),
    m("editor.roundtrip-real", "Real notes round-tripped byte-identical", "פתקים אמיתיים זהים בבייט אחרי round-trip", ">=", 333, "notes"),
    yes("editor.obsidian-checked", "Obsidian syntax checked in Obsidian itself (W6.34)", "תחביר Obsidian נבדק ב-Obsidian עצמו (W6.34)", { real: "obsidian" }),
  ],
  2: [
    m("rtl.matrix", "RTL matrix: 30 rows × 2 editors × 3 browsers × 2 real phones", "מטריצת RTL: ‏30 שורות × 2 עורכים × 3 דפדפנים × 2 טלפונים אמיתיים", ">=", 1, "ratio"),
    yes("rtl.docx-word", "DOCX correct in real Word", "‏DOCX נכון ב-Word אמיתי", { owner: "devices/manual-checks", check: "word-rtl" }),
    yes("rtl.safari", "Hebrew layout in real Safari (macOS and iOS)", "פריסה עברית ב-Safari אמיתי (macOS ו-iOS)", { real: "safari" }),
    m("rtl.speaker-issues", "Issues reported by the native-speaker panel", "בעיות שפאנל הדוברים מצא", "<=", 0, "issues"),
    m("rtl.arabic-matrix", "The same matrix in Arabic", "אותה מטריצה בערבית", ">=", 1, "ratio"),
  ],
  3: [
    yes("vault.drill", "Data-safety drill: 0 corrupt in every path, on the factory", "תרגיל בטיחות נתונים: ‏0 פגומים בכל נתיב, במפעל", { suite: "drill" }),
    m("vault.drill-webkit-phones", "Drill corrupt notes in WebKit and on real phones", "פתקים פגומים בתרגיל ב-WebKit ובטלפונים אמיתיים", "<=", 0, "notes"),
    m("vault.sigkill-corrupt", "Corrupt notes after 1,000 SIGKILLs on 3 systems", "פתקים פגומים אחרי 1,000 SIGKILL ב-3 מערכות", "<=", 0, "notes"),
    yes("vault.combined", "Combined scenario (edit + sync + pull + crash) passes", "התרחיש המשולב (עריכה + סנכרון + pull + קריסה) עובר"),
    yes("vault.restore-drill", "Monthly backup-restore drill passed", "תרגיל שחזור גיבוי חודשי עבר"),
  ],
  4: [
    m("sync.findings", "Open critical/high findings (independent + external review)", "ממצאים קריטיים/גבוהים פתוחים (ביקורת עצמאית וחיצונית)", "<=", 0, "findings"),
    m("sync.cas-providers", "Providers whose CAS was tested for real (WebDAV, S3, Drive)", "ספקים ש-CAS נבדק מולם באמת (WebDAV, ‏S3, ‏Drive)", ">=", 3, "providers"),
    m("sync.two-devices-days", "Days on two real devices without loss", "ימים על שני מכשירים אמיתיים בלי אובדן", ">=", 30, "days"),
    m("sync.10k-seconds", "10,000 notes + 1 GB first sync", "סנכרון ראשון של 10,000 פתקים + ‏1 GB", "<=", 600, "s"),
  ],
  5: [
    m("search.ndcg10-he", "Held-out Hebrew nDCG@10 with morphology", "‏nDCG@10 מוחזק בעברית עם מורפולוגיה", ">=", 0.85, "nDCG"),
    yes("search.crosslingual-heldout", "Cross-lingual held-out set (Belebele) passes its target", "סט חוצה-שפות מוחזק (Belebele) עומד ביעד"),
    m("search.p95-100k-ms", "Search p95 in 100,000 notes", "‏p95 של חיפוש ב-100,000 פתקים", "<=", 100, "ms"),
  ],
  6: [
    m("db.base-identical", "Obsidian .base views identical to Obsidian", "תצוגות ‎.base זהות ל-Obsidian", ">=", 44, "views"),
    m("db.notion-scenarios", "Notion scenarios passing", "תרחישי Notion עוברים", ">=", 18, "of 20"),
    yes("db.local-api", "Local API with consent works end to end", "‏API מקומי עם אישור עובד מקצה לקצה"),
  ],
  7: [
    yes("capture.share-sheet", "Share sheet on real devices", "‏share sheet במכשירים אמיתיים", { owner: "devices/manual-checks", check: "share-sheet" }),
    m("capture.record-start-ms", "Press → recording", "מלחיצה להקלטה", "<=", 1000, "ms"),
    m("capture.whatsapp-real", "Real WhatsApp exports imported correctly", "ייצואי WhatsApp אמיתיים מיובאים נכון", ">=", 0.95, "ratio"),
    m("capture.clipper-sites", "Clipper correct on real sites", "‏clipper נכון באתרים אמיתיים", ">=", 50, "sites"),
  ],
  8: [
    yes("pdf.w3c-annotations", "W3C annotations", "הערות W3C"),
    m("pdf.ocr-cer", "Scanned Hebrew OCR CER", "‏CER של OCR עברי סרוק", "<=", 0.03, "CER"),
    m("pdf.highlight-scanned", "Highlights work on scanned PDFs", "הדגשה עובדת ב-PDF סרוקים", ">=", 18, "of 20"),
    yes("pdf.zotero-roundtrip", "Annotations round-trip to Zotero", "הערות חוזרות ל-Zotero"),
  ],
  9: [
    m("canvas.fps-5000", "Frames per second with 5,000 shapes", "פריימים בשנייה עם 5,000 צורות", ">=", 55, "fps"),
    m("canvas.collab-p95-ms", "Live co-editing p95", "‏p95 של עריכה משותפת חיה", "<=", 150, "ms"),
    yes("canvas.export-hebrew", "Hebrew export correct", "ייצוא עברי נכון"),
  ],
  10: [
    m("ai.heldout-task", "Held-out task success, local 7B model", "הצלחת משימה מוחזקת, מודל 7B מקומי", ">=", 0.9, "ratio"),
    m("ai.tool-calls-real", "Valid tool calls against a real model", "קריאות כלים תקינות מול מודל אמיתי", ">=", 0.95, "ratio"),
    m("ai.cloud-without-consent", "Cloud requests without consent", "בקשות ענן בלי הסכמה", "<=", 0, "requests"),
  ],
  11: [
    m("speech.wer-desktop", "Held-out Hebrew WER, desktop", "‏WER עברי מוחזק, שולחן עבודה", "<=", 0.1, "WER"),
    m("speech.wer-browser", "Held-out Hebrew WER, browser", "‏WER עברי מוחזק, דפדפן", "<=", 0.15, "WER"),
    m("speech.niqqud", "Held-out niqqud accuracy", "דיוק ניקוד מוחזק", ">=", 0.95, "ratio"),
    m("speech.mos", "Read-aloud MOS", "‏MOS של הקראה", ">=", 4, "MOS"),
  ],
  12: [
    yes("share.server-deployed", "E2EE sharing server deployed", "שרת שיתוף E2EE פרוס", { owner: "accounts/hosts", check: "signaling" }),
    m("share.p95-il-ms", "Sharing p95 from Israel", "‏p95 של שיתוף מישראל", "<=", 150, "ms"),
    m("share.uptime-30d", "Uptime over 30 days", "זמינות ב-30 יום", ">=", 0.999, "ratio"),
    yes("share.permissions-e2e", "Permissions and comments pass in e2e", "הרשאות ותגובות עוברות ב-e2e"),
  ],
  13: [
    m("plugins.third-party", "Signed, scanned third-party plugins", "תוספים של צד שלישי, חתומים ונסרקים", ">=", 50, "plugins"),
    m("plugins.quickjs-ours", "Our plugins passing in real QuickJS", "התוספים שלנו עוברים ב-QuickJS אמיתי", ">=", 10, "of 10"),
  ],
  14: [
    m("perf.startup-kb", "Startup bundle", "חבילת ההפעלה", "<=", 250, "KB gz"),
    m("perf.fcp-mid-phone-ms", "FCP on a mid-range phone", "‏FCP בטלפון בינוני", "<=", 1000, "ms"),
    m("perf.inp-p75-ms", "INP p75", "‏INP ‏p75", "<=", 100, "ms"),
    m("perf.search-100k-ms", "Search in 100,000 notes", "חיפוש ב-100,000 פתקים", "<=", 200, "ms"),
    m("perf.budget-overruns", "Budget overruns", "חריגות תקציב", "<=", 0, "overruns"),
  ],
  15: [
    yes("a11y.acr", "Full ACR for WCAG 2.2 AA", "‏ACR מלא ל-WCAG 2.2 AA"),
    m("a11y.axe", "axe violations", "הפרות axe", "<=", 0, "violations"),
    m("a11y.sr-journeys", "Screen-reader journeys passing (VoiceOver, NVDA, TalkBack)", "מסעות בקורא מסך עוברים (VoiceOver, ‏NVDA, ‏TalkBack)", ">=", 3, "readers"),
    m("a11y.sr-users", "Screen-reader users completing ≥ 8/10 tasks", "משתמשי קורא מסך שמשלימים ≥ 8/10 משימות", ">=", 3, "users"),
    yes("a11y.statement-5568", "Accessibility statement per IS 5568", "הצהרת נגישות לפי ת״י 5568"),
  ],
  16: [
    m("apps.signed-stores", "Signed apps live in the stores", "אפליקציות חתומות בחנויות", ">=", 2, "stores"),
    m("apps.crash-free", "Crash-free sessions", "סשנים בלי קריסה", ">=", 0.995, "ratio"),
    m("apps.auto-update-os", "Systems where auto-update works", "מערכות שהעדכון האוטומטי עובד בהן", ">=", 3, "systems"),
    yes("apps.update-drill", "Update drill: install N, publish N+1, it updates", "תרגיל עדכון: מתקינים N, מפרסמים N+1, והוא מתעדכן", { owner: "devices/desktop-release", check: "update-drill" }),
  ],
  17: [
    m("ux.sus", "SUS with 12 Hebrew-speaking users", "‏SUS עם 12 משתמשים עבריים", ">=", 80, "SUS"),
    m("ux.first-note-s", "Time to the first note", "זמן עד הפתק הראשון", "<=", 4, "s"),
    m("ux.raw-errors", "Raw errors shown to users", "שגיאות גולמיות שמוצגות למשתמש", "<=", 0, "errors"),
    m("ux.empty-no-action", "Empty states without an action", "מצבים ריקים בלי פעולה", "<=", 0, "states"),
  ],
  18: [
    m("privacy.findings", "Open critical/high findings", "ממצאים קריטיים/גבוהים פתוחים", "<=", 0, "findings"),
    yes("privacy.external-audit", "External audit done", "ביקורת חיצונית בוצעה"),
    yes("privacy.reproducible", "Reproducible build verified", "בנייה משוחזרת אומתה"),
    yes("privacy.signed-report", "Signed privacy report", "דוח פרטיות חתום"),
    m("privacy.high-advisories", "High or critical advisories", "ייעוצים high ומעלה", "<=", 0, "advisories"),
    yes("privacy.private-reporting", "Private vulnerability reporting on", "דיווח פגיעויות פרטי פעיל", { owner: "accounts/github", check: "private-vulnerability-reporting" }),
    yes("privacy.secret-scanning", "Secret scanning and push protection on", "סריקת סודות ו-push protection פעילים", { owner: "accounts/github", check: "secret-scanning" }),
  ],
  19: [
    m("docs.he-parity", "Hebrew length vs English, worst page", "אורך העברית מול האנגלית, העמוד הגרוע", ">=", 0.9, "ratio"),
    yes("docs.pagefind", "Pagefind runs on a real build", "‏Pagefind רץ על בנייה אמיתית"),
    m("docs.gifs", "Feature GIFs", "‏GIF-ים של פיצ'רים", ">=", 30, "GIFs"),
    m("docs.beta-testers", "Beta testers", "בודקי בטא", ">=", 50, "people"),
    yes("docs.discussions", "Discussions active", "‏Discussions פעיל"),
    yes("docs.release-notes", "Monthly release notes", "הערות שחרור חודשיות"),
  ],
};
