# תוכנית אב — Lumen · גרסה 3: סוכנים מקומיים + סגירת החולשות

> המסמך היחיד לתוכנית: מה בוצע, מה נשאר, מתי יסתיים ומה צריך מטל.
> עודכן 17.10.2026, 21:35 (שעון ישראל). התכנון הושלם; §15 הוא סדר הביצוע. גרסה 2 (17.10 15:45) וגרסה 1 (16–17.10) נשמרות בהיסטוריה של git.

## 0. מה השתנה בגרסה הזו

| הנחיה של טל (17.10) | מה זה אומר בתוכנית |
|---|---|
| "לא צריך דומיין — השתמש בוורסל" | האפליקציה ב-`https://lumen-md.vercel.app`, התיעוד ב-`https://lumen-md-docs.vercel.app`, השירותים בכתובות ברירת המחדל של Fly / Cloudflare. PR #109 |
| "העבר כל פקודות AI לסוכנים מקומיים שיבצעו אותן" | כל פקודת AI עוברת דרך **זמן ריצה אחד של סוכנים** שרץ על המכונה של המשתמש: Ollama, WebGPU בדפדפן (web-llm), או transformers.js. ספקי הענן נשארים רק כאפשרות שמדליקים במפורש (§2, §4) |
| "סוכנים מקומיים שיציעו שיפורים במידה ולא יהיה מענה" | **סוכן שיפור** לכל פקודה: כשאין תשובה, התשובה לא עוברת אימות, או שהמודל לא זמין — הוא מאבחן, מנסה שוב עם שינוי (עד פעמיים), ואם עדיין אין — מציג הצעות שאפשר ללחוץ עליהן (§5) |
| "צור master plan חדשה ומפורטת עם כל הכלים החדשים" | המסמך הזה. הכלים ב-§3, מפת ההעברה ב-§4, לוח הזמנים ב-§7 |
| "תן רשימה של כל החולשות… והוסף לתוכנית כלים מקומיים שיפתרו אותן… אם יש לך עוד רעיונות תוסיף, אני מאשר הכול" (17.10 20:38) | **§12** — ביקורת של 80 חולשות עם ראיות (קובץ:שורה), והפער מול Obsidian / Notion / Typora / Logseq. **§13** — 37 כלים מקומיים חדשים (T21–T58) + PR תיקונים מיידי, בשישה שלבים (F–K), ≈ 270 שעות. T22 כבר בוצע (#155) |
| "סיים לתכנן את כל תוכניות האב והכלים ל-world class, ותגיד לי מתי לעבור ל-Opus 5.5" (17.10 21:12) | **§14** — יעדים מדידים לכל תחום (מה נחשב "הטובה בעולם" ואיך זה נבדק אוטומטית). **§15** — סדר ביצוע של 37 PR-ים עם בדיקת קבלה לכל אחד, ומסירה למודל המבצע. התכנון הושלם 17.10 21:30; מכאן ביצוע |

## 1. איפה אנחנו

| מדד | ערך |
|---|---|
| PR-ים שמוזגו | #106–#108, #110–#114, #117–#134 |
| PR-ים פתוחים, ממתינים למיזוג של טל (לפי הסדר) | **#109**, **#135**, **#136** (המסמך הזה), ואז המחסנית **#137 → #150, #155** (A1…E2), ואז **#156** (F1), **#157** (F2/T25) — כל אחד על קודמו |
| תוכנית הסוכנים המקומיים (§3–§7) | **100% כתוב** (A1–E2, 15 PR-ים), כל הערות ה-review של Codex נענו ונסגרו (0 פתוחות). **CI אמיתי ב-GitHub על ראש המחסנית (#155) — ירוק (17.10 21:30)**: typecheck/test/build, e2e ב-Chromium + Firefox + WebKit, e2e מול build ייצור, bundle-size, local agents (fake Ollama). עד #155 הטריגר דילג על PR-ים מוערמים (#138–#154 לא קיבלו CI); תוקן ב-#155 |
| אומת חי על מודל אמיתי | **0%** — אין Ollama / GPU / docker בסביבה שלי. ב-CI רץ Ollama מזויף (T22) שמוכיח חיווט, לא איכות |
| תוכנית סגירת החולשות (§12–§13) | 80 חולשות נמצאו, 12 מהן 🔴 לתיקון ראשון. **בוצעו**: F1 (#156, CI ירוק ב-GitHub — E2, G1, G9 חלקית, D2, B10 חלקית) ו-T25 (#157, CI רץ) + T22. נשארו 35 כלים, ≈ 255 שעות |
| פעולות של טל (§8) | ≈ 1 שעה (מיזוג + Ollama + הרצת eval); ≈ 22 שעות לחשבונות ולפריסה (לא חוסם) |

## 2. העיקרון: AI מקומי קודם

1. **זמן ריצה אחד לכל הסוכנים** (`src/agents/runtime.ts`). המודל רק מציע; **כלים** מבצעים (קריאה וכתיבה לכספת, חיפוש, אימות Mermaid / ECharts / JSON, git diff). כל פלט עובר **מאמת** לפני שהוא נוגע במסמך.
2. **סדר המבצעים**: Ollama (אם רץ) ← WebGPU בדפדפן (web-llm) ← transformers.js (תמלול, embeddings) ← ענן רק אם **מדיניות ה-AI** מתירה. ברירת המחדל: `local-only`. אפשרויות: `local-first` (ענן כגיבוי), `cloud`.
3. **אין תשובה — יש הצעה.** כל ריצה שנכשלת עוברת לסוכן השיפור (§5). המשתמש אף פעם לא מקבל "שגיאה" ריקה: תמיד יש אבחון, ניסיון חוזר או הצעות.
4. **פרטיות.** ב-`local-only` שום טקסט מהמסמכים לא יוצא מהמכונה. ההורדות היחידות: משקלי מודלים (Hugging Face / GitHub ל-web-llm, Ollama registry ל-Ollama). **חריג מפורש אחד**: חיפוש ברשת (`research.ask`) הוא כלי רשת מעצם טבעו — SearXNG מקומי עדיין פונה למנועי חיפוש. לכן הוא דורש הסכמה מפורשת פעם אחת, שולח **רק את השאילתה** (לא את המסמך), ונרשם ביומן הפרטיות (T37). בלי הסכמה, מחקר ב-`local-only` מחפש רק בספריית הקריאה המקומית (T34). (סגירת ממצא Codex P1 ב-#136.)
5. **מה שכבר עובד נשאר.** `chat()` ו-`chatStream()` ב-`src/ai/llm.ts` נשארים נקודת הכניסה, והסוכנים נבנים מעליהם. הפקודות הקיימות ממשיכות לעבוד בזמן ההעברה.

## 3. הכלים החדשים

| # | כלי | קבצים | מה הוא עושה | תלוי ב- | שעות |
|---|---|---|---|---|---|
| T1 | **זמן ריצה לסוכנים** | `src/agents/runtime.ts`, `types.ts` | לולאת סוכן: הודעות → קריאות כלים → תצפית → סיום, עד `maxSteps`. מריץ מאמתים, מפעיל את סוכן השיפור, רושם trace | — | 6 |
| T2 | **רישום כלים** | `src/agents/tools/workspace.ts`, `editor.ts`, `validate.ts`, `git.ts`, `web.ts` | `read_file`, `write_file`, `list_files`, `search_workspace` (BM25), `get_frontmatter`, `set_frontmatter`, `list_tags`, `get_document`, `get_selection`, `replace_range`, `validate_mermaid`, `validate_echarts`, `validate_json`, `git_diff`, `search_web`, `fetch_page`. לכל כלי JSON Schema והיקף הרשאה (קריאה / כתיבה) | T1 | 5 |
| T3 | **מבצע Ollama עם כלים** | `src/agents/executors/ollama.ts` | `/api/chat` הנייטיבי של Ollama: `tools` (JSON Schema), `format` (JSON Schema, Ollama ≥ 0.5), `stream`, `message.tool_calls`, הודעות בתפקיד `tool`. מחליף את `/v1/chat/completions` לסוכנים | T1 | 4 |
| T4 | **מבצע WebGPU ב-Worker** | `src/agents/executors/webllm.ts`, `src/agents/webllm.worker.ts` | web-llm 0.2.85 דרך `CreateWebWorkerMLCEngine` (לא בתהליכון הראשי), סטרימינג, `response_format: json_object` עם סכמה, קריאת כלים: `tools` של web-llm למודלים שתומכים (Llama 3.1 / Hermes), ואחרת פרוטוקול JSON-ReAct שהרנטיים מפרש. מוסיף את ענף ה-WebGPU החסר ל-`chatStream` | T1 | 6 |
| T5 | **מבצע transformers.js** | `src/agents/executors/transformers.ts`, `src/agents/transformers.worker.ts` | `@huggingface/transformers` 3.8 ב-Worker, WebGPU כשיש: תמלול (`onnx-community/whisper-small`, רב-לשוני; `whisper-large-v3-turbo` במכונות חזקות), embeddings (`Xenova/multilingual-e5-small`, כולל עברית). מתקן את הייבוא השבור של `@xenova/transformers` ב-`transcribe.ts` | — | 5 |
| T6 | **מנהל מודלים מקומיים** | `src/ai/modelManager.ts` | זיהוי חומרה (`navigator.gpu` + מגבלות האדפטר, `deviceMemory`, `hardwareConcurrency`, רשימת Ollama), המלצה על שכבת מודל (§6), הורדה עם התקדמות, מטמון, פקודת `ai.localModels` לבחירה. מחליף את המודל הקבוע `Llama-3-8B` | T4 | 4 |
| T7 | **סוכן שיפור** | `src/agents/critic.ts` | §5. אבחון מובנה, ניסיון חוזר עם שינוי, הצעות למשתמש | T1 | 6 |
| T8 | **רישום סוכנים** | `src/agents/registry.ts`, `src/agents/defs/*.ts` | הגדרת סוכן לכל פקודה: system prompt, כלים מותרים, סכמת פלט, מאמתים, העדפת מבצע, `maxSteps`, התנהגות סוכן השיפור (§4) | T1 | 3 |
| T9 | **מדיניות AI** | `src/ai/policy.ts` | `local-only` / `local-first` / `cloud`, נשמר ב-`lumen.ai.policy`. `chat()` ו-`chatStream()` מכבדים אותה. ברירת מחדל `local-only` | — | 2 |
| T10 | **trace לריצות** | `src/agents/trace.ts`, פקודה `ai.trace` | כל ריצה: סוכן, מבצע, מודל, צעדים, קריאות כלים, טוקנים, זמן, תוצאה. 50 ריצות אחרונות ב-IndexedDB. מזין את מד השימוש | T1 | 2 |
| T11 | **לוח הגדרות AI** | `src/ui/AiSettingsPanel.tsx` | היום אין לוח: הכל דרך פקודות. הלוח: מבצע ומודל, כרטיס חומרה, הורדת מודלים, מדיניות, מצב (economy / balanced / quality), trace | T6, T9 | 5 |
| T12 | **לוח הצעות** | `src/ui/AiSuggestionsPanel.tsx` | ממשק סוכן השיפור: האבחון, מה נוסה, הצעות שאפשר ללחוץ (להריץ שוב עם מודל גדול, לפצל, להוריד מודל, להפעיל Ollama…) | T7 | 3 |
| T13 | **embeddings מקומיים** | `src/ai/semanticSearch.ts` (שכבת ספק), `src/ai/embeddings/*.ts` | ספק embeddings: Ollama (`nomic-embed-text` / `embeddinggemma`) ← transformers.js (`multilingual-e5-small`, 384 ממדים) ← OpenAI רק במדיניות ענן. האינדקס מקבל גרסה לפי מודל ומספר ממדים | T5 | 4 |
| T14 | **מחקר מקומי** | `src/agents/defs/researcher.ts`, `docker/searxng/` | סוכן מחקר בלולאת כלים (`search_web`, `fetch_page`, `extract_quotes`) על מודל מקומי. חיפוש: SearXNG מקומי (docker) או ה-worker הקיים. אימות הציטוטים הדטרמיניסטי נשאר. מסלול Claude נשאר אפשרות ענן | T2, T3 | 5 |
| T15 | **דקדוק מקומי** | `src/agents/defs/proofreader.ts`, `docker/languagetool/` | LanguageTool בהרצה עצמית (`VITE_LANGUAGETOOL_URL`), ואם אין — סוכן דקדוק על מודל מקומי שמחזיר `{issues:[{offset,length,message,replacements}]}` ומאומת מול הטקסט | T3 | 3 |
| T16 | **אצווה מקומית** | `src/ai/batch.ts` (תור מקומי) | "אצווה" = תור עבודות ב-IndexedDB שהרנטיים מריץ ברצף עם התקדמות, עצירה והמשך. אותו ממשק (`ai.batch`, `ai.batchCheck`). Batch API של Anthropic / OpenAI נשאר רק במדיניות ענן | T1 | 4 |
| T17 | **פרופילי סגנון במקום fine-tune** | `src/ai/styleProfiles.ts`, `src/ui/FineTuneSettings.tsx` (הרחבה) | מודל מקומי מחלץ כללי סגנון ודוגמאות מהמסמכים של המשתמש → פרופיל שנכנס ל-system prompt. ייצוא `Modelfile` ל-Ollama. ה-fine-tune של OpenAI נשאר אפשרות ענן עד 6.1.2027 (סוף יצירת עבודות חדשות) | T3 | 4 |
| T18 | **תמלול מקומי** | `src/ai/transcribe.ts` | Whisper רב-לשוני דרך T5, סיכום תזכיר דרך סוכן הכתיבה, וחיבור `startVoiceMemo` לממשק (היום לא נגיש) | T5 | 2 |
| T19 | **מסגרת הערכה** | `scripts/agent-eval.mjs`, `src/agents/__fixtures__/` | מקרי זהב לכל סוכן (כולל עברית): JSON תקין, Mermaid שמתקמפל, תגיות מתוך הכספת, תרגום שמשמר code blocks. רץ מול Ollama מקומית (אופציונלי, לא ב-CI הציבורי) ו-vitest עם מבצע מדומה | T8 | 4 |
| T20 | **תיעוד ו-i18n** | `docs/src/content/docs/ai/local-agents.md`, `local-llm.md`, `i18n/keys.json` + 7 שפות | מדריך התקנה (Ollama, `OLLAMA_ORIGINS`, docker), טבלת מודלים, מה עובד offline. מחרוזות חדשות ב-8 השפות | הכל | 4 |

סה״כ: **≈ 81 שעות ברוטו**; בניכוי חפיפות בין כלים ≈ **60 שעות נטו** (הערכה מרכזית; טווח 50–75).

## 4. מפת ההעברה: כל פקודת AI → סוכן מקומי

| פקודה (id) | היום | סוכן | כלים | פלט ומאמת | מבצע מועדף | סוכן השיפור כשאין תשובה |
|---|---|---|---|---|---|---|
| `tools.autoTag` | `suggestTags` → `chat` | **tagger** | `get_document`, `list_tags` | `{tags: string[]}` — עד 8, קיימות קודם, בלי כפילויות | Ollama ← WebGPU | מסמך קצר → "אין מספיק תוכן"; JSON שבור → ניסיון חוזר עם `format` |
| `tools.suggestLinks` | `suggestLinks` | **linker** | `get_document`, `search_workspace`, `list_files` | `{links:[{phrase,target,reason}]}` — הביטוי מופיע בגוף, היעד קיים | Ollama ← WebGPU | אין מועמדים → חיפוש BM25 ומסירת 10 מועמדים למודל; עדיין כלום → "אין מסמכים קשורים" |
| `ai.outline` | `generateOutline` | **outliner** | `get_document` | Markdown כותרות — לפחות 2 רמות | Ollama ← WebGPU | פלט ריק → ניסיון עם מודל גדול; מסמך ארוך → פיצול לחלקים ואיחוד |
| `ai.diagram` | `generateDiagram` | **diagrammer** | `get_selection`, `validate_mermaid` | Mermaid שמתקמפל | Ollama ← WebGPU | שגיאת קומפילציה חוזרת למודל (עד 2 סבבים); עדיין שבור → הצעה: סוג דיאגרמה פשוט יותר |
| `ai.actionItems` | `extractActionItems` | **tasker** | `get_document` | `{items:[{text,owner?,due?}]}` → Markdown checkboxes | Ollama ← WebGPU | אין פריטים → בדיקה היוריסטית ("צריך", "לבדוק", TODO) ומסירת הרמזים למודל |
| `ai.translate` | `translateMarkdown` | **translator** | `get_document` | Markdown — code blocks, קישורים ו-frontmatter זהים; שפת הפלט מזוהה (היוריסטיקת תווים לעברית / ערבית / קירילית / CJK) | Ollama ← WebGPU | שפה לא נכונה → ניסיון חוזר עם הוראה מחמירה ו-temperature 0; קטיעה → פיצול לפסקאות |
| `ai.chart` | `generateChart` | **charter** | `get_selection`, `csv_parse`, `validate_echarts` | JSON של ECharts עם `series` | Ollama ← WebGPU | JSON שבור → `format`; סדרות ריקות → הצעה: לבחור עמודות |
| `git.commit` | `generateAiCommitMessage` | **committer** | `git_diff` | `{subject,body}` — נושא ≤ 72 תווים, ציווי | Ollama ← WebGPU (מודל קל) | diff ענק → סיכום לפי קובץ קודם; כלום → הודעה דטרמיניסטית מרשימת הקבצים |
| Ghost text (Ctrl-Space), הצעה אוטומטית, "AI Rewrite", "AI Ghostwriter" | `chat` / `chatStream` | **writer** (סטרימינג) | — | טקסט | WebGPU ← Ollama (זמן תגובה) | ללא ניסיון חוזר (אינטראקטיבי); אם המבצע לא זמין → הצעה חד-פעמית להוריד מודל קטן |
| `ai.prompt.*` (33 תבניות) | `applyTemplate` + `chat` | **templater** (סטרימינג) | `get_selection` | טקסט | Ollama ← WebGPU | כמו writer |
| `ai.productAgent` | `ProductAgent` (צינור קבוע) | **builder** | `write_file`, `list_files`, `validate_json` | קבצים בכספת; `package.json` תקין | Ollama (מודל קוד) ← WebGPU | קובץ שנכשל → ניסיון חוזר לקובץ בלבד; מודל קטן → הצעה: `qwen2.5-coder` |
| `research.ask` | מסלול Claude (ענן) / proxy | **researcher** (T14) | `search_web`, `fetch_page`, `extract_quotes` | תשובה עם ציטוטים שעוברים `quoteCoverage` | Ollama ← WebGPU | אין תוצאות חיפוש → הצעה: SearXNG / worker / מפתח Brave; ציטוטים לא מאומתים → ניסיון חוזר עם "צטט מילה במילה" |
| `research.verify` | דטרמיניסטי + worker | ללא שינוי | `fetch_page` | — | — | — |
| `tools.checkGrammar`, `view.grammarCheck` | LanguageTool ציבורי | **proofreader** (T15) | `get_document` | `{issues}` — כל offset בתוך הטקסט | LanguageTool מקומי ← Ollama | אין LanguageTool → סוכן LLM; offset שגוי → סינון, לא כישלון |
| Smart search / Ask Workspace | OpenAI embeddings | **embedder** (T13) + **answerer** | `search_workspace`, `read_file` | וקטורים מקומיים; תשובה עם מקורות | Ollama embed ← transformers.js | אין embeddings → BM25 בלבד (כבר קיים) עם הודעה; תשובה בלי מקורות → ניסיון חוזר "ענה רק מהקטעים" |
| `voice.dictate` + תזכיר קולי | Whisper ענן / `whisper-tiny.en` שבור | **transcriber** (T18) | — | טקסט; שפה מזוהה | transformers.js (WebGPU) | אין WebGPU → `whisper-tiny` רב-לשוני על WASM (איטי) + הודעה; ריק → הצעה: מיקרופון / קובץ |
| `ai.batch`, `ai.batchCheck` | Batch API ענן | **batchRunner** (T16) | כל הכלים של הסוכן שבתור | אותו ממשק | הרנטיים המקומי | עבודה שנכשלת → סוכן השיפור של אותה פקודה; התור ממשיך |
| `ai.fineTune` | OpenAI fine-tune | **styleProfiles** (T17) | `read_file`, `list_files` | פרופיל סגנון JSON + `Modelfile` | Ollama ← WebGPU | מעט מסמכים → הצעה: לבחור תיקייה; פלט לא עקבי → דוגמאות בלבד בלי כללים |
| `ai.switchProvider`, `ai.ollamaModels`, `ai.localToggle`, `ai.mode`, `ai.cache`, `ai.usage`, `ai.settings` | פקודות הגדרה | נשארות, ומצטרפות אליהן `ai.localModels`, `ai.policy`, `ai.trace`, `ai.settingsPanel` | — | — | — | — |

## 5. סוכני השיפור

**מתי הם רצים:** (1) תשובה ריקה או קטועה; (2) המאמת נכשל (JSON, Mermaid, offset, שפה); (3) המבצע לא זמין (Ollama לא רץ, אין WebGPU, מודל לא הורד, CORS 403 מ-Ollama); (4) timeout; (5) המשתמש לחץ "לא טוב" על התוצאה.

**מה הם עושים, בסדר הזה:**

| שלב | פרטים | כשאין מודל בכלל |
|---|---|---|
| 1. אבחון דטרמיניסטי | כללים בלי מודל: קלט ארוך מדי → פיצול; מודל לא זמין → הצעת התקנה / הורדה; 403 מ-Ollama → `OLLAMA_ORIGINS`; אין WebGPU → דפדפן נתמך או Ollama; פלט בשפה לא נכונה → הוראת שפה; JSON שבור → `format` | עובד תמיד |
| 2. אבחון במודל | מודל מקומי קל מקבל: המשימה, הפלט (או היעדרו), שגיאות המאמת, ומחזיר JSON מובנה: `{diagnosis, retry: {model?, temperature?, promptPatch?, split?} \| null, suggestions: [{title, detail, action?}]}` | מדלג |
| 3. ניסיון חוזר | עד 2 ניסיונות, כל אחד עם שינוי אחד לפחות (מודל גדול יותר מהשכבה הבאה, temperature 0, פיצול קלט, הוראה מתוקנת). כל ניסיון נרשם ב-trace | — |
| 4. הצעות | לוח ההצעות (T12): האבחון, מה נוסה, וכפתורים: "הרץ עם מודל X", "הורד מודל", "הפעל Ollama", "פצל את המסמך", "שלח לענן" (רק אם המדיניות מתירה). ההצעות הן פעולות אמיתיות, לא טקסט | מציג את ההצעות הדטרמיניסטיות |

**דוגמאות:** `ai.diagram` החזיר Mermaid שלא מתקמפל → שגיאת הקומפיילר חוזרת למודל, ניסיון 2 מצליח, ה-trace מראה את שני הסבבים. `ai.translate` לעברית החזיר אנגלית → ניסיון חוזר עם "ענה בעברית בלבד", temperature 0; אם גם זה נכשל → הצעה: "המודל `llama3.2:3b` חלש בעברית — להוריד `gemma3:12b`?". `research.ask` בלי חיפוש זמין → הצעות: להפעיל SearXNG (פקודת docker מוכנה), להגדיר את ה-worker, או להכניס מפתח Brave.

## 6. מודלים מקומיים מומלצים

| חומרה | Ollama (כלים + JSON) | WebGPU בדפדפן (web-llm) | embeddings | תמלול |
|---|---|---|---|---|
| ללא GPU / נייד | `qwen2.5:3b`, `llama3.2:3b` | `Qwen3-0.6B`, `SmolLM2-360M`, `Llama-3.2-1B` (q4f16, ~1GB) | `multilingual-e5-small` (transformers.js) | `whisper-tiny` (WASM) |
| 8GB VRAM | `qwen2.5:7b`, `gemma3:4b`, `llama3.1:8b` | `Qwen3-4B`, `Llama-3.2-3B`, `gemma-3-1b` | `nomic-embed-text` | `whisper-small` (WebGPU) |
| 16GB VRAM | `gemma3:12b`, `qwen3:8b`, `gpt-oss:20b`, `qwen2.5-coder:7b` (קוד) | `Llama-3.1-8B`, `Qwen3.5-9B` | `embeddinggemma` | `whisper-large-v3-turbo` |
| 24GB+ | `gemma3:27b`, `qwen3-coder:30b` | כנ״ל | כנ״ל | כנ״ל |

השכבות (`tiny` / `small` / `medium` / `large`) מחליפות את "economy / balanced / quality" במבצעים המקומיים: `ai.mode` ממפה לשכבה, וסוכן השיפור עולה שכבה בניסיון חוזר.

**עברית:** אף מודל מקומי לא נבדק על ידי בעברית. Gemma 3 ו-Qwen 3 מוצהרים כרב-לשוניים; `multilingual-e5-small` ו-Whisper תומכים בעברית רשמית. מסגרת ההערכה (T19) כוללת מקרי זהב בעברית, וזו הבדיקה הראשונה שארוץ על Ollama כשיש מכונה עם מודלים (§8, פעולה 2).

## 7. שלבים, PR-ים ולוח זמנים

כל השעות לפי שעון ישראל. "~" מסמן סיום משוער. ההנחה: עבודה רציפה, וכל PR נכנס כשה-CI ירוק וסוקר הקוד נקי.

| שלב | PR | תוכן | כלים | שעות | התחלה | סיום |
|---|---|---|---|---|---|---|
| — | #135 | Gemini עדכני, `ignoreCommand` בסקריפט, בנייה כשקובץ worker שמיובא ל-src משתנה | — | 3 | 17.10 13:30 | 17.10 15:30 · ירוק, ממתין למיזוג |
| — | #136 | PR התוכנית הזו (MASTER_PLAN.md) | — | 1 | 17.10 15:00 | 17.10 21:30 (גרסה 3) |
| **A. יסודות** | A1 · #137 | זמן ריצה, טיפוסים, רישום כלים, trace, מדיניות AI | T1, T2, T8, T9, T10 | 14 | 17.10 16:00 | ~18.10 02:00 |
| | A2 · #138 | מבצע Ollama נייטיבי (tools, format, stream) + בדיקות ל-`ollamaProvider` (היום אין) | T3 | 4 | 18.10 02:00 | ~18.10 05:00 |
| | A3 · #138 | web-llm ב-Worker, סטרימינג ל-`chatStream`, JSON mode, מנהל מודלים, `ai.localModels` | T4, T6 | 10 | 18.10 05:00 | ~18.10 12:00 |
| | A4 · #139 | transformers.js ב-Worker, תיקון התמלול, Whisper רב-לשוני | T5, T18 | 7 | 18.10 12:00 | ~18.10 17:00 |
| **B. העברת פקודות** | B1 · #140 | tagger, linker, outliner, tasker, committer | T8 | 5 | 18.10 17:00 | ~18.10 21:00 |
| | B2 · #141 | diagrammer, charter, translator (עם מאמתים) | T8 | 5 | 18.10 21:00 | ~19.10 01:00 |
| | B3 · #142 | writer / templater בסטרימינג, builder (productAgent על כלים) | T8 | 6 | 19.10 01:00 | ~19.10 06:00 |
| **C. החלפת מסלולי ענן** | C1 · #143 | embeddings מקומיים + חיפוש חכם + Ask Workspace | T13 | 4 | 19.10 06:00 | ~19.10 09:00 |
| | C2 · #144 | מחקר מקומי + SearXNG | T14 | 5 | 19.10 09:00 | ~19.10 13:00 |
| | C3 · #145 | דקדוק מקומי + LanguageTool | T15 | 3 | 19.10 13:00 | ~19.10 15:30 |
| | C4 · #146 | אצווה מקומית | T16 | 4 | 19.10 15:30 | ~19.10 18:30 |
| | C5 · #147 | פרופילי סגנון | T17 | 4 | 19.10 18:30 | ~19.10 21:30 |
| **D. שיפור וממשק** | D1 · #148 | סוכן השיפור + לוח ההצעות, חיבור לכל הסוכנים | T7, T12 | 9 | 19.10 21:30 | ~20.10 05:00 |
| | D2 · #149 | לוח הגדרות AI | T11 | 5 | 20.10 05:00 | ~20.10 09:00 |
| **E. סגירה** | E1 · #150 | מסגרת הערכה (כולל עברית), בדיקות חסרות (`chatLocal`, `productAgent`) | T19 | 4 | 20.10 09:00 | ~20.10 12:00 |
| | E2 · #155 | תיעוד, i18n ב-8 שפות, ניקוי (הסרת `@xenova`, `cmd.ai.privacy.hint` שנשאר באנגלית ב-6 שפות) | T20 | 4 | 20.10 12:00 | ~20.10 15:00 |
| | סה״כ | | | **≈ 93 ברוטו / ≈ 60–75 נטו** | | **בוצע 17.10 20:40** — כל 19 ה-PR-ים פתוחים וירוקים, ממתינים למיזוג |

הערות ללוח: (0) עמודות ההתחלה/הסיום הן התכנון המקורי; בפועל כל השלבים A1–E2 נכתבו ב-17.10 בין 16:00 ל-20:40 (15 PR-ים במחסנית אחת: #137–#150, #155). (1) זמני ה-PR כוללים CI (~25 דק׳) וסבבי Codex. (2) PR-ים שלא תלויים זה בזה (A2–A4, C1–C5) יכולים לרוץ במקביל, ואז הסיום מתקדם ל-**20.10 בבוקר**. (3) מה שנדחה מהתוכנית הקודמת — ~20 מקרי קצה של Codex (12–16 שעות) — נכנס אחרי E2.

## 8. מה צריך מטל

| # | פעולה | פותח | זמן |
|---|---|---|---|
| 1 | **למזג ב-GitHub לפי הסדר**: #109, #135, #136, ואז #137, #138, … #150, #155, #156, #157 (כל PR בנוי על קודמו; אחרי כל מיזוג GitHub מעדכן את הבסיס של הבא). המיזוג נחסם אצלי על ידי בקר האבטחה | כל התוכנית | 10 דק׳ |
| 2 | **Ollama** ≥ 0.5 על המחשב (`ollama.com/download`), ואז: `ollama pull qwen2.5:7b && ollama pull nomic-embed-text` (8GB) או `gemma3:12b` (16GB). **חובה** לאפליקציה ב-Vercel: `OLLAMA_ORIGINS=https://lumen-md.vercel.app` (אחרת Ollama מחזיר 403 לדפדפן). ב-macOS: `launchctl setenv OLLAMA_ORIGINS https://lumen-md.vercel.app` והפעלה מחדש | כל סוכני Ollama, בדיקת העברית | 15 דק׳ + הורדה |
| 3 | אופציונלי: `docker compose -f docker/local-ai.yml up -d` — LanguageTool ו-SearXNG מקומיים (#144) | דקדוק ומחקר בלי שירות חיצוני | 10 דק׳ |
| 3א | **להריץ את ה-eval ולשלוח לי את הדוח**: `npm run eval:agents -- --model qwen2.5:7b` (ואם יש זיכרון: גם `gemma3:12b`, `aya-expanse:8b`). הדוח ב-`eval/results/` | ציון עברית אמיתי לכל סוכן; בחירת מודל ברירת המחדל (T27) | 20 דק׳ |
| 4 | Vercel: פרויקט שני לתיעוד (root `docs`, framework Astro) | `lumen-md-docs.vercel.app` | 10 דק׳ |
| 5 | GitHub → Settings → Security → "Private vulnerability reporting" → Enable (ה-proxy לא מרשה לי לשנות הגדרות ריפו) | SECURITY.md | 1 דק׳ |
| 6 | Fly.io: `fly deploy` ל-signaling ול-collab (DEPLOY.md) | שיתוף פעולה בזמן אמת, C7, C8, D8 | ≈ 2 ש׳ |
| 7 | Cloudflare: `wrangler deploy` ל-workers (auth, billing, research, publish, audit) ומשתני הסביבה ב-Vercel | SSO, חיוב, פרסום | ≈ 1.5 ש׳ |
| 8 | Sentry (DSN), Stripe (מוצרים ומפתחות), WorkOS (SSO) | ניטור, חיוב, SSO | ≈ 6 ש׳ |
| 9 | מפתחות ענן — **רק אם רוצים** מדיניות `local-first` / `cloud`: OpenAI, Anthropic, Gemini | גיבוי ענן | 5 דק׳ |
| 10 | Apple Developer ($99), Google Play ($25), Xcode · npm scope, Chrome Web Store, VS Code publisher | מובייל, הפצה | 12–20 ש׳ |

## 9. מה לא אומת וסיכונים

| נושא | מצב | מה עושים |
|---|---|---|
| איכות המודלים המקומיים בעברית | לא נבדק | מקרי זהב בעברית ב-T19; סוכן השיפור מציע מודל גדול יותר; ברירת המחדל ל-8GB היא `qwen2.5:7b`, ואם העברית חלשה — `gemma3:12b` |
| קריאת כלים ב-web-llm | מסומנת "preliminary" בספרייה | פרוטוקול JSON-ReAct כגיבוי לכל מודל; JSON mode יציב |
| CORS ו-Local Network Access | דפדפן ב-`https://lumen-md.vercel.app` → `http://localhost:11434`: Ollama דורש `OLLAMA_ORIGINS`; Chrome חדש עשוי לבקש הרשאת "רשת מקומית" | אבחון דטרמיניסטי של 403 / blocked עם ההוראה המדויקת; באפליקציית Tauri אין בעיה |
| זיכרון במכשירים ניידים | 8B לא ייטען | מנהל המודלים בוחר `tiny`; הפקודות הכבדות (builder, researcher) מציעות Ollama במחשב |
| הורדות גדולות | Whisper turbo ≈ 800MB, Llama 8B ≈ 4.5GB | הורדה רק באישור, התקדמות, מטמון ב-Cache Storage; ברירות מחדל קטנות |
| WebGPU ב-Safari / Firefox | Safari 26, Firefox 141+, Chrome / Edge 113+; q4f16 דורש shader-f16 | זיהוי ביכולות, לא בשם דפדפן; גיבוי: Ollama |
| Vercel חינמי | 100 פריסות ביום (נפגע ב-16.10) | #135: בנייה רק כשקלט של האפליקציה משתנה |
| קריאה חיה ל-Gemini | אין מפתח | #135 נבדק ביחידות בלבד |

## 10. החלטות שהתקבלו

| נושא | החלטה |
|---|---|
| אירוח | **בלי דומיין.** אפליקציה `lumen-md.vercel.app`, תיעוד `lumen-md-docs.vercel.app`, signaling `wss://lumen-signal.fly.dev`, workers ב-`*.workers.dev`. ה-worker של SSO מוגש דרך rewrite ב-`/api/sso/*` כדי שהעוגיות יהיו first-party (PR #109) |
| AI | **מקומי קודם.** מדיניות ברירת מחדל `local-only`; ענן רק בבחירה מפורשת. כל פקודה = סוכן עם כלים ומאמת; כל כישלון = סוכן שיפור |
| מודלים מקומיים | Ollama לשולחן עבודה (כלים + JSON Schema), web-llm לדפדפן, transformers.js לתמלול ול-embeddings. מודל ברירת מחדל נבחר לפי חומרה, לא קבוע |
| fine-tune | מוחלף בפרופילי סגנון מקומיים. ה-fine-tune של OpenAI נשאר אפשרות ענן עד 6.1.2027 |
| מודלי ענן (כשמדליקים) | Gemini: `gemini-3.8-flash`, קל `gemini-3.5-flash-lite` (1.5 / 2.0 כבויים, 2.5 סגור לחדשים). Claude: `claude-sonnet-5-5`, קל `claude-haiku-5-5`. OpenAI: `gpt-4o-mini` עד 14.1.2027 (מחליף `gpt-6-luna`), `whisper-1` עד 26.2.2027 |
| Vercel | כותרות אבטחה ב-`vercel.json` (Vercel לא קורא `public/_headers`); `ignoreCommand` בסקריפט `scripts/vercel-ignore.sh` |
| חבילות npm ב-live-js (C6) | לא בונים: דורש לפתוח CSP ל-CDN |
| Team workspaces, שוק ערכות נושא, פרסום לרשת (C8) | אחרי הפריסה, כתוכנית נפרדת |
| Tailwind 4 / Vite 8 | מוזגו (#133, #123). Tailwind בלי `@layer` כדי שספריות (CodeMirror, Milkdown, KaTeX) לא יגברו על הסגנונות שלנו |
| הצטרפות לחדר מוצפן כשאין תשובה | לא משתפים אוטומטית; כפתור לשיתוף |
| בדיקות TypeScript בבלוקים | רק בהפעלה ידנית (המהדר ≈ 1.3MB) |
| Dependabot | כל PR פתוח טופל ב-17.10. `@y/websocket-server` נעול ל-0.1.1 (הגרסאות הבאות דורשות yjs 14 prerelease) |

## 11. מגבלות ידועות

| תחום | מגבלה |
|---|---|
| רופא כספת | גדר קוד שמוזחת מעבר לעמודת התוכן של פריט רשימה · בלוק HTML מסוג 7 אחרי שורה שכולה קוד inline · `&amp;` בתוך code span של שני backticks בכותרת |
| Playground | גרף מודולים מעגלי (הודעת שגיאה ברורה) · לא נתמך ב-Netlify (אי אפשר להסיר שם את הכותרות הכלליות מעמוד ה-runner) |
| בדיקות TS | פרמטר בשם זהה למשתנה חיצוני לא נחשב הסתרה |
| מחקר | התאמת ציטוט מקורבת היא היוריסטיקה עם תקציב חישוב; ציטוטים ארוכים מאוד נבדקים על דגימות |
| worker המחקר | אין אימות אמיתי בלי חשבונות: `RESEARCH_TOKEN` אופציונלי, מומלצים Cloudflare Access ו-rate-limit |
| הצעות ב-WYSIWYG | עריכות שאי אפשר לבטא ב-CriticMarkup נחסמות במצב הצעות · CriticMarkup שחוצה בלוקים נשאר טקסט, ו-Accept/Reject All מטפלים בו במצב מקור |
| אצווה | ניסיון חוזר אחרי כשל בשמירת המצב עלול לכתוב עותק כפול אחד |
| AI מקומי (אחרי התוכנית) | איכות בעברית תלויה במודל ובחומרה · web-llm דורש הורדה ראשונה · Ollama דורש `OLLAMA_ORIGINS` לאפליקציה המתארחת |

## 12. חולשות — ומה המובילים בתחום עושים טוב יותר

> ביקורת שנעשתה 17.10 בערב על הקוד כפי שהוא בראש המחסנית (#155): סריקה של כל `src/`, `e2e/`, `docs/`, קבצי הפריסה וההיסטוריה ב-GitHub, עם אימות ידני של הממצאים החמורים. כל שורה מצביעה על ראיה (קובץ:שורה או מדידה). מה שלא שוחזר בזמן ריצה מסומן "לא אומת". ההשוואה למתחרים היא הערכה שלי, לא מדידה.

### 12.1 הפער מול המובילים

| יכולת | Obsidian | Notion | Typora / iA | Logseq | **Lumen היום** | סוגר |
|---|---|---|---|---|---|---|
| עורך עברי / RTL | כיוון לכל שורה | חלש | כיוון לכל פסקה | חלש | **שבור**: העורך כפוי ל-LTR, כותרות עבריות בלי עוגן, backlinks עבריים שגויים, גיבויים מתנגשים | T25, T26, T44, T45 |
| AI מקומי עם מאמתים וסוכן שיפור | תוספים חיצוניים | ענן בלבד | אין | אין | **ייחודי** (#137–#155), לא אומת חי | T21, T22 ✓, T27 |
| בטיחות נתונים | היסטוריית קבצים, קבצים רגילים בדיסק | היסטוריה מלאה | קבצים רגילים | קבצים רגילים | **חלש**: הפתקים ב-OPFS סמוי, בלי `persist()`, היסטוריית גרסאות ריקה, אין ייצוא של הכול, `git pull` דורס | T35, T46, T47, T56, T57 |
| מובייל | אפליקציות מקוריות | מקוריות | iOS | מקוריות | PWA, בלי מגע, manifest שבור | T41, T50 |
| סנכרון | שירות / git / iCloud | ענן | iCloud | git / ענן | git (fast-forward בלבד, בלי מיזוג) · Yjs בלי שרת · Drive/Dropbox כתובים ולא מחוברים | T56 |
| גרף, backlinks, canvas, מסדי נתונים | כן | חלקי / חזק | — | כן / חלש | כן (GraphView, backlinks, tldraw, תצוגות) | — |
| חיפוש | מהיר, אופרטורים | סמנטי בענן | מקומי | מקומי | היברידי מקומי (יש) · בלי reranker · שובר עברית · בלי אופרטורים | T26, T29, T54 |
| OCR / תמונות / הקראה | תוספים | OCR בענן | — | — | אין | T31, T32 |
| קוצץ רשת | רשמי | רשמי | — | — | אין | T34 |
| תוספים | 2,000+ | — | — | מאות | API מינימלי; הגלריה **מדומה** (התקנה = toast אחרי 400ms) וקורסת בפתיחה | T52 |
| נגישות | בינוני | טוב | טוב | בינוני | לא נמדד; 3 מ-18 דיאלוגים לוכדים פוקוס | T40 |
| ביצועים בהפעלה | מהיר | בינוני | מהיר | בינוני | Lighthouse אחרון: 55%, LCP 9.6s (desktop), 34.6s (mobile) | T38, T39 |
| שולחן עבודה | מקורי, עדכון אוטומטי | מקורי | מקורי | מקורי | Tauri בלי עדכון אוטומטי, Windows לא חתום, פתקים ב-OPFS של ה-webview | T57 |

### 12.2 רשימת החולשות (80 ממצאים, 14 תחומים)

**חומרה**: 🔴 גבוהה · 🟠 בינונית · 🟡 נמוכה. **13 הממצאים לתיקון ראשון**: E5 (תוקן), G2, G4, G5, G1, F1, B1–B4, E2, J2, G7 (כולם 🔴, כולם ניתנים לפתרון מקומי).

#### אימות ואמינות (A, E)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| E0 | כל מחסנית ה-AI המקומי לא רצה מעולם מול מודל אמיתי, WebGPU או docker | אין Ollama/GPU בסביבה שלי; `eval/results/` ריק | 🔴 | T21, T22 ✓, §8 |
| E1 | 131 בלוקי `catch` ריקים + 35 `.catch(() => {})` בולעים שגיאות בשקט (`sync/git.ts` 6, `collab/yjs.ts` 5, `App.tsx` 4) | סריקה | 🟠 | T42 |
| E2 | **גלריית התוספים קורסת בפתיחה**: `useMemo` אחרי `if (!open) return null` → "Rendered more hooks"; אין ESLint בפרויקט בכלל | `PluginGallery.tsx:233,239`; `App.tsx:933` (מורכב תמיד) | 🔴 | F1 מיידי, T42 ✅ #156 |
| E3 | flakes מוסתרים: 2 ניסיונות חוזרים ב-CI, 55 `waitForTimeout` קבועים ב-e2e, Firefox נופל לסירוגין | `playwright.config.ts:22`; היסטוריית Actions | 🟠 | T23 |
| E5 | **ל-PR-ים מוערמים לא היה CI בכלל**: `pull_request: branches: [main]` → #138–#155 נבדקו רק מקומית | `ci.yml:4-7` | 🔴 | ✅ תוקן ב-#155 (b119fd83); ריצה מלאה ירוקה על #155 ו-#156 |
| E4 | 5 בדיקות עם `expect(true).toBe(true)` (כולל e2e של הגלריה — לכן E2 עובר CI), `paste-html` מושבת לצמיתות, שער כיסוי 40% שמחריג `ui/`, `editor/`, `layouts/` | `screenshots-and-galleries.spec.ts:149,180`; `ci.yml:43-56` | 🟠 | T23 |
| A1–A9 | מגבלות ידועות (§11): רופא כספת ×3, Playground מעגלי + Netlify, הסתרה ב-TS, ציטוט מקורב, worker בלי אימות, הצעות ב-WYSIWYG ×2, אצווה כפולה | §11 | 🟡–🟠 | T43 |
| A10 | אחרי הפריסה: C7, D8, C8 לא נבנו; אין Sentry (אין ניטור שגיאות היום) | §8, §10 | 🔴 | §8 (טל) |

#### עברית ו-RTL (B)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| B1 | העורך תמיד LTR: `.cm-editor { direction: ltr }`, 0 שימושים ב-`perLineTextDirection` / `dir="auto"` | `index.css:1381-1388` | 🔴 | T25 (בעבודה) |
| B2 | כיוון אחד גלובלי (`documentElement.dir`); תצוגה מקדימה ו-WYSIWYG בלי כיוון לפי פסקה — מסמך מעורב לא קריא | `useStore.ts:486-488` | 🔴 | T25 |
| B3 | **כותרות עבריות בלי עוגן**: 4 פונקציות `slug` שומרות רק ASCII — `slug("שלום עולם")` = `""` — אז לחיצה על פריט במתאר לא עושה כלום, scroll-sync וקישורי wiki לכותרת שבורים | `remarkLumen.ts:229`, `pipeline.ts:299`, `EditorLayout.tsx:155`, `workspaceIndex.ts:199`; `Outline.tsx:91` | 🔴 | T26 |
| B4 | **backlinks שגויים לפתקים עבריים**: ההשוואה היא `slug(target) === slug(stem)`, וכל שם עברי נהיה `""` → כל קישור עברי "מצביע" לכל פתק עברי | `workspaceIndex.ts:102,110` | 🔴 | T26 |
| B5 | גיבויים עבריים מתנגשים: `שלום.md` ו-`תודה.md` → `____.md`, חולקים מכסה של 100 גרסאות ומוחקים זה את זה | `autoBackup.ts:76` | 🔴 | T26, T35 |
| B6 | חיפוש וספירת מילים: הניקוד מפרק מילים (`שָׁלוֹם` → `לו`), 2 מילים מנוקדות נספרות כ-6; אין אותיות שימוש; חיפוש מילות מפתח = substring | `neuralSearch.ts:41`, `StatusBar.tsx:318`, `workspaceIndex.ts:138-167` | 🟠 | T26 |
| B7 | הבודק הדקדוקי ברקע תמיד `en-US`; רק הפקודה המפורשת מעבירה `he` | `grammarExtension.ts:115`, `Editor.tsx:620` | 🟠 | T28 |
| B8 | אף גופן מצורף (Inter, Source Serif 4, JetBrains Mono) לא כולל עברית; הגופנים נטענים מ-Google (פרטיות, נכשל offline בפעם הראשונה) | `index.css:15-21`, `index.html:50` | 🟠 | T25 |
| B9 | CSS פיזי במקום לוגי: `border-left`, `padding-left`, `margin-left` (27 פיזיים מול 22 לוגיים) — תבליטים וגבולות בצד הלא נכון ב-RTL | `index.css:356,365,382,507,514` | 🟠 | T25 |
| B10 | ייצוא מתעלם מ-RTL: DOCX בלי `w:bidi`, HTML `lang="en"` בלי `dir`, LaTeX בלי polyglossia; רק PPTX והדפסה מטפלים | `exportDocx.ts`, `exportHtml.ts:41`, `exportFormats.ts:499` | 🟠 | T44 |
| B11 | תוכן באנגלית בלבד: welcome (510 שורות), 10 תבניות, קיצורי ⌘ גם ב-Windows; תאריכים `en-US` קבועים | `welcome.ts`, `public/templates`, `templates.ts:49,148`, `VersionHistory.tsx:144` | 🟠 | T45 |

#### ביצועים (C)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| C1 | Lighthouse אחרון: 55%, FCP 4.8s, LCP/TTI 9.6s (desktop); mobile FCP 29.7s, LCP 34.6s. לא נמדד מאז; האימות ב-CI הוא `warn` בלבד ורץ רק על main | `docs/audit/A7-lighthouse-baseline.md`; `ci.yml:145-163` | 🔴 | T38 |
| C2 | תקציבי bundle גדולים: הפעלה app 195KB + index 220KB + react 160KB gzip; עצלים: codemirror 600KB, mermaid 860KB, graphviz 700KB, tldraw 420KB; התקציב לכל קובץ ולא לסכום | `scripts/bundle-budget.mjs:37-69` | 🟠 | T38 |
| C3 | **כל שמירה אוטומטית סורקת את כל הכספת**: `lumen-workspace-changed` כל 600ms → עץ קבצים קורא כל קובץ, פאנל תגיות קורא כל קובץ, אינדקס backlinks נבנה מחדש עם `Promise.all` לא מוגבל | `App.tsx:448-453`, `FileTree.tsx:164`, `TagsPanel.tsx:64`, `workspaceIndex.ts:31-58` | 🔴 | T39 |
| C4 | האינדקס הסמנטי = blob אחד ב-idb-keyval עם וקטורים ב-base64, נטען כולו בכל שאילתה, cosine בכוח גס | `semanticSearch.ts:43,186-194,292-305` | 🟠 | T39 |
| C5 | רשימת הפקודות (≈120) נבנית מחדש בכל הקשה: `doc.content` בתלויות ה-`useMemo` | `useCommands.ts:189,2240-2267` | 🟠 | T38 |
| C6 | מסמכים ארוכים לא נבדקו (ה-e2e הגדול ביותר: 14KB); התצוגה המקדימה והמתאר מפרסרים את כל המסמך בכל debounce | `edge-cases.spec.ts:57`, `Outline.tsx:17` | 🟠 | T39 |

#### Offline / PWA (D)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| D1 | `vendor-shiki` ו-`shiki-langs` לא ב-precache ולא ב-runtime cache → הדגשת קוד נכשלת offline; אחרי עדכון SW ה-chunks החדשים של העורך לא במטמון עד שימוש ראשון (לא אומת) | `vite.config.ts:235-236,303` | 🟠 | T50 |
| D2 | manifest שבור: `/icon-192.png`, `/icon-512.png`, `apple-touch-icon.png`, `og-image.png` לא קיימים; שני manifests עם צבע שונה | `index.html:27-28`, `public/manifest.json:18` | 🟠 | T50 ✅ #156 (אייקונים, manifest אחד; og/canonical ב-#109) |
| D3 | ה-manifest מבטיח `share_target`, `file_handlers`, קיצורי `?action=` — ואין קוד לאף אחד מהם | `public/manifest.json:30-70` | 🟠 | T50 |
| D4 | offline לא מכוסה ב-e2e (שרת dev בלי SW; בדיקת ה-SW מושבתת) | `live-exec.spec.ts:246` | 🟠 | T50 |

#### אבטחה (F)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| F1 | **בלוקי live-js רצים אוטומטית בטעינת הפתק**, ב-Worker באותו origin, עם `fetch`/WebSocket/IndexedDB חופשיים — פתק משותף יכול לקרוא את טוקן ה-git ולשלוח אותו החוצה | `LiveJsBlock.tsx:48-60,225`; `git.ts:70-73`; CSP `connect-src ws: wss:` | 🔴 | T48 |
| F2 | HTML גולמי בפתקים לא עובר sanitize (`rehype-raw` → `rehype-react`); ברשת ה-CSP מגן, ב-Tauri (`unsafe-inline unsafe-eval`) `javascript:` יכול לרוץ (לא אומת) | `pipeline.ts:205-216`, `tauri.conf.json` | 🔴 | T48 |
| F3 | סודות בטקסט גלוי: מפתחות Anthropic/Gemini/Mistral ב-localStorage, טוקני Drive/Gist ב-localStorage, טוקן git ב-IndexedDB; `storage/vault.ts` המוצפן מיובא רק מבדיקה | `credentials.ts:50`, `gdrive.ts:58`, `githubGist.ts:14` | 🔴 | T36 |
| F4 | CSP רחב: `script-src 'unsafe-eval'`, `connect-src ws: wss:` לכל מארח, `img-src https:` (פיקסלי מעקב בפתקים) | `index.html:5`, `public/_headers` | 🟠 | T48 |
| F5 | ב-Vercel אין כותרות אבטחה: רק Cache-Control ו-CORS; אין `frame-ancestors`, `X-Frame-Options`, Trusted Types | `vercel.json` | 🟠 | #109 / T48 |
| F6 | חדרי שיתוף ציבוריים כברירת מחדל: בלי סיסמה, 9,000 שמות אפשריים בלבד, שרתי signaling ציבוריים, `persistent-server.js` בלי אימות | `yjs.ts:70-72,123-151,214-265` | 🔴 | T49 |
| F7 | שטח תקיפה מיותר: Tauri רושם plugin-fs עם הרשאות כתיבה שלא בשימוש; sourcemaps בייצור | `capabilities/default.json`, `vite.config.ts:379` | 🟠 | T57 |

#### בטיחות נתונים (G)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| G1 | **האפליקציה לא מבקשת מהדפדפן לשמור את הנתונים**: 0 קריאות ל-`navigator.storage.persist()` — OPFS ו-IndexedDB ניתנים לפינוי (Safari: 7 ימים) | סריקה | 🔴 | T35 ✅ #156 |
| G2 | **`git pull` דורס בשקט עריכות לא שמורות ומוחק קבצים מקומיים חדשים**; מצב מעקב מושך כל 5 דק׳; המסמך הפתוח מוחלף עם `dirty:false` | `git.ts:318-361`, `gitWatch.ts:76-81`, `useCommands.ts:1919-1925` | 🔴 | T56 |
| G3 | git מוגבל: fast-forward בלבד, בלי מיזוג או ממשק קונפליקטים, clone בעומק 1, טוקן חובה גם לריפו ציבורי, בלי `corsProxy` (clone מ-GitHub בדפדפן כנראה נכשל — לא אומת), בלי LFS | `git.ts:138-143,305` | 🔴 | T56 |
| G4 | **פאנל היסטוריית הגרסאות תמיד ריק**: `saveSnapshot` של הפאנל ללא קוראים; הגיבויים האוטומטיים ב-OPFS `backups/` שאף ממשק לא קורא; 3 מאגרי היסטוריה נפרדים | `VersionHistory.tsx:36`, `collab/versionHistory.ts` | 🔴 | T35 |
| G5 | **שינוי שם / העברה דורסים קובץ קיים בשקט** (`create:true` ואז מחיקת המקור); "דלג בקונפליקט" בהעברה מרובה לא מופעל; שינוי שם לא מעדכן קישורי wiki; אי אפשר לשנות שם לתיקייה | `workspace.ts:216-224`, `FileTree.tsx:107-115` | 🔴 | T46 |
| G6 | מחיקה סופית: רקורסיבית, בלי סל מחזור או ביטול | `FileTree.tsx:294-296` | 🟠 | T46 |
| G7 | **אין דרך לייצא את כל הפתקים**: הם ב-OPFS שהמשתמש לא רואה; `file.exportSite` מייצא מסמך אחד | `useCommands.ts:384-394` | 🔴 | T47 |
| G8 | סנכרון Drive / Dropbox / Gist (1,621 שורות + ConflictDialog) כתוב ולא מחובר לשום מקום | `src/sync/cloud` | 🔴 | T56 |
| G9 | שמירה אוטומטית: כתיבה שנכשלה (מכסה) נבלעת בלי הודעה; מסמכים מהדיסק נשמרים כל 30s; ללא כותרת לא נשמרים בכלל; אין flush ב-`pagehide` | `App.tsx:454-456`, `useStore.ts:197-198` | 🔴 | T35 ✅ #156 חלקית (ללא כותרת + flush); השאר T35 |
| G10 | הגיבויים מזהמים את הכספת: לפי שם ולא נתיב, נכתבים לשורש הגלוי → עד 100 עותקים לפתק בעץ, בחיפוש, בתגיות, ב-embeddings | `autoBackup.ts:76`, `semanticSearch.ts:208-211` | 🟠 | T35 |
| G11 | ייבוא Obsidian / Notion ממזג את כל הפתקים למסמך אחד | `fileFormats.ts:653-660` | 🟠 | T47 |

#### נגישות ומובייל (H, I)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| H1 | רק 3 מ-18 דיאלוגים לוכדים פוקוס; אין החזרת פוקוס | `CommandPalette.tsx:177`, `SearchDialog.tsx:76`, `PromptDialog.tsx:86` | 🟠 | T40 |
| H2 | ל-WYSIWYG אין שם נגיש; מחלק הסרגל `role="separator"` בלי מקלדת | `SidebarResizer.tsx:47-60` | 🟡 | T40 |
| H3 | ניגודיות טקסט משני בערכה הבהירה 3.99:1 (מתחת ל-4.5); גלילה חלקה מתעלמת מ-reduced-motion | `Outline.tsx:92` | 🟡 | T40 |
| H4 | ≈29 תוויות `aria-label`/`title` באנגלית קשיחה | `MobileKeyboardBar.tsx:68`, `PageView.tsx:85` | 🟡 | T40 |
| I1 | 0 מטפלי touch/pointer; ידיות גרירה רק ב-mousemove; המחלק עכבר בלבד | `dragHandles.ts:196-198` | 🟠 | T41 |
| I2 | אין אמולציית מובייל בבדיקות (רק רוחב viewport, בלי `hasTouch`) | `playwright.config.ts:30-48` | 🟠 | T41 |
| I3 | המתאר מוסתר מתחת ל-`md`; אין safe-area | `Outline.tsx:71`, `index.html:7,26` | 🟡 | T41 |
| I4 | אין פרויקט `android/` למרות `@capacitor/android`; iOS/Android דורשים חשבונות בתשלום | — | 🟠 | §8 |

#### חוויית משתמש, תוספים, AI, סנכרון, שולחן עבודה (J, K, L, M, N)

| # | חולשה | ראיה | חומרה | כלי |
|---|---|---|---|---|
| J1 | הגדרות מפוזרות: ≈120 פקודות ב-2,268 שורות, 8+ דיאלוגי הגדרות, 31 שדות store + ≈56 מפתחות `lumen.*`, אין מסך הגדרות אחד | `useCommands.ts` | 🟠 | T51 |
| J2 | **גלריית התוספים מדומה**: "התקנה" מרחוק = המתנה של 400ms ו-toast; `/plugins/*.js` לא קיימים; תג "מאומת" כברירת מחדל | `PluginGallery.tsx:214-218,257` | 🔴 | T52 |
| J3 | התיעוד מתאר "כספת מוצפנת" ופקודות נעילה שלא קיימות | `docs/security/vault.md` | 🟠 | T53 |
| J4 | 22 הודעות toast באנגלית קשיחה; ב-ar/de/ja 351–376 ערכים הם עותק של האנגלית; שער ה-i18n סופר מפתחות בלבד | `ai/commands.ts:90-104`, `ci.yml:96-110` | 🟡 | T45 |
| J5 | אין `#תגיות` בגוף הטקסט (רק frontmatter), אין אופרטורי חיפוש / regex | `views/tagsIndex.ts:32-45` | 🟠 | T54 |
| K1 | ה-eval מכסה רק את הסוכנים המקומיים, ידני, בלי baseline שמור; לפרומפטים של הענן אין eval | `fixtures.ts` | 🟠 | T19, T22 ✓ |
| K2 | קלט עברי עלול לקבל תשובה באנגלית: אף פרומפט ב-`prompts.ts` לא אומר "ענה באותה שפה" | `src/ai/prompts.ts` | 🟠 | T27 |
| K3 | קריאות AI בלי ביטול (שכתוב ב-WYSIWYG, refactor/template, שאל את הכספת); שתי מערכות AI חיות במקביל (`ai/agents.ts` הישן ו-`agents/`) | `WysiwygEditor.tsx:538`, `ai/agents.ts:53,99,146` | 🟡 | T55 |
| L1 | שיתוף פעולה בלי התמדה: `y-websocket` מוחלף ב-stub → חדרים WebRTC בלבד ונעלמים כשהאחרון יוצא | `vite.config.ts:332-346` | 🟠 | T56 |
| L2 | שרתי signaling ברירת מחדל: `wss://signal.lumen.md` (לא הדומיין שנבחר), yjs.dev, herokuapp (כנראה מת) | `yjs.ts:70-72` | 🟠 | T56 |
| M1 | API תוספים מינימלי: פקודות, תוכן, change/save, toast; בלי הגדרות, פאנלים, הרחבות עורך, loader או sandbox | `pluginSystem.ts:47-60` | 🔴 | T52 |
| N1 | תיעוד דק: 25 עמודים; כלום על git sync, ייצוא, עברית/RTL, קיצורים, התקנה | `docs/` | 🟠 | T53 |
| N2 | כל אירוח עם חסרון: Netlify בלי Playground, Docker עם 130MB זמני ריצה, שני nginx שונים | `deploy/` מול `docker/` | 🟡 | T53 |
| N3 | שולחן עבודה חלש: בלי auto-updater, Windows לא חתום, הפתקים ב-OPFS של ה-webview ולא בקבצים | `Cargo.toml`, `release.yml:84-89` | 🔴 | T57 |
| N4 | דומיין: README ו-`index.html` מצביעים ל-`lumen.md`; §10 בחר "בלי דומיין" | `README:37`, `index.html:15,22` | 🟠 | #109 |
| O1–O4 | קבצים ענקיים (8 קבצים > 900 שורות), ≈3,870 שורות קוד מת (`useAppHandlers`, `useGit`, `cryptoStorage`, `ConflictDialog`, `sync/cloud`), 4 עותקים של `slug`, 3 מאגרי היסטוריה, 69 חבילות מיושנות (16 גרסה ראשית) | `wc -l`, `npm outdated` | 🟠 | T42, T58 |

## 13. הכלים המקומיים החדשים (T21–T58)

כולם רצים על המחשב של המשתמש או בדפדפן. אין קריאה לענן בשום כלי, אלא אם המשתמש מדליק מדיניות ענן במפורש. "פותר" מצביע על הממצאים ב-§12.2.

### F. אימות ואמינות — "לא נבדק" הופך ל"נבדק בכל PR"

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T21 | **רופא AI** (`ai.doctor`) | `src/agents/doctor.ts`, `src/ui/AiDoctorPanel.tsx` | בודק בסדר: Ollama (גרסה, מודלים, `OLLAMA_ORIGINS`, כלים), WebGPU (f16, VRAM), transformers.js, OPFS (`storage.estimate`, `persisted`), service worker, CSP ל-11434/8787/8010, docker. ואז מקרה זהב אחד לכל סוכן (T19). כל ממצא = פעולה בלחיצה (T12) | E0 | 6 |
| T22 | **Ollama מזויף ב-CI** | `scripts/fake-ollama.mjs`, job `local-ai` | שרת HTTP שעונה ל-API של Ollama מתוך מקרי ה-eval; כל 12 הסוכנים רצים דרך זמן הריצה האמיתי בכל PR. **בוצע ב-#155** | E0, K1 | 3 ✓ |
| T23 | **אמת בבדיקות** | `scripts/e2e-flake.mjs`, `e2e/*`, `ci.yml` | `npm run e2e:flake -- <spec> --times 10` עם trace; מחיקת 5 ה-`expect(true)`, החלפת 55 `waitForTimeout` בהמתנות לתנאי, הפעלת `paste-html`, שער כיסוי שכולל `ui/` ו-`editor/`; `retries` יורד ל-1 ואז ל-0 | E3, E4 | 8 |
| T24 | **תצוגה מקדימה מקומית + רגרסיה חזותית** | `scripts/preview-visual.mjs`, `e2e/visual-smoke.spec.ts` | בנייה מקומית + צילומי מסך של כל משטח ב-LTR/RTL ובשתי ערכות; מבטל את התלות ב-preview של Vercel | — | 4 |
| F1 | **תיקונים מיידיים** (PR אחד, לפני הכול) | `PluginGallery.tsx`, `index.html`, `manifest.json` | סדר ה-hooks בגלריה (E2); אייקוני manifest חסרים (D2); `navigator.storage.persist()` בהפעלה (G1); `pagehide` flush לשמירה (G9); `dir` ב-`exportHtml` (B10 חלקית) | E2, D2, G1, G9 | 3 |

### G. עברית ו-RTL — מהמקום השבור ביותר למקום החזק ביותר

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T25 | **כיוון לכל פסקה + גופנים + CSS לוגי** | `src/editor/bidi.ts` (נכתב), `Editor.tsx`, `WysiwygEditor.tsx`, `renderer/`, `index.css` | מצב מקור: `perLineTextDirection` + `dir="auto"` לכל שורה (קוד ו-frontmatter ב-LTR; `dir:` ב-frontmatter מקבע). תצוגה מקדימה ו-WYSIWYG: `dir="auto"` לכל בלוק (rehype plugin + ProseMirror decorations). גופנים עם עברית מארחים עצמית (Noto Sans Hebrew / Heebo, Noto Sans Mono) בלי Google. כל `left/right` ב-CSS → `inline-start/end`. בדיקה ב-Chromium אימתה שהדפדפן פותר `dir="auto"` לכיוון מחושב | B1, B2, B8, B9 | 12 |
| T26 | **ליבת טקסט עברית** | `src/text/hebrew.ts`, `slug` אחד ב-`src/lib/slug.ts`, `workspaceIndex.ts`, `neuralSearch.ts`, `autoBackup.ts`, `StatusBar.tsx` | פונקציית slug אחת מודעת ל-Unicode (מחליפה את 4 העותקים; תואמת ל-rehype-slug כדי שהעוגנים יתאימו); backlinks לפי שם מנורמל ולא לפי slug ריק; שמות גיבוי לפי hash של הנתיב; tokenizer ששומר ניקוד ומנרמל אותיות סופיות; הסרת אותיות שימוש (ו, ה, ב, ל, מ, ש, כ, וה, וב…) כצורת חיפוש נוספת; ספירת מילים נכונה | B3, B4, B5, B6 | 8 |
| T27 | **קטלוג מודלים לעברית + "ענה באותה שפה"** | `src/ai/modelCatalog.ts`, `modelManager.ts`, `prompts.ts`, `eval/results/` | ציון עברית לכל מודל מה-eval שרץ אצל טל; המלצה לפי שפת הכספת: `aya-expanse:8b`, `gemma3:12b`, `qwen3:8b`, `dictalm2.0`; בדפדפן Qwen3 / Llama 3.2. כל פרומפט (גם ענן) מקבל "ענה בשפת הקלט" + בדיקת script על התשובה | B-כללי, K2 | 5 |
| T28 | **איות ודקדוק עברי מקומי** | `src/ai/hebrewSpell.worker.ts`, `grammarExtension.ts`, `proofreader.ts` | מילון עברי ב-worker (hspell הוא GPL — נטען כקובץ נתונים שהמשתמש מוריד, או מילון מוויקימילון CC BY-SA; ההחלטה בתחילת T28): איות בלי רשת; כללים דטרמיניסטיים (ה׳ הידיעה לפני מילת יחס, כפילות מילים, "את" לפני לא-מיודע); הבודק ברקע מזהה את שפת הפסקה במקום `en-US` קבוע | B7 | 8 |
| T44 | **ייצוא דו-כיווני** | `exportDocx.ts`, `exportHtml.ts`, `exportFormats.ts`, LaTeX | DOCX עם `w:bidi` ו-`w:rtl` לפסקאות עבריות, HTML עם `lang` ו-`dir` מהמסמך, LaTeX עם polyglossia/xelatex, EPUB עם `page-progression-direction` | B10 | 5 |
| T45 | **תוכן עברי** | `welcome.ts`, `public/templates/he/`, `templates.ts`, locales | welcome ו-10 התבניות בעברית (לפי שפת הממשק), קיצורים לפי מערכת ההפעלה, תאריכים לפי locale, 22 ה-toasts הקשיחים → i18n, ושער i18n שבודק גם ערכים לא מתורגמים (לא רק מפתחות) | B11, J4 | 6 |

### H. ידע ואיכות AI — התשובות טובות יותר, והאפליקציה לומדת

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T29 | **Reranker מקומי + ציטוטים לפתקים** | `src/ai/reranker.ts`, `semanticSearch.ts`, `SearchDialog.tsx` | `bge-reranker-v2-m3` ב-transformers.js מדרג מחדש 30 תוצאות; "שאל את הכספת" עונה עם ציטוטים לפתק ולשורה, ו-`quoteCoverage` (קיים) מאמת כל ציטוט; תשובה בלי ציטוט מאומת מסומנת | חיפוש | 6 |
| T30 | **מבקר לומד** | `src/agents/outcomes.ts`, `critic.ts`, `suggestions.ts` | כל הצעה שנלחצה נרשמת עם תוצאת הריצה החוזרת (IndexedDB); ההצעה שעבדה על המכונה הזו עולה ראשונה | — | 4 |
| T31 | **ראייה מקומית: OCR וטקסט חלופי** | `src/ai/vision.worker.ts`, `defs/captioner.ts`, `Editor.tsx` (הדבקה) | תמונה מודבקת/מצורפת: OCR (tesseract.js, עברית+אנגלית) → טקסט לחיפוש ו-`alt` אמיתי במקום שם הקובץ; תיאור ממודל ראייה מקומי (Ollama `qwen2.5vl`; דפדפן Florence-2); סריקות PDF עוברות OCR | תמונות, נגישות | 8 |
| T32 | **הקראה** (`note.read`) | `src/ai/tts.ts` | Web Speech API עם קולות המערכת (עברית ב-macOS/Windows), הדגשת המשפט הנקרא | — | 2 |
| T33 | **סיכום יומי** (`vault.digest`) | `defs/digester.ts` | מה השתנה מאז הביקור הקודם → פתק קצר עם קישורים ומשימות פתוחות | — | 4 |
| T34 | **קוצץ רשת וספריית קריאה** | `src/research/clipper.ts`, `extract.ts` בצד הלקוח | שמירת דף כ-Markdown בכספת עם מקור ותאריך; embeddings לספרייה; מחקר ב-`local-only` = הספרייה בלבד; חיפוש ברשת דורש הסכמה פעם אחת ושולח רק את השאילתה (§2.4) | פרטיות המחקר | 7 |
| T55 | **ביטול בכל מקום ומערכת AI אחת** | `ai/agents.ts` → `agents/defs`, `WysiwygEditor.tsx`, `SearchDialog.tsx` | `AbortSignal` לכל קריאת AI (Esc מבטל), מחיקת `ai/agents.ts` הישן אחרי שכל הקוראים עברו לסוכנים | K3 | 4 |

### I. בטיחות נתונים ופרטיות

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T35 | **היסטוריה, תמונות מצב וגיבוי אחד** | `src/storage/history.ts` (מאחד 3 מאגרים), `VersionHistory.tsx`, `autoBackup.ts`, `App.tsx` | מאגר היסטוריה אחד (IndexedDB, דלתות דחוסות) שהשמירה האוטומטית כותבת אליו — הפאנל מפסיק להיות ריק; תמונת מצב של כל הכספת כל 10 דק׳ ובסגירה; הגיבויים יוצאים מהשורש הגלוי (לא בעץ, לא בחיפוש, לא ב-embeddings) ונקראים לפי נתיב; `storage.persist()` + הודעה על מכסה; כתיבה שנכשלה = toast + ניסיון חוזר; flush ב-`pagehide`; מסמכים ללא כותרת נשמרים | G1, G4, G9, G10, B5 | 8 |
| T36 | **סודות מוצפנים** | `src/lib/secretStore.ts`, `credentials.ts`, `gdrive.ts`, `githubGist.ts`, `git.ts`, Tauri keyring | כל מפתח וטוקן מוצפן ב-WebCrypto (AES-GCM; מפתח לא-ניתן-לייצוא ב-IndexedDB, או passphrase); ב-Tauri — keychain של המערכת. `storage/vault.ts` הקיים מתחבר, או נמחק יחד עם התיעוד שלו | F3, J3 | 5 |
| T37 | **יומן פרטיות** | `src/ai/privacyLedger.ts`, לוח הגדרות AI | כל בקשת רשת של ה-AI נרשמת (מארח, בייטים, סיבה, מדיניות); חריגה תחת local-only = חסימה + הצעה | §2.4 | 3 |
| T46 | **פעולות קבצים בטוחות** | `workspace.ts`, `FileTree.tsx`, `src/storage/trash.ts` | שינוי שם/העברה מסרבים לדרוס (או שואלים), מעדכנים קישורי wiki בכל הכספת, תומכים בתיקיות; מחיקה → `.trash/` עם שחזור ו-Ctrl+Z; ריקון אחרי 30 יום | G5, G6 | 7 |
| T47 | **ייצוא ויבוא של הכול** | `src/storage/exportAll.ts`, `fileFormats.ts`, פקודות `vault.export`, `vault.import` | ייצוא כל הכספת כ-zip (Markdown + נכסים, שומר נתיבים) ול-File System Access API (תיקייה אמיתית); ייבוא תיקייה / zip של Obsidian ו-Notion קובץ-לקובץ עם המרת קישורים | G7, G11 | 6 |
| T48 | **ארגז חול לתוכן** | `LiveJsBlock.tsx`, `pipeline.ts`, `index.html`, `public/_headers`, `vercel.json`, `tauri.conf.json` | live-js רץ רק בלחיצה ("הרץ") ובתוך iframe `sandbox` עם origin נפרד (`playground-runner`, קיים) בלי גישה ל-IndexedDB/טוקנים ועם CSP `connect-src 'none'`; HTML גולמי עובר `rehype-sanitize` (allowlist); CSP: `img-src` רק self/data/blob + מארחים שהמשתמש אישר, `connect-src` רק מארחים ידועים; כותרות אבטחה ב-`vercel.json`; Tauri בלי `unsafe-eval` | F1, F2, F4, F5 | 10 |
| T49 | **חדרים מאובטחים** | `collab/yjs.ts`, `roomManager.ts`, `docker/collab.yml` | סיסמה אוטומטית (מוצפן E2E) בכל חדר, שם חדר 128 ביט, signaling ברירת מחדל = השרת של הפרויקט או LAN (docker), `persistent-server.js` עם טוקן | F6, L1, L2 | 6 |

### J. ביצועים, Offline, נגישות, מובייל

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T38 | **תקציב הפעלה ומדידה** | `scripts/bundle-budget.mjs`, `vite.config.ts`, `src/commands/*`, `lighthouserc`, `ci.yml` | תקציב על **סכום** ה-chunks של ההפעלה; `useCommands.ts` מפוצל ל-12 מודולים לפי תחום עם טעינה עצלה, ו-`doc.content` יוצא מתלויות ה-`useMemo`; Lighthouse ב-CI כ-`error` על כל PR עם סף (LCP < 2.5s desktop); `npm run perf` מקומי | C1, C2, C5 | 10 |
| T39 | **כספת גדולה ומסמך ארוך** | `workspaceIndex.ts`, `FileTree.tsx`, `TagsPanel.tsx`, `semanticSearch.ts`, `Outline.tsx` | אינדקס אחד ב-worker עם עדכון דלתא לפי הקובץ שהשתנה (לא סריקה של הכספת בכל שמירה); עץ קבצים ותגיות קוראים מהאינדקס; וקטורים ב-`Float32Array` לפי קובץ; מתאר ותצוגה מקדימה מעבדים רק את הבלוקים שהשתנו; e2e עם 10,000 פתקים ומסמך של 2MB | C3, C4, C6 | 10 |
| T50 | **PWA אמיתי** | `public/manifest.json`, `vite.config.ts`, `src/pwa/*`, `e2e/offline.spec.ts` | אייקונים קיימים, manifest אחד, `share_target` ו-`file_handlers` ממומשים (`launchQueue`), `?action=` עובד, shiki ו-workers ב-precache, e2e offline על בנייה אמיתית | D1–D4 | 6 |
| T40 | **סוכן נגישות** | `e2e/a11y.spec.ts` (axe-core), `src/ui/*`, `index.css` | axe על כל משטח (LTR+RTL), מלכודת פוקוס + החזרה ב-18 הדיאלוגים (hook אחד), שם נגיש ל-WYSIWYG, מחלק סרגל במקלדת, ניגודיות ≥ 4.5, `prefers-reduced-motion`, 29 התוויות → i18n | H1–H4 | 8 |
| T41 | **מובייל ומגע** | `dragHandles.ts`, `SidebarResizer.tsx`, `index.css`, `playwright.config.ts` | Pointer Events במקום mouse, יעדי מגע ≥ 44px, safe-area, מתאר במובייל כגיליון, פרויקט Playwright "mobile" עם `hasTouch` ומסע מלא | I1–I3 | 7 |

### K. חוויה, תוספים, סנכרון, שולחן עבודה, בריאות הקוד

| # | כלי | קבצים | מה הוא עושה | פותר | שעות |
|---|---|---|---|---|---|
| T51 | **מסך הגדרות אחד** | `src/ui/Settings/*`, `src/settings/schema.ts` | סכמת הגדרות אחת (כל מפתח `lumen.*` ושדה store מתועד בה), מסך אחד עם חיפוש, קטגוריות וייצוא/ייבוא; הדיאלוגים הקיימים הופכים ללשוניות | J1 | 8 |
| T52 | **תוספים אמיתיים** | `pluginSystem.ts`, `PluginGallery.tsx`, `src/plugins/sandbox/*`, `packages/create-lumen-plugin` | API: הגדרות, פאנל צד, הרחבות עורך (CodeMirror/ProseMirror), פקודות עם קיצורים, אחסון; טעינה מ-URL/קובץ ב-iframe sandbox עם הודעות; הגלריה קוראת רישום אמיתי (JSON בריפו) ומציגה "מאומת" רק עם חתימה; 3 תוספים לדוגמה | J2, M1 | 14 |
| T53 | **תיעוד מלא** | `docs/` | git sync, ייצוא/ייבוא, עברית ו-RTL, קיצורים, התקנה (PWA/שולחן עבודה/מובייל), מודלים מקומיים; מחיקת דף ה-vault שלא קיים; אירוח: טבלת "מה עובד איפה" | J3, N1, N2 | 6 |
| T54 | **תגיות בגוף וחיפוש עם אופרטורים** | `views/tagsIndex.ts`, `workspaceIndex.ts`, `SearchDialog.tsx` | `#תגית` בגוף הטקסט (גם עברית), אופרטורים `tag:`, `path:`, `-`, `"…"`, `/regex/`; ממומש על האינדקס של T39 | J5 | 5 |
| T56 | **סנכרון בטוח** | `sync/git.ts`, `gitWatch.ts`, `sync/cloud/*`, `ConflictDialog.tsx`, `docker/sync.yml` | `git pull` מתמזג (three-way) ומציג קונפליקטים במקום לדרוס; לא מוחק קבצים מקומיים לא עקובים; לא מחליף מסמך פתוח עם עריכה; clone ציבורי בלי טוקן; proxy CORS מקומי ב-docker; Drive/Dropbox/Gist מתחברים לממשק או נמחקים; שרת Yjs עם התמדה ב-docker | G2, G3, G8, L1 | 12 |
| T57 | **שולחן עבודה אמיתי** | `src-tauri/`, `src/storage/fsAdapter.ts`, `release.yml` | ב-Tauri הפתקים נשמרים כקבצים אמיתיים בתיקייה שהמשתמש בוחר (plugin-fs שכבר רשום) — תואם Obsidian; `tauri-plugin-updater`; חתימת Windows דרך Azure Trusted Signing (חינמי לפתוח) או SignPath; ללא sourcemaps בייצור | N3, F7 | 10 |
| T42 | **גדר קוד** | `scripts/check-code-hygiene.mjs`, ESLint | ESLint עם `react-hooks/rules-of-hooks` (היה תופס את E2), קובץ ייצור מעל 800 שורות נכשל, `catch` ריק דורש `// why:`; 8 הקבצים הגדולים מפוצלים | E1, E2, O1 | 8 |
| T58 | **ניקוי** | — | מחיקת ≈3,870 שורות קוד מת, איחוד 4 ה-slug ו-3 מאגרי ההיסטוריה (עם T26, T35), עדכון 16 החבילות בגרסה ראשית (React 19, Vitest 5…) אחת-אחת עם הבדיקות | O2–O4 | 10 |
| T43 | **סגירת המגבלות הידועות** | §11 | מה שניתן לתיקון ב-§11 | A1–A9 | 10 |

### לוח זמנים לשלבים F–K

| שלב | כלים | שעות | מתי |
|---|---|---|---|
| F אימות + תיקונים מיידיים | F1, T21, T23, T24 (T22 ✓) | 21 | מיד; F1 כ-PR ראשון אחרי המחסנית |
| G עברית | T25–T28, T44, T45 | 44 | אחרי F |
| I בטיחות נתונים ופרטיות | T35, T46, T47, T48, T36, T37, T49 | 45 | במקביל ל-G (קבצים שונים) |
| H ידע | T29–T34, T55 | 35 | אחרי G |
| J ביצועים / Offline / נגישות / מובייל | T38, T39, T50, T40, T41 | 41 | אחרי I |
| K חוויה, תוספים, סנכרון, שולחן עבודה, קוד | T51, T52, T53, T54, T56, T57, T42, T58, T43 | 83 | אחרי J |
| **סה״כ** | 37 כלים + F1 | **≈ 270 שעות** (טווח 230–320) | ≈ 3.5–4 שבועות עבודה רציפה |

הסדר נקבע לפי נזק: קודם מה שמאבד נתונים או פותח חור אבטחה ומה שמונע לדעת אם זה עובד (F, I), ואז מה שהמשתמש העברי רואה כל יום (G), מה שמבדיל מהמתחרים (H), מהירות ונגישות (J), ובסוף הרחבה ותחזוקה (K). כל כלי = PR נפרד עם בדיקות, review של Codex, ועדכון של המסמך הזה.

## 14. "הטובה בעולם בתחומה" — יעדים מדידים

"world class" הוא לא תחושה אלא מספרים. כל יעד כאן נבדק אוטומטית (CI או `npm run` מקומי), וכלי בתוכנית נחשב גמור רק כשהיעד שלו ירוק. המדדים נבחרו מול המובילים: Obsidian (מהירות, קבצים אמיתיים), Typora (עורך דו-כיווני), Notion (היסטוריה), iA Writer (נגישות וכתיבה).

| תחום | יעד | איך נמדד | כלים |
|---|---|---|---|
| **עברית** | eval מקומי ≥ 90% על `gemma3:12b` ו-≥ 80% על `qwen2.5:7b`; e2e RTL ירוק ב-Chromium, Firefox ו-WebKit (שורה עברית → `direction: rtl` מחושב בעורך, ב-WYSIWYG ובתצוגה המקדימה); 0 מאפייני CSS פיזיים (`left/right`) בכללי `.prose-lumen` ו-`.cm-*`; `slug("שלום עולם")` = `"שלום-עולם"` ותואם ל-rehype-slug; DOCX/HTML/EPUB נפתחים ב-RTL | `npm run eval:agents`, `e2e/rtl.spec.ts`, בדיקת CSS ב-hygiene, `slug.test.ts`, `exports.test.ts` | T25–T28, T44, T45 |
| **בטיחות נתונים** | 0 מסלולי איבוד נתונים מהרשימה (G1–G11): `persist()` מבוקש ומצבו מוצג; כל שמירה = גרסה בהיסטוריה; תמונת מצב כל 10 דק׳; `git pull` אף פעם לא דורס (מיזוג או קונפליקט); שינוי שם לא דורס; מחיקה = סל מחזור; ייצוא הכול בלחיצה; כתיבה שנכשלה = הודעה | `e2e/data-safety.spec.ts` שמשחזר כל מסלול G ומוודא שאין אובדן | T35, T46, T47, T56 |
| **אבטחה** | live-js רק בלחיצה ובתוך sandbox בלי אחסון/רשת; HTML גולמי עובר allowlist; 0 סודות בטקסט גלוי (בדיקה שסורקת localStorage/IndexedDB אחרי הגדרת מפתח); CSP ברשת וב-Tauri בלי `unsafe-eval`; חדרי שיתוף עם סיסמה כברירת מחדל; worker המחקר דורש טוקן | `e2e/security.spec.ts`, `csp-violations.spec.ts` (קיים), בדיקת `secretStore` | T36, T48, T49, T43 |
| **ביצועים** | Lighthouse ≥ 90 desktop / ≥ 80 mobile על בנייה אמיתית, LCP < 2.5s, TTI < 3.5s; קוד הפעלה ≤ 250KB gzip (סכום); כספת של 10,000 פתקים: פתיחה < 1s, שמירה → עדכון אינדקס < 50ms, חיפוש < 100ms; מסמך של 2MB: הקלדה בלי lag (< 16ms לפריים) | Lighthouse CI כ-`error`, `bundle-budget` על הסכום, `e2e/perf-vault.spec.ts` עם 10k פתקים | T38, T39 |
| **אמינות** | `retries: 0` ב-CI עם 0 כישלונות ב-20 ריצות רצופות; 0 `expect(true)`; 0 `waitForTimeout`; כיסוי ≥ 60% כולל `ui/` ו-`editor/`; ESLint נקי כולל `rules-of-hooks`; 0 `catch` ריק בלי `// why:` | CI | T23, T42 |
| **נגישות** | 0 ממצאי axe ברמת serious/critical על כל משטח (LTR ו-RTL, בהיר וכהה); כל 18 הדיאלוגים לוכדים ומחזירים פוקוס; מסע מקלדת בלבד עובר (פתיחה → כתיבה → חיפוש → שמירה → הגדרות); ניגודיות ≥ 4.5 לכל טקסט; `prefers-reduced-motion` מכובד | `e2e/a11y.spec.ts` | T40 |
| **מובייל ו-offline** | e2e ב-iPhone 14 ו-Pixel 7 (Playwright devices, `hasTouch`) עובר מסע מלא; PWA מותקן ו-`share_target` מקבל טקסט; offline מלא (כולל הדגשת קוד ו-AI מקומי אחרי הורדת מודל) ב-e2e על בנייה אמיתית | `e2e/mobile.spec.ts`, `e2e/offline.spec.ts` | T41, T50 |
| **i18n** | 0 ערכים לא מתורגמים בעברית, ≤ 5% ב-7 השפות האחרות; 0 מחרוזות קשיחות באנגלית בממשק (סריקה) | שער i18n שבודק ערכים | T45 |
| **תוספים** | API מתועד עם הגדרות, פאנל, הרחבות עורך; 3 תוספים לדוגמה רצים מתוך sandbox; גלריה שקוראת רישום אמיתי; "מאומת" רק עם חתימה | `e2e/plugins.spec.ts` | T52 |
| **שולחן עבודה** | ב-Tauri הכספת היא תיקייה אמיתית (נפתחת ב-Obsidian באותו רגע); עדכון אוטומטי; Windows ו-macOS חתומים | `tauri.yml` + בדיקה ידנית של טל | T57 |
| **AI מקומי** | כל 14 הסוכנים עוברים את ה-eval על מודל מקומי אחד לפחות; `ai.doctor` ירוק על המחשב של טל; יומן הפרטיות מראה 0 בקשות למארח לא מקומי תחת `local-only` במסע e2e מלא | `eval/results/`, `e2e/privacy.spec.ts` | T21, T27, T37 |

## 15. סדר הביצוע — PR אחרי PR

כל PR: ענף משלו על ראש המחסנית, בדיקות שמכסות את היעד מ-§14, review של Codex נענה ונסגר, עדכון של המסמך הזה (§1 + הטבלה כאן) ושל דף ה-HTML. PR-ים באותו שלב שלא נוגעים באותם קבצים רצים במקביל.

| # | PR | כלים | מה נכנס | בדיקת קבלה | שעות | מצב |
|---|---|---|---|---|---|---|
| F1 | `fix/immediate` | F1 | סדר hooks בגלריה, אייקוני manifest, `storage.persist()`, flush ב-`pagehide`, `dir` ב-HTML export, שמירת מסמכים ללא כותרת | e2e פותח את הגלריה (בלי `expect(true)`); בדיקת `persist()` נקרא | 3 | ✅ **#156** — CI ירוק ב-GitHub (3 דפדפנים) |
| F2 | `feat/agents-f1` | T25 | כיוון לכל שורה/בלוק, גופנים עבריים, CSS לוגי | `e2e/rtl.spec.ts` ב-3 דפדפנים; בדיקת CSS | 12 | ✅ **#157** — 2,669 בדיקות + `rtl.spec.ts` ירוקים מקומית (Chromium); CI ב-GitHub רץ |
| F3 | `feat/ai-doctor` | T21 | רופא AI + פאנל | בדיקה עם Ollama מזויף: כל שורה ירוקה; בלי Ollama: ההצעה הנכונה | 6 | הבא בתור |
| F4 | `test/honest` | T23 | מחיקת `expect(true)`, `waitForTimeout` → תנאים, כיסוי, `retries` | CI ירוק 5 פעמים ברצף | 8 | |
| F5 | `test/visual` | T24 | רגרסיה חזותית מקומית | `npm run preview:visual` | 4 | |
| G1 | `feat/hebrew-core` | T26 | slug אחד, backlinks, tokenizer, גיבויים, ספירת מילים | `hebrew.test.ts`, e2e מתאר עברי | 8 | |
| G2 | `feat/hebrew-models` | T27 | קטלוג, המלצה לפי שפה, "ענה באותה שפה" | eval + בדיקת script | 5 | |
| G3 | `feat/hebrew-spell` | T28 | מילון + כללים ב-worker, שפת פסקה ברקע | `hebrewSpell.test.ts` | 8 | |
| G4 | `feat/export-bidi` | T44 | DOCX/HTML/EPUB/LaTeX | `exports.test.ts` פותח את הקבצים ובודק `dir` / `w:bidi` | 5 | |
| G5 | `feat/hebrew-content` | T45 | welcome, תבניות, תאריכים, toasts, שער ערכים | שער i18n | 6 | |
| I1 | `feat/history-one` | T35 | מאגר היסטוריה אחד, תמונות מצב, גיבויים מחוץ לכספת, מכסה | `e2e/data-safety.spec.ts` חלק א | 8 | |
| I2 | `feat/safe-files` | T46 | שינוי שם בטוח + קישורים, סל מחזור | חלק ב | 7 | |
| I3 | `feat/export-import-all` | T47 | zip / תיקייה, ייבוא Obsidian/Notion | חלק ג | 6 | |
| I4 | `feat/content-sandbox` | T48 | live-js בלחיצה ב-sandbox, sanitize, CSP, Vercel headers | `e2e/security.spec.ts` | 10 | |
| I5 | `feat/secret-store` | T36 | סודות מוצפנים, keychain ב-Tauri | סריקת אחסון | 5 | |
| I6 | `feat/privacy-ledger` | T37 | יומן + חסימה | `e2e/privacy.spec.ts` | 3 | |
| I7 | `feat/secure-rooms` | T49 | סיסמה, שמות ארוכים, signaling, טוקן | בדיקות yjs | 6 | |
| H1 | `feat/rerank-cite` | T29 | reranker + ציטוטים לפתקים | `askWorkspace.test.ts` | 6 | |
| H2 | `feat/learning-critic` | T30 | outcomes | בדיקת דירוג | 4 | |
| H3 | `feat/vision` | T31 | OCR + alt + תיאור | בדיקה עם תמונה עברית | 8 | |
| H4 | `feat/tts-digest` | T32, T33 | הקראה, סיכום יומי | בדיקות יחידה | 6 | |
| H5 | `feat/clipper` | T34 | קוצץ, ספרייה, הסכמה למחקר | `e2e/clipper.spec.ts` | 7 | |
| H6 | `refactor/one-ai` | T55 | ביטול בכל מקום, מחיקת `ai/agents.ts` | כל קריאת AI עם signal (בדיקה) | 4 | |
| J1 | `perf/startup` | T38 | פיצול פקודות, תקציב סכום, Lighthouse כ-error | Lighthouse ≥ 90 | 10 | |
| J2 | `perf/big-vault` | T39 | אינדקס דלתאי ב-worker, 10k פתקים | `e2e/perf-vault.spec.ts` | 10 | |
| J3 | `feat/pwa-real` | T50 | manifest, share_target, precache, offline e2e | `e2e/offline.spec.ts` | 6 | |
| J4 | `feat/a11y` | T40 | axe, פוקוס, ניגודיות, reduced-motion | `e2e/a11y.spec.ts` | 8 | |
| J5 | `feat/touch` | T41 | pointer events, יעדי מגע, מובייל e2e | `e2e/mobile.spec.ts` | 7 | |
| K1 | `feat/settings-one` | T51 | סכמה + מסך אחד | e2e הגדרות | 8 | |
| K2 | `feat/plugins-real` | T52 | API, sandbox, גלריה אמיתית, 3 דוגמאות | `e2e/plugins.spec.ts` | 14 | |
| K3 | `feat/search-ops` | T54 | `#תגיות`, אופרטורים | `search.test.ts` | 5 | |
| K4 | `feat/safe-sync` | T56 | pull מתמזג, קונפליקטים, clone ציבורי, proxy, Yjs עם התמדה | `e2e/data-safety.spec.ts` חלק ד | 12 | |
| K5 | `feat/desktop-files` | T57 | קבצים אמיתיים ב-Tauri, updater, חתימה | בדיקה ידנית של טל | 10 | |
| K6 | `chore/lint-split` | T42 | ESLint, גדר גודל, פיצול 8 קבצים | CI | 8 | |
| K7 | `chore/cleanup` | T58 | קוד מת, עדכוני חבילות | CI | 10 | |
| K8 | `docs/complete` | T53 | תיעוד | — | 6 | |
| K9 | `fix/known-limits` | T43 | §11 | בדיקות לכל סעיף | 10 | |
| | **סה״כ** | | 37 PR-ים | | **≈ 270** | |

### מסירה למודל המבצע

התכנון (§12–§15) הושלם ב-17.10 21:30. ההמשך הוא ביצוע PR אחרי PR לפי הטבלה למעלה, עם הכלים שכבר קיימים בסשן: worktrees `/home/claude/w*` (אחד לכל ענף, `node_modules` משותף ב-`/home/claude/wa4/node_modules` דרך symlink), `scripts/fake-ollama.mjs` לבדיקות AI בלי GPU, סקריפט `chain.py` ל-rebase של המחסנית, ו-`threads.py` לקריאת הערות Codex. כל PR נפתח עם `gh api -X POST …/pulls --input`, ו-review נענה ונסגר דרך מסלולי `ccr`. המיזוג עצמו תמיד אצל טל.
