# Lumen — Master Plan: מספר 1 בעולם

> **חזון:** Lumen הוא העורך היחיד שמאחד כתיבה, קוד, דאטה, ויזואליזציה ו-AI
> בממשק אחד — local-first, privacy-first, ועובד בכל מקום.

---

## עדכון סטטוס — 2026-05-29 (ביקורת יושרה + ביצוע)

ביקורת מקיפה מול הקוד חשפה שסימוני הסטטוס בתוכנית היו לא מדויקים בשני הכיוונים.
התיקונים הבאים בוצעו בפועל ואומתו בבדיקות:

- **ייבוא:** ספריית הממירים (`fileFormats.ts`) הייתה **קוד מת** — לא חוברה לכפתור הייבוא.
  עכשיו מחוברת דרך `importFile` (גם דיאלוג וגם גרירה). LaTeX/RST/AsciiDoc/Org/OPML/MHTML/EML עובדים.
- **DOCX/ODT/EPUB ייבוא:** הוחלף regex-על-בייטים בקורא ZIP אמיתי (`zip.ts`, מבוסס `DecompressionStream`, אפס תלות).
  DOCX מפענח כותרות/bold/italic/רשימות/טבלאות; EPUB עוקב אחר spine ב-OPF.
- **DOCX ייצוא:** הוחלף "MHTML בתחפושת .doc" ב-**OOXML אמיתי** (zip writer מקורי).
- **Python live (Pyodide)** ו-**SQL live (sql.js)** — נוספו בלוקים אמיתיים (WASM, lazy-load ב-Run).
- **Collab:** הוסר facade של CRDT שנכתב בכל הקלדה אך מעולם לא נשלח (קוד מת ומטעה).
- **סימונים שתוקנו:** תוסף דפדפן ❌→✅ (קיים ועובד), Android ✅→❌ (לא קיים `android/`),
  ייצוא PDF ❌→⚠️ (עובד דרך print), Yjs realtime ✅→⚠️ (mirror של טקסט מלא, לא binding ברמת תו).

---

## עדכון סטטוס — 2026-05-31 (ביקורת יושרה שנייה, מאומתת מול הקוד)

סבב ביקורת שני מול הקוד בפועל (grep קוראים, הרצת החבילה) חשף סימונים שעדיין לא מדויקים.
תוקן בפועל ואומת:
- **חבילת הטסטים הוחזרה לירוק:** 1308/1308 עוברים (היו 2+6 נכשלים — מפתחי `cmd.ai.*` חסרו ב-en/he וב-6 שפות).
- **ייצוא DOCX שוכתב ל-best-in-class:** רשימות אמיתיות (`numbering.xml`+`w:numPr`, ממוספר/תבליט/מקונן), היפר-קישורים אמיתיים, קו אופקי, יישור טבלאות, `styles.xml`. 15 אסרציות מבניות.

**סימונים שעדיין מטעים (לתיקון — ראו רשימת המשימות):**
- **DOC ייבוא** ⚠️→🟥: לא מחלץ טקסט — פולט ג'יבריש בינארי. צריך מחלץ CFB אמיתי או הודעת-שגיאה כנה.
- **MHTML ייצוא** ✅→❌ **הוסר**: `markdownToMhtml` היה **קוד מת** (אין קורא) → הוסר ב-2026-05-31. ייבוא MHTML עדיין נתמך ונבדק.
- **AI "צ'ארט מנתונים" (ECharts)** ✅ **תוקן 2026-05-31**: ה-prompt `visualization` חובר לפקודה אמיתית "AI: Chart from Data" (`agents.generateChart` → בלוק ```chart```), עם טסט.
- **Grammar / תבניות-AI רב-לשוניות** ✅ **תוקן 2026-05-31**: הורחב מ-4 ל-**12 שפות** (he/ar/ru/en/es/fr/de/pt/it/zh/ja/ko) ב-`multiLangPrompts.ts`, עם טסט; הטענה "20" תוקנה ל-12 בכל מקום. (LanguageTool תומך נייטיב בעוד שפות.)
- **Shiki "190+ שפות"**: אמיתי כיכולת, אך 6 בלבד preloaded; שפה אקזוטית נופלת בשקט ל-`text`.
- **בורר ספק AI** ✅ **תוקן 2026-05-31**: הומר ל-dropdown אמיתי (`uiSelect` ב-`PromptDialog`) עם כל 6 הספקים; הרמז המטעה תוקן ב-8 השפות; נוסף טסט render.
- **Plugin marketplace** ✅→🟥: UI + מוני-localStorage בלבד, **אין backend** publish/install/rate.
- **WebGPU LLM / Whisper מקומי**: קוד אמיתי אך WebGPU לא הוכח שטוען מודל, ו-`@xenova/transformers` **לא מותקן** (מקומי זורק).
- **PDF ייבוא** ✅ **תוקן 2026-05-31**: `pdfjs-dist` הותקן; ה-worker מתבנדל מקומית (בלי CDN), נטען-עצל; חילוץ טקסט אומת בטסט עם PDF אמיתי + נפילה כנה לסרוקים. (OCR לסרוקים עדיין לא — תועד בהודעה.)
- **Collab clobber** ✅ **תוקן 2026-05-31**: הוחלף ה-mirror של מסמך-מלא ב-**binding ברמת-תו** (`y-codemirror ySync` ב-`Editor.tsx`); seed סינכרוני לחדר חדש מונע מחיקת תוכן בעת ה-bind. טסט 2-peers מוכיח התכנסות עם שני הצדדים נשמרים — אין יותר clobber. הפער התחרותי הגדול ביותר מול Notion נסגר.
- **iOS ShareExtension**: קבצים קיימים אך **לא מחוברים** ל-Xcode build (`pbxproj` ללא הפניה).
- **Python/SQL live**: אמיתי, אך תלוי הורדת runtime מ-CDN בזמן ריצה (offline=שבור); נבדק ב-smoke בלבד.

---

## 1. ניתוח תחרותי — מה נדרש כדי להיות #1

| מתחרה | חוזקה העיקרית | החולשה שלו | איפה Lumen מנצח |
|--------|---------------|------------|-----------------|
| **Obsidian** | פלאגינים, גרף ידע | סגור, לא web-native, אין collab אמיתי | AI native + collab P2P + web-first |
| **Notion** | דאטהבייס, שיתוף צוותי | איטי, לא local-first, vendor lock-in | Local-first + פרטיות + ביצועים |
| **VS Code** | קוד, extensions | לא עורך מסמכים, אין preview עשיר | Markdown-native + live blocks |
| **Typora** | WYSIWYG נקי | אין plugins, אין AI, אין collab | הכל |
| **Bear/iA Writer** | עיצוב, פשטות | iOS בלבד, אין code, אין collab | Cross-platform + power features |
| **Zettlr** | אקדמי, citations | מיושן, אין AI, UI חלש | AI + מודרני + citations (bibtex כבר קיים) |

### מה נדרש כדי לנצח:
1. **תמיכה מלאה בכל פורמט** — ייבוא/ייצוא ללא אובדן
2. **עריכת קוד ברמת IDE** — syntax לכל שפה + completion + lint
3. **פלטפורמה פתוחה** — plugins, themes, API
4. **ביצועים** — פתיחה מיידית, קבצים ענקיים, zero lag
5. **נוכחות בכל פלטפורמה** — Web, Desktop, Mobile, CLI, Extension
6. **AI שעובד** — לא גימיק, כלי יצרני אמיתי
7. **קהילה** — marketplace, templates, שיתוף

---

## 2. תמיכה בפורמטים — מפת דרכים מלאה

### 2.1 ייבוא (קריאה → Markdown)

| פורמט | סטטוס | עדיפות | הערות |
|--------|--------|--------|-------|
| Markdown (.md, .mdx) | ✅ קיים | — | כולל GFM, frontmatter, MDX |
| HTML (.html, .htm) | ✅ קיים | — | DOMParser zero-dep |
| RTF (.rtf) | ✅ קיים | — | |
| DOCX (.docx) | ✅ אמיתי | — | unzip מקורי + WordprocessingML: כותרות/bold/italic/רשימות/טבלאות |
| DOC (.doc) | ⚠️ best-effort | P2 | Legacy binary — חילוץ טקסט בלבד |
| ODT (.odt) | ✅ אמיתי | — | unzip מקורי + content.xml (כותרות/פסקאות/רשימות) |
| PDF (.pdf) | ✅ אמיתי | — | pdfjs-dist + worker מקומי (בלי CDN), lazy, חילוץ טקסט מאומת. OCR לסרוקים עדיין לא |
| EPUB (.epub) | ✅ אמיתי | — | unzip מקורי + OPF spine → המרת פרקי XHTML |
| LaTeX (.tex) | ✅ קיים | — | |
| RST (.rst) | ✅ קיים | — | |
| AsciiDoc (.adoc) | ✅ קיים | — | |
| Org-mode (.org) | ✅ קיים | — | |
| OPML (.opml) | ✅ קיים | — | |
| CSV/TSV/JSON/XML/YAML | ✅ קיים | — | |
| MHTML/EML | ✅ קיים | — | |
| **PPTX** | ✅ אמיתי | — | unzip מקורי → slide → heading + bullets (תמונות עדיין לא) |
| **XLSX** | ✅ אמיתי | — | unzip מקורי + sharedStrings → טבלת markdown לכל גיליון |
| **Numbers/Pages** | ❌ חסר | P3 | Apple iWork — ZIP of XML |
| **Google Docs/Sheets** | ❌ חסר | P2 | via Google Drive API export |
| **Notion export** | ✅ אמיתי | — | zip → מיזוג .md+.csv; ניקוי "Title <hash>" |
| **Obsidian vault** | ✅ אמיתי | — | zip → מיזוג .md; [[wikilinks]] נשמרים (Lumen תומך מקורית) |
| **Confluence** | ❌ חסר | P2 | XHTML export → markdown |
| **WordPress** | ✅ אמיתי | — | WXR (.xml) → פוסטים מפורסמים (HTML→md), דילוג על טיוטות/קבצים (מאומת); זיהוי אוטומטי ב-.xml |
| **Jupyter (.ipynb)** | ✅ אמיתי | — | cells → markdown + fenced code (שפת הקרנל) + פלטים; ANSI מנוקה מ-tracebacks (מאומת) |
| **Fountain (.fountain)** | ❌ חסר | P3 | screenwriting format |

### 2.2 ייצוא (Markdown → פורמט אחר)

| פורמט | סטטוס | עדיפות | הערות |
|--------|--------|--------|-------|
| HTML (self-contained) | ✅ קיים | — | inline styles + assets |
| DOCX | ✅ אמיתי | — | OOXML מקורי (zip writer): כותרות/bold/italic/רשימות/טבלאות. תמונות עדיין לא מוטמעות |
| RTF | ✅ קיים | — | |
| LaTeX | ✅ קיים | — | |
| RST | ✅ קיים | — | |
| AsciiDoc | ✅ קיים | — | |
| Org-mode | ✅ קיים | — | |
| OPML | ✅ קיים | — | |
| MHTML | ❌ הוסר | — | היה קוד מת; ייבוא MHTML עדיין נתמך |
| **PDF** | ⚠️ דרך print | P1 | PrintExport → window.print() ("Save as PDF"). לא generator תכנותי |
| **EPUB** | ✅ אמיתי | — | EPUB3 חוקי (zip writer); פרקים מפוצלים לפי H1; round-trip מאומת |
| **PPTX** | ❌ חסר | P2 | heading-based slide generation |
| **Markdown → Static Site** | ✅ אמיתי | — | אתר HTML רב-עמודים (zip): עמוד per H1 + ניווט צד + RSS |
| **Reveal.js slides** | ✅ אמיתי | — | מפצל על `---` ל-`<section>`; runtime מ-CDN |
| **Jupyter notebook** | ✅ אמיתי | — | md → .ipynb תקין (nbformat 4.5): fenced code → תאי-קוד, פרוזה → תאי-markdown; round-trip מאומת מול ה-importer |
| **Confluence wiki** | ❌ חסר | P3 | for enterprise users |

---

## 3. תמיכה בשפות תכנות — ברמת IDE

### 3.1 מצב נוכחי
- Shiki מספק syntax highlighting ל-**190+ שפות** (VS Code grammar)
- Code blocks מציגים syntax נכון לכל שפה מוכרת
- `live-js` block מאפשר הרצת JavaScript בזמן אמת

### 3.2 שדרוג ל-IDE-level

| יכולת | סטטוס | עדיפות | מימוש |
|--------|--------|--------|-------|
| **Syntax highlighting** | ✅ 190+ שפות | — | Shiki/TextMate grammars |
| **Live execution: JS/TS** | ✅ קיים | — | sandboxed iframe |
| **Live execution: Python** | ✅ קיים | — | בלוק `live-python` — Pyodide (WASM, lazy ב-Run) |
| **Live execution: Rust** | ❌ חסר | P2 | via Rust Playground API |
| **Live execution: Go** | ❌ חסר | P2 | via Go Playground API |
| **Live execution: SQL** | ✅ קיים | — | בלוק `live-sql` — sql.js (SQLite WASM, lazy ב-Run) |
| **Live execution: R** | ❌ חסר | P2 | webR (WASM) |
| **Live execution: Ruby** | ❌ חסר | P3 | ruby.wasm |
| **Live execution: C/C++** | ❌ חסר | P3 | via Compiler Explorer API |
| **Code completion (LSP)** | ❌ חסר | P1 | Monaco-like completion for JS/TS/Python |
| **Inline error hints** | ❌ חסר | P1 | TypeScript diagnostics in-editor |
| **AI code assist** | ✅ קיים | P1 | שדרג: multi-model, streaming, context-aware |
| **REPL mode** | ❌ חסר | P1 | persistent state across code blocks |
| **Variable inspector** | ❌ חסר | P2 | show live vars like Jupyter |
| **Package imports** | ❌ חסר | P1 | esm.sh / skypack for npm packages in browser |
| **Code formatting** | ❌ חסר | P1 | Prettier (JS/TS/CSS), Black (Python) |
| **Git diff view** | ❌ חסר | P2 | inline diff for version history |

### 3.3 שפות עם Live Preview מלא (execution + output)

**שלב 1 (WASM-native, אפס תלות בשרת):**
- JavaScript / TypeScript (✅ קיים)
- Python (Pyodide — 12MB WASM, lazy load)
- SQL (sql.js — 1MB)
- HTML/CSS/SVG (✅ קיים)
- GLSL (✅ קיים)

**שלב 2 (API-backed, דורש חיבור):**
- Rust (playground.rust-lang.org)
- Go (go.dev/play)
- C/C++ (godbolt.org)
- Java (via JDoodle API)

**שלב 3 (WASM heavy, optional download):**
- Ruby (ruby.wasm — 20MB)
- R (webR — 30MB)
- Lua (wasmoon — 200KB)
- PHP (php-wasm)

---

## 4. תמיכה ב-Web — Full Web IDE

### 4.1 Live Web Blocks (כבר קיים, לשדרג)

| Block | סטטוס | שדרוג נדרש |
|-------|--------|------------|
| `htmlpreview` | ✅ | הוסף: multi-file project, console output |
| `live-js` | ✅ | הוסף: npm imports, TypeScript, JSX |
| `live-css` | ✅ | הוסף: SCSS/LESS/Tailwind compilation |
| `live-svg` | ✅ | — |
| `live-glsl` | ✅ | — |

### 4.2 Web IDE חדש — "Lumen Playground"

```
┌─────────────────────────────────────────────────┐
│  Lumen Playground                               │
├─────────┬──────────────────────┬────────────────┤
│ Files   │  Editor (CodeMirror) │  Preview       │
│         │                      │  (iframe)      │
│ index.html                     │                │
│ style.css                      │                │
│ app.js   │                     │                │
│ data.json│                     │                │
├─────────┴──────────────────────┴────────────────┤
│  Console │ Network │ Elements                    │
└─────────────────────────────────────────────────┘
```

**יכולות:**
- Multi-file project בתוך code fence מיוחד
- Hot reload מיידי
- npm package imports via esm.sh
- TypeScript/JSX transpilation (esbuild WASM)
- Console output panel
- DOM inspector בסיסי
- Export as standalone HTML
- Share as URL (compressed state)

### 4.3 Framework Support

| Framework | כיצד | עדיפות |
|-----------|-------|--------|
| React/Preact | esbuild WASM + JSX | P0 |
| Vue (SFC) | @vue/compiler-sfc | P1 |
| Svelte | svelte/compiler | P1 |
| Solid | babel transform | P2 |
| Tailwind CSS | tailwindcss CDN / WASM | P0 |
| Three.js | esm.sh import | P1 |
| D3.js | esm.sh import | P1 |

---

## 5. AI — מ-Copilot ל-AI Workspace

### 5.1 מצב נוכחי
- GPT-4o streaming (inline prompts, rewrites, summaries)
- Local WebGPU LLM (on-device, privacy)
- Voice dictation (Whisper)
- Semantic search (BM25 + embeddings)
- MCP server (9 tools)

### 5.2 שדרוג

| יכולת | עדיפות | תיאור |
|--------|--------|-------|
| **Multi-model** | P0 | ✅ הושלם: OpenAI + Claude (Anthropic) + Gemini + Mistral + Ollama + WebGPU, עם בורר ספק |
| **AI Agent mode** | P0 | "כתוב לי מאמר על X" → research + draft + format |
| **Code generation** | P1 | "צור chart מהנתונים האלה" → ECharts spec |
| **Smart templates** | P1 | AI ממלא template לפי context |
| **Auto-translate** | ✅ | פקודה "AI: Translate Document" — תרגום מסמך שלם עם שימור formatting |
| **Grammar / רב-לשוני** | ✅ 12 שפות (היה 4) | LanguageTool + 12 שפות AI templates; מאומת בטסט |
| **Citation finder** | P2 | AI מוצא sources ומוסיף references |
| **Image generation** | P2 | DALL-E / Stable Diffusion inline |
| **Diagram from text** | ✅ | פקודה "AI: Diagram from Text" → בלוק Mermaid |
| **Meeting notes → action items** | ✅ | פקודה "AI: Extract Action Items" → רשימת משימות |
| **OCR + AI** | P2 | scan image → markdown with AI cleanup |

---

## 6. פלטפורמות — נוכחות בכל מקום

| פלטפורמה | סטטוס | עדיפות | טכנולוגיה |
|-----------|--------|--------|-----------|
| **Web app** | ✅ PWA | — | Vite + React |
| **macOS** | ✅ Tauri | P1 | שדרג: native menu, Spotlight integration |
| **Windows** | ✅ Tauri | P1 | שדרג: native file associations |
| **Linux** | ✅ Tauri | P2 | Snap/Flatpak packaging |
| **iOS** | 🔜 Capacitor | P1 | scaffold קיים (`ios/` + ShareExtension); חסום על Apple Developer account |
| **Android** | ❌ לא קיים | P1 | תלויות מותקנות אך `android/` לא נוצר (`cap add android` לא רץ) |
| **VS Code extension** | ❌ | P1 | Preview panel + markdown-it integration |
| **CLI** | ❌ | P2 | `lumen render doc.md --to pdf` |
| **Browser extension** | ✅ קיים | — | `extension/` — MV3 web-clipper עובד (HTML→MD + context menu) |
| **Raycast/Alfred** | ❌ | P3 | quick capture |
| **Obsidian plugin** | ❌ | P2 | migration path for Obsidian users |
| **API** | ❌ | P1 | headless conversion service |

---

## 7. ביצועים — Zero Lag

| מדד | יעד | מצב נוכחי | פעולה |
|-----|-----|-----------|-------|
| First paint | < 500ms | ~800ms | Code-split + preload critical CSS |
| Time to interactive | < 1.5s | ~2.5s | Lazy-load plugins, defer AI |
| File open (1MB) | < 100ms | ~200ms | Streaming parser, virtual scroll |
| File open (10MB) | < 500ms | untested | Virtual document (visible lines only) |
| Keystroke latency | < 16ms | ~20ms | Batch DOM updates, requestAnimationFrame |
| Memory (100 docs) | < 200MB | untested | LRU eviction, WeakRef cache |
| Bundle size (eager entry) | < 500KB raw | **מדוד 31/05: 608KB raw / ~190KB gzip** | רוב הכבד כבר lazy ✅ |
| Offline startup | < 300ms | SW precache 106 entries (2.9MB) | מדוד: ה-build מייצר SW |

> **הערת מדידה כנה (2026-05-31):** רק גודל ה-bundle ניתן-לאימות בסנדבוקס (מתוך `vite build` + `npm run budget`) — וה-bundle **כבר ממוטב**: web-llm נטען דינמית, ו-mermaid/echarts/codemirror/tldraw/milkdown/shiki-langs הם chunks **עצלים** שנטענים רק בשימוש, לא ב-startup. מספרי First-paint / TTI / keystroke / memory לעיל הם **הערכות לא-מדודות** — דורשים פרופיילינג בדפדפן (Lighthouse/Web-Vitals) שלא רץ בסנדבוקס. השיפור המשמעותי הנותר (lazy-load של העורך עצמו) מסוכן ולא-ניתן-לאימות-ריצה כאן, ולכן **לא בוצע** — לא אזייף שיפור perf שאי-אפשר להוכיח.

---

## 8. תשתית ואקוסיסטם

### 8.1 Plugin Marketplace

```
┌──────────────────────────────────┐
│  Lumen Plugin Store              │
├──────────────────────────────────┤
│ 🔍 Search plugins...             │
├──────────────────────────────────┤
│ Featured                         │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│ │ 🎨 │ │ 📊 │ │ 🗺️ │ │ 🔬 │    │
│ │Theme│ │Chart│ │ Map │ │Science│ │
│ └────┘ └────┘ └────┘ └────┘    │
├──────────────────────────────────┤
│ Categories:                      │
│ • Visualization (12)             │
│ • AI & Productivity (8)          │
│ • Academic & Research (6)        │
│ • Themes & Appearance (15)       │
│ • Data & Tables (9)              │
│ • Publishing (5)                 │
└──────────────────────────────────┘
```

### 8.2 Template Gallery
- Blog post
- Research paper (with BibTeX)
- Meeting notes
- Project README
- API documentation
- Resume/CV
- Slide deck
- Book chapter
- Recipe
- Travel journal
- Code tutorial

### 8.3 Theme Engine
- CSS custom properties (כבר קיים)
- Dark/Light/Auto (✅)
- Custom font selection (✅)
- Community themes (marketplace)
- Theme editor (visual)

---

## 9. Collaboration & Publishing

### 9.1 שיתוף פעולה (שדרוג)

| יכולת | סטטוס | עדיפות |
|--------|--------|--------|
| P2P real-time (Yjs/WebRTC) | ✅ אמיתי | — | presence + תגובות + **binding ברמת-תו** (y-codemirror `ySync`) — עריכות מקבילות מתכנסות בלי clobber (מאומת בטסט 2-peers) |
| Server-based rooms | 🔜 | P1 |
| Comments & threads | ✅ | — |
| Suggesting mode (track changes) | ❌ | P1 |
| @mentions | ❌ | P2 |
| Permissions (view/edit/admin) | ❌ | P1 |
| Team workspaces | ❌ | P1 |
| Shared templates | ❌ | P2 |

### 9.2 פרסום

| יכולת | עדיפות | תיאור |
|--------|--------|-------|
| **Publish to web** | P0 | one-click → lumen.md/username/doc |
| **Custom domain** | P1 | CNAME → user's domain |
| **Blog engine** | P1 | folder → blog with RSS |
| **Docs site** | P1 | multi-page docs with sidebar nav |
| **PDF export** | P0 | print-quality, custom templates |
| **Slide deck** | P1 | present from markdown |
| **Book/EPUB** | P2 | compile workspace → book |
| **Newsletter** | P2 | markdown → email (MJML) |

---

## 10. לוח זמנים — 4 שלבים

### Phase 1: Foundation (חודשים 1–2)
**יעד:** Build עובד, 0 bugs, הכל יציב

- [x] תקן postcss.config.js
- [x] PDF export (print-based) — PrintExport קיים ועובד
- [x] Python live execution (Pyodide) — בלוק `live-python`
- [x] SQL live execution (sql.js) — בלוק `live-sql`
- [x] חיבור ספריית הייבוא + DOCX/ODT/EPUB אמיתי + ייצוא DOCX אמיתי
- [x] PPTX/XLSX import — unzip מקורי
- [x] Obsidian vault + Notion importer — zip → מיזוג markdown
- [ ] תקן בדיקות נכשלות (אם נותרו)
- [ ] נקה קבצי plan מהשורש
- [ ] CI/CD pipeline מלא (build + test + deploy)
- [ ] VS Code extension (basic preview)
- [ ] Performance: < 1.5s TTI

### Phase 2: Power (חודשים 3–4)
**יעד:** Full code IDE + web playground + multi-model AI

- [ ] Web Playground (multi-file, npm imports, JSX)
- [ ] React/Vue/Svelte live preview
- [ ] Multi-model AI (Claude + GPT + Gemini + local)
- [ ] AI Agent mode (research + write)
- [ ] Code completion (JS/TS/Python)
- [ ] REPL mode (persistent state across blocks)
- [ ] Suggesting mode (track changes)
- [ ] Team workspaces
- [ ] EPUB export
- [ ] Slide deck mode (Reveal.js)
- [ ] Performance: < 500ms first paint

### Phase 3: Platform (חודשים 5–6)
**יעד:** Marketplace + publishing + mobile

- [ ] Plugin marketplace (publish, install, rate)
- [ ] Theme marketplace
- [ ] Publish to web (lumen.md/user/doc)
- [ ] Blog/docs engine
- [ ] iOS app (App Store)
- [ ] Android app (Play Store)
- [ ] CLI tool (`lumen convert`, `lumen publish`)
- [ ] Browser extension (web clipper)
- [ ] API service (headless rendering)
- [ ] Notion/Confluence importer

### Phase 4: Dominance (חודשים 7–12)
**יעד:** קהילה, enterprise, שוק

- [ ] Enterprise SSO/SCIM
- [ ] Self-hosted option (Docker)
- [ ] White-label API
- [ ] Community plugins (100+)
- [ ] Community themes (50+)
- [ ] Community templates (200+)
- [ ] Education edition (free for students)
- [ ] AI training on user's style (fine-tune)
- [ ] Real-time translation (40 languages)
- [ ] Certification program for plugin devs
- [ ] Conference / community event

---

## 11. מדדי הצלחה — KPIs

| מדד | יעד 6 חודשים | יעד שנה |
|-----|-------------|---------|
| GitHub stars | 5,000 | 25,000 |
| Weekly active users | 10,000 | 100,000 |
| Plugins in marketplace | 30 | 150 |
| Templates | 50 | 300 |
| Languages with live exec | 8 | 15 |
| Import formats | 35 | 50 |
| Export formats | 15 | 25 |
| Paying customers | 500 | 5,000 |
| Community contributors | 50 | 200 |
| Platform rating (avg) | 4.7/5 | 4.8/5 |

---

## 12. מודל עסקי

| Tier | מחיר | כולל |
|------|-------|------|
| **Free** | $0 | Local-first editor, all formats, 3 live languages, basic AI (local) |
| **Pro** | $8/mo | All live languages, cloud AI (multi-model), publishing, cloud sync |
| **Team** | $15/user/mo | Pro + collab rooms, permissions, shared workspaces, admin |
| **Enterprise** | Custom | Team + SSO, audit log, self-hosted, SLA, white-label |

### Revenue targets
- Month 6: $4,000 MRR (500 Pro users)
- Month 12: $50,000 MRR (5,000 Pro + 200 Team)
- Month 24: $200,000 MRR (enterprise growth)

---

## 13. מה הופך אותנו למספר 1 — USP

> **"The only editor where your markdown is alive."**

1. **כל פורמט** — import/export anything, zero lock-in
2. **קוד חי** — run 15+ languages inline, see results instantly
3. **AI שעובד** — not a gimmick, a real productivity multiplier
4. **פרטיות** — local-first, E2E encryption, your data stays yours
5. **פתוח** — MIT core, plugin API, theme engine, no walled garden
6. **מהיר** — < 500ms to first paint, handles 10MB files
7. **יפה** — design-first, not developer-only
8. **בכל מקום** — web, desktop, mobile, CLI, VS Code, API

---

## 14. הפעולה הבאה — מה עושים עכשיו

### מיידי (היום):
1. ✅ תקן postcss.config.js (בוצע)
2. תקן 11 בדיקות נכשלות
3. הוסף i18n keys חסרים
4. נקה קבצי plan ישנים

### השבוע:
5. CI/CD pipeline מלא
6. PDF export
7. Python Pyodide integration
8. Obsidian vault import

### החודש:
9. Web Playground MVP
10. Multi-model AI
11. VS Code extension
12. Performance optimization sprint
