/**
 * The 40 `lumen` commands that talk to the running app (plan W13.K1), in
 * 8 categories, with their help in English and Hebrew (`lumen help <cmd>`).
 *
 * There is deliberately no `eval` (Obsidian's CLI has one): a command that
 * runs arbitrary code inside the app would let any process of this user —
 * an agent with a shell included — do anything the app can, past the
 * review screen. Every command here is a fixed, typed operation; the ones
 * that change the vault produce a change set that waits for approval.
 */

export type Category = "files" | "links" | "tags" | "properties" | "search" | "tasks" | "daily" | "vault";

export interface CommandSpec {
  name: string;
  category: Category;
  /** "read": never changes anything; "write": proposes a change set; "queue": manages the review queue. */
  kind: "read" | "write" | "queue";
  /** Usage after the command name. */
  args: string;
  en: string;
  he: string;
  /** Flags the command takes (besides --json, --vault, --lang, --yes). */
  flags?: string[];
  /** Least number of positional arguments. */
  min?: number;
}

export const CATEGORIES: Record<Category, { en: string; he: string }> = {
  files: { en: "Files", he: "קבצים" },
  links: { en: "Links", he: "קישורים" },
  tags: { en: "Tags", he: "תגיות" },
  properties: { en: "Properties", he: "מאפיינים" },
  search: { en: "Search and reading", he: "חיפוש וקריאה" },
  tasks: { en: "Tasks", he: "משימות" },
  daily: { en: "Daily notes", he: "פתקים יומיים" },
  vault: { en: "Vault and review", he: "כספת ואישורים" },
};

export const SPECS: readonly CommandSpec[] = [
  // files (8)
  { name: "files", category: "files", kind: "read", args: "[--folder <dir>] [--ext md]", en: "List the vault's files.", he: "רשימת הקבצים בכספת.", flags: ["folder", "ext"] },
  { name: "folders", category: "files", kind: "read", args: "", en: "List the vault's folders.", he: "רשימת התיקיות בכספת." },
  { name: "read", category: "files", kind: "read", args: "<note>", en: "Print a note.", he: "הצגת תוכן הפתק.", min: 1 },
  { name: "create", category: "files", kind: "write", args: "<path> [text…]", en: "Create a note (fails when it exists).", he: "יצירת פתק חדש (נכשל אם הוא קיים).", min: 1 },
  { name: "insert", category: "files", kind: "write", args: "<note> <text…> [--at start|end]", en: "Add text to the end of a note, or after its properties with --at start.", he: "הוספת טקסט בסוף הפתק, או אחרי המאפיינים עם ‎--at start.", flags: ["at"], min: 2 },
  { name: "move", category: "files", kind: "write", args: "<note> <path|folder/>", en: "Move a note and update every link to it in the vault.", he: "העברת פתק ועדכון כל הקישורים אליו בכספת.", min: 2 },
  { name: "rename", category: "files", kind: "write", args: "<note> <new name>", en: "Rename a note in its folder and update every link to it.", he: "שינוי שם הפתק בתיקייה שלו ועדכון כל הקישורים אליו.", min: 2 },
  { name: "delete", category: "files", kind: "write", args: "<note>", en: "Delete a note; lists the links that will break.", he: "מחיקת פתק; מציג את הקישורים שיישברו.", min: 1 },
  // links (6)
  { name: "backlinks", category: "links", kind: "read", args: "<note>", en: "Notes that link to a note, with line numbers.", he: "פתקים שמקשרים לפתק, עם מספרי שורות.", min: 1 },
  { name: "links", category: "links", kind: "read", args: "<note>", en: "A note's outgoing links and where each one goes.", he: "הקישורים היוצאים מהפתק ולאן כל אחד מוביל.", min: 1 },
  { name: "orphans", category: "links", kind: "read", args: "", en: "Notes no other note links to.", he: "פתקים שאף פתק אחר לא מקשר אליהם." },
  { name: "unresolved", category: "links", kind: "read", args: "", en: "Links to notes that do not exist, and where they are.", he: "קישורים לפתקים שלא קיימים, והיכן הם." },
  { name: "deadends", category: "links", kind: "read", args: "", en: "Notes that link to nothing.", he: "פתקים שלא מקשרים לשום דבר." },
  { name: "embeds", category: "links", kind: "read", args: "[note]", en: "Embedded files (![[…]]), in one note or the whole vault.", he: "קבצים משובצים (‎![[…]]‎), בפתק אחד או בכל הכספת." },
  // tags (4)
  { name: "tags", category: "tags", kind: "read", args: "", en: "Every tag and how many notes have it.", he: "כל התגיות וכמה פתקים יש לכל אחת." },
  { name: "tag:notes", category: "tags", kind: "read", args: "<tag>", en: "Notes with a tag (nested tags included).", he: "פתקים עם תגית (כולל תגיות מקוננות).", min: 1 },
  { name: "tags:rename", category: "tags", kind: "write", args: "<from> <to>", en: "Rename a tag, and its nested tags, in every note.", he: "שינוי שם תגית, ושל התגיות המקוננות בה, בכל הפתקים.", min: 2 },
  { name: "tag:remove", category: "tags", kind: "write", args: "<tag> [--note <note>]", en: "Remove a tag from every note, or from one.", he: "הסרת תגית מכל הפתקים, או מפתק אחד.", flags: ["note"], min: 1 },
  // properties (5)
  { name: "properties", category: "properties", kind: "read", args: "[note]", en: "A note's properties, or every property name in the vault with a count.", he: "המאפיינים של פתק, או כל שמות המאפיינים בכספת עם ספירה." },
  { name: "property:get", category: "properties", kind: "read", args: "<note> <name>", en: "One property of a note.", he: "מאפיין אחד של פתק.", min: 2 },
  { name: "property:set", category: "properties", kind: "write", args: "<note> <name> <value…> [--list]", en: "Set a property (--list: a comma-separated list).", he: "קביעת מאפיין (‎--list: רשימה מופרדת בפסיקים).", flags: ["list"], min: 3 },
  { name: "property:remove", category: "properties", kind: "write", args: "<note> <name>", en: "Remove a property from a note.", he: "הסרת מאפיין מפתק.", min: 2 },
  { name: "property:rename", category: "properties", kind: "write", args: "<from> <to>", en: "Rename a property in every note that has it.", he: "שינוי שם מאפיין בכל הפתקים שיש להם אותו.", min: 2 },
  // search and reading (4)
  { name: "find", category: "search", kind: "read", args: "<words…> [--limit n]", en: "Search the vault (Hebrew prefixes and niqqud ignored).", he: "חיפוש בכספת (בלי תלות בניקוד ובאותיות השימוש).", flags: ["limit"], min: 1 },
  { name: "outline", category: "search", kind: "read", args: "<note>", en: "A note's headings.", he: "הכותרות של הפתק.", min: 1 },
  { name: "wordcount", category: "search", kind: "read", args: "[note]", en: "Words and characters, in a note or the whole vault.", he: "מילים ותווים, בפתק או בכל הכספת." },
  { name: "recent", category: "search", kind: "read", args: "[--limit n]", en: "Notes changed most recently.", he: "הפתקים ששונו לאחרונה.", flags: ["limit"] },
  // tasks (4)
  { name: "tasks", category: "tasks", kind: "read", args: "[note] [--open|--done]", en: "Tasks (- [ ]) in a note or the vault.", he: "משימות (‎- [ ]‎) בפתק או בכספת.", flags: ["open", "done"] },
  { name: "task:done", category: "tasks", kind: "write", args: "<note> <line>", en: "Mark the task on a line done.", he: "סימון המשימה בשורה כבוצעה.", min: 2 },
  { name: "task:undone", category: "tasks", kind: "write", args: "<note> <line>", en: "Mark the task on a line open again.", he: "החזרת המשימה בשורה למצב פתוח.", min: 2 },
  { name: "task:add", category: "tasks", kind: "write", args: "<note> <text…>", en: "Add a task to the end of a note.", he: "הוספת משימה בסוף הפתק.", min: 2 },
  // daily (3)
  { name: "daily:path", category: "daily", kind: "read", args: "[--date YYYY-MM-DD] [--folder journal]", en: "The path of a day's note.", he: "הנתיב של הפתק היומי.", flags: ["date", "folder"] },
  { name: "daily:read", category: "daily", kind: "read", args: "[--date YYYY-MM-DD] [--folder journal]", en: "Print a day's note.", he: "הצגת הפתק היומי.", flags: ["date", "folder"] },
  { name: "daily:append", category: "daily", kind: "write", args: "<text…> [--folder journal]", en: "Add a timestamped line to today's note.", he: "הוספת שורה עם שעה לפתק של היום.", flags: ["folder"], min: 1 },
  // vault and review (6)
  { name: "vault", category: "vault", kind: "read", args: "", en: "The vault: where it is, how many notes, app or disk.", he: "הכספת: איפה היא, כמה פתקים, מול האפליקציה או מול הדיסק." },
  { name: "version", category: "vault", kind: "read", args: "", en: "The version of lumen and of the protocol.", he: "הגרסה של lumen ושל הפרוטוקול." },
  { name: "help", category: "vault", kind: "read", args: "[command]", en: "Commands, or one command's help.", he: "רשימת הפקודות, או עזרה לפקודה אחת." },
  { name: "stats", category: "vault", kind: "read", args: "", en: "Notes, words, links, unresolved links, tags and tasks.", he: "פתקים, מילים, קישורים, קישורים שבורים, תגיות ומשימות." },
  { name: "changes", category: "vault", kind: "queue", args: "", en: "Changes from lumen waiting for your review.", he: "שינויים מ-lumen שמחכים לאישור שלך." },
  { name: "discard", category: "vault", kind: "queue", args: "<id>", en: "Drop a waiting change (nothing is written).", he: "ביטול שינוי שמחכה (שום דבר לא נכתב).", min: 1 },
];

export const SPEC_BY_NAME: ReadonlyMap<string, CommandSpec> = new Map(SPECS.map((s) => [s.name, s]));

/** Commands that exist elsewhere and are refused on purpose. */
export const REFUSED: Record<string, { en: string; he: string }> = {
  eval: {
    en: "lumen has no eval: running code inside the app would bypass the review screen. Use a fixed command (lumen help).",
    he: "ל-lumen אין eval: הרצת קוד בתוך האפליקציה עוקפת את מסך האישור. השתמשו בפקודה קבועה (lumen help).",
  },
};

export type Lang = "en" | "he";
export function langOf(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  const v = (flag || env.LUMEN_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || "").toLowerCase();
  return v.startsWith("he") || v.startsWith("iw") ? "he" : "en";
}

/** `lumen help` (all commands by category) or `lumen help <cmd>`. */
export function helpText(lang: Lang, cmd?: string): string[] | null {
  if (cmd) {
    const s = SPEC_BY_NAME.get(cmd);
    if (!s) return null;
    const kind = { read: { en: "reads only", he: "קריאה בלבד" }, write: { en: "proposes a change for your review", he: "מציע שינוי לאישור שלך" }, queue: { en: "the review queue", he: "תור האישורים" } }[s.kind][lang];
    return [`lumen ${s.name}${s.args ? " " + s.args : ""}`, `  ${s[lang]}`, `  ${CATEGORIES[s.category][lang]} · ${kind}`, lang === "he" ? "  ‎--json: פלט JSON. ‎--vault <dir>: כספת אחרת." : "  --json: JSON output. --vault <dir>: another vault."];
  }
  const out: string[] = [lang === "he" ? "פקודות lumen (‏lumen help <פקודה> לפרטים):" : "lumen commands (lumen help <command> for details):"];
  for (const cat of Object.keys(CATEGORIES) as Category[]) {
    out.push("", `${CATEGORIES[cat][lang]}:`);
    for (const s of SPECS.filter((x) => x.category === cat)) out.push(`  ${s.name.padEnd(16)} ${s[lang]}`);
  }
  return out;
}
