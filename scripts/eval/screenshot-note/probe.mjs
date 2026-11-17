/**
 * A held-out probe set for screenshot to note (plan W7.16, wave g5): 20
 * screens the layout reader (src/ai/screenshotLayout.ts) was not developed
 * on. Different words, a smaller font, lighter and thicker table rules,
 * striped rows, a dark-theme window in each language, and a light code block
 * (which the reader does not fence: it looks for dark panels — a known gap,
 * kept here on purpose). Written before the first measurement on it; the
 * numbers in the PR are that first run.
 *
 *   node scripts/eval/screenshot-note/run.mjs make <dir> --set probe
 *   node scripts/eval/screenshot-note/run.mjs measure <dir> --engine tesseract-app
 */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const HE = {
  tables: [
    { title: "תורנות ניקיון", head: ["שבוע", "חדר", "אחראי"], rows: [["1", "מטבח", "אורי"], ["2", "סלון", "טל"], ["3", "מרפסת", "ליאת"]], style: "light" },
    { title: "צריכת מים", head: ["חודש", "קוב", "עלות"], rows: [["ינואר", "14", "112"], ["פברואר", "11", "88"], ["מרץ", "16", "128"]], style: "thick" },
    { title: "רשימת קניות", head: ["פריט", "כמות", "חנות"], rows: [["חלב", "2", "סופר"], ["לחם", "1", "מאפייה"], ["תפוחים", "6", "שוק"], ["קפה", "1", "סופר"]], style: "zebra" },
    { title: "נוכחות", head: ["תלמיד", "ראשון", "שני", "שלישי"], rows: [["עדי", "כן", "כן", "לא"], ["נטע", "לא", "כן", "כן"]], style: "dark" },
  ],
  dialogs: [
    { title: "להתנתק מהחשבון?", body: "תצטרכו להתחבר שוב בפעם הבאה שתפתחו את היישום.", buttons: ["התנתק", "הישאר מחובר"] },
    { title: "הקובץ נשמר", body: "המסמך \"תוכנית עבודה\" נשמר בתיקייה מסמכים.", buttons: ["פתח תיקייה", "סגור"] },
    { title: "אין מספיק מקום", body: "נותרו 300MB פנויים. מחקו קבצים כדי להמשיך בהורדה.", buttons: ["נהל אחסון", "ביטול"] },
  ],
  code: [
    { title: "התקנה", lines: ["$ pip install requests", "ERROR: Could not find a version that satisfies the requirement"], prose: "ההתקנה נכשלה בלי חיבור לרשת." },
    { title: "דוגמה", code: ["const total = items.length;", "console.log(total);"], prose: "סופרים את הפריטים ברשימה.", light: true },
    { title: "קומפיילר", lines: ["error[E0425]: cannot find value `count` in this scope"], prose: "המשתנה לא הוגדר לפני השימוש." },
  ],
};

const EN = {
  tables: [
    { title: "Office hours", head: ["Teacher", "Day", "Room"], rows: [["Ms. Patel", "Monday", "B12"], ["Mr. Okafor", "Wednesday", "C3"], ["Dr. Lind", "Friday", "A7"]], style: "light" },
    { title: "Fuel log", head: ["Date", "Liters", "Price", "Station"], rows: [["03/02", "42.1", "7.35", "Delek"], ["17/02", "38.6", "7.29", "Paz"]], style: "thick" },
    { title: "Build matrix", head: ["OS", "Node", "Result"], rows: [["linux", "20", "pass"], ["linux", "22", "pass"], ["macos", "22", "fail"], ["windows", "22", "pass"]], style: "zebra" },
    { title: "Inventory", head: ["SKU", "Item", "Stock"], rows: [["K-17", "Keyboard", "14"], ["M-02", "Mouse", "0"], ["H-88", "Headset", "5"]], style: "dark" },
  ],
  dialogs: [
    { title: "Leave this page?", body: "Changes you made may not be saved.", buttons: ["Leave", "Stay"] },
    { title: "Allow notifications?", body: "calendar.example.org wants to show notifications.", buttons: ["Allow", "Block"] },
    { title: "Session expired", body: "For your security you were signed out after 30 minutes of inactivity.", buttons: ["Sign in again"] },
  ],
  code: [
    { title: "Build log", lines: ["Error: Cannot find module 'left-pad'", "    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)"], prose: "The dependency was removed from the lockfile." },
    { title: "Snippet", code: ["SELECT name, email", "FROM users", "WHERE active = 1;"], prose: "Active users only.", light: true },
    { title: "Shell", lines: ["$ docker compose up", "ERROR: port 5432 is already allocated"], prose: "Another database is still running." },
  ],
};

const TABLE_CSS = {
  light: "th, td { border: 1px solid #dee2e6; } th { background: #f8f9fa; }",
  thick: "th, td { border: 2px solid #868e96; } th { background: #e9ecef; }",
  zebra: "th, td { border: 1px solid #ced4da; } th { background: #dee2e6; } tr:nth-child(even) td { background: #f1f3f5; }",
  dark: "th, td { border: 1px solid #495057; } th { background: #343a40; }",
};

function tableCase(t, lang, i) {
  const html = `<h3>${esc(t.title)}</h3><table><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  const row = (r) => `| ${r.join(" | ")} |`;
  const md = [`### ${t.title}`, "", row(t.head), `|${" --- |".repeat(t.head.length)}`, ...t.rows.map(row)].join("\n");
  return { id: `${lang}-probe-table-${i + 1}`, lang, kind: "table", html, gold: md, style: t.style };
}

function dialogCase(d, lang, i) {
  const html = `<div class="dialog"><h3>${esc(d.title)}</h3><p>${esc(d.body)}</p><div class="buttons">${d.buttons.map((b) => `<button>${esc(b)}</button>`).join("")}</div></div>`;
  const md = [`### ${d.title}`, "", d.body, "", ...d.buttons.map((b) => `- ${b}`)].join("\n");
  return { id: `${lang}-probe-dialog-${i + 1}`, lang, kind: "dialog", html, gold: md };
}

function codeCase(c, lang, i) {
  const body = c.code ?? c.lines;
  const html = `<h3>${esc(c.title)}</h3><p>${esc(c.prose)}</p><pre dir="ltr" class="${c.light ? "light" : ""}">${body.map(esc).join("\n")}</pre>`;
  const md = [`### ${c.title}`, "", c.prose, "", c.code ? "```" : "```text", ...body, "```"].join("\n");
  return { id: `${lang}-probe-code-${i + 1}`, lang, kind: c.code ? "code" : "error", html, gold: md };
}

export function cases() {
  const out = [];
  for (const [lang, set] of [["he", HE], ["en", EN]]) {
    set.tables.forEach((t, i) => out.push(tableCase(t, lang, i)));
    set.dialogs.forEach((d, i) => out.push(dialogCase(d, lang, i)));
    set.code.forEach((c, i) => out.push(codeCase(c, lang, i)));
  }
  return out;
}

/** The probe's page: 15 px text, its own table rules, and a dark window for the "dark" tables. */
export function page(c, fontUrl) {
  const dir = c.lang === "he" ? "rtl" : "ltr";
  const dark = c.style === "dark";
  return `<!doctype html><html lang="${c.lang}" dir="${dir}"><meta charset="utf-8"><style>
@font-face { font-family: Shot; src: url(${fontUrl}) format("woff2"); }
body { margin: 0; background: ${dark ? "#121417" : "#f1f3f5"}; font: 15px/1.5 Shot, sans-serif; color: ${dark ? "#e9ecef" : "#212529"}; }
.win { margin: 14px; background: ${dark ? "#1c1f23" : "#fff"}; border-radius: 6px; padding: 14px 20px; width: 700px; }
table { border-collapse: collapse; } th, td { padding: 5px 12px; text-align: start; }
${TABLE_CSS[c.style ?? "light"]}
pre { background: #24292e; color: #e1e4e8; padding: 10px 12px; font: 14px/1.45 "DejaVu Sans Mono", monospace; border-radius: 6px; white-space: pre; }
pre.light { background: #f6f8fa; color: #24292e; border: 1px solid #d0d7de; }
.dialog { border: 1px solid #dee2e6; border-radius: 8px; padding: 6px 18px 14px; } .buttons { display: flex; gap: 8px; }
button { font: inherit; padding: 3px 14px; border-radius: 5px; border: 1px solid #adb5bd; background: #fff; }
</style><div class="win">${c.html}</div></html>`;
}
