/**
 * W12.S6: the in-page half of the theme screens check. `PROBE` is evaluated
 * in the page (Playwright `page.evaluate(PROBE, { root, only })`); it returns
 * the boxes of the blocks under the root, keyed so the same block has the
 * same key in RTL and LTR, plus the page's horizontal overflow. The verdict
 * is src/plugins/runtime/rtlScreens.ts judgeScreen.
 *
 * Used by e2e/themes-rtl-screens.spec.ts (the running app, on the Mac) and
 * by scripts/themes/rtl-screens-specimen.mjs (an offline specimen).
 */
export const BLOCKS = [
  "h1", "h2", "h3", "p", "li", "blockquote", ".callout", ".callout-title", "table", "th", "td", "pre",
  ".cm-gutters", ".cm-content", ".cm-line", "label", "input", "select", "textarea", "[role=row]", "[role=columnheader]", "fieldset", "legend",
].join(",");

/** Evaluated in the page: ({ root, only }) => { boxes, overflowX, viewport }. `only` narrows the blocks (default: BLOCKS). */
export const PROBE = `({ root, only }) => {
  const el = document.querySelector(root);
  if (!el) return { boxes: [], overflowX: 0, viewport: document.scrollingElement.clientWidth };
  const counts = {};
  const boxes = [];
  for (const b of el.querySelectorAll(only || ${JSON.stringify(BLOCKS)})) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const tag = b.localName + (b.classList[0] ? "." + b.classList[0] : "");
    const n = (counts[tag] = (counts[tag] || 0) + 1);
    boxes.push({ key: tag + "#" + n, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height });
  }
  const s = document.scrollingElement;
  return { boxes, overflowX: Math.max(0, s.scrollWidth - s.clientWidth), viewport: s.clientWidth };
}`;

/**
 * The 8 screens (src/plugins/runtime/rtlCheck.ts RTL_SCREENS): where each is
 * on the page, and which blocks it is judged by. The content-level screens
 * (table, lists, callouts, code in Hebrew) are parts of the preview of one
 * specimen note (SPECIMEN_MD), so one render serves five screens.
 */
export const SCREENS = {
  editor: { root: ".cm-editor", only: ".cm-gutters,.cm-content,.cm-line" },
  preview: { root: ".prose-lumen", only: "h1,h2,h3,p,blockquote" },
  table: { root: ".prose-lumen", only: "table,th,td" },
  lists: { root: ".prose-lumen", only: "ul,ol,li" },
  callouts: { root: ".prose-lumen", only: ".callout,.callout-title" },
  "code-in-hebrew": { root: ".prose-lumen", only: "pre,p:has(code)" },
  bases: { root: "[data-rtl-screen=bases], .bases-view, [data-testid=base-view]", only: "[role=row],[role=columnheader],[role=cell],th,td" },
  settings: { root: "[role=dialog]", only: "h2,h3,label,input,select,fieldset,legend,[role=radio],[role=tab]" },
};

/** One note that has every content screen in it, Hebrew first. */
export const SPECIMEN_MD = `# בדיקת ערכת נושא

פסקה בעברית עם מילה באנגלית (theme) ומספר 2026, כדי לראות את הכיוון.

## רשימות

- פריט ראשון
- פריט שני
  - פריט מקונן
1. ממוספר אחד
2. ממוספר שניים

## טבלה

| שם | עיר | ציון |
| --- | --- | ---: |
| דנה | חיפה | 91 |
| יוסי | אילת | 78 |

## הערות

> [!note] הערה
> תוכן ההערה, בשתי שורות
> כדי שיהיה לה גובה.

> [!warning] אזהרה
> זהירות.

## קוד בתוך עברית

הפקודה \`npm run build\` בונה את האתר, ו-\`git status\` מראה שינויים.

\`\`\`js
const שלום = "world";
console.log(שלום);
\`\`\`
`;
