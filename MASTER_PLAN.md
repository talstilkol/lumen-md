# תוכנית אב — Lumen · גרסה 3: סוכנים מקומיים + סגירת החולשות

> המסמך היחיד לתוכנית: מה בוצע, מה נשאר, מתי יסתיים ומה צריך מטל.
> עודכן 17.10.2026, 21:30 (שעון ישראל). גרסה 2 (17.10 15:45) וגרסה 1 (16–17.10) נשמרות בהיסטוריה של git.

## 0. מה השתנה בגרסה הזו

| הנחיה של טל (17.10) | מה זה אומר בתוכנית |
|---|---|
| "לא צריך דומיין — השתמש בוורסל" | האפליקציה ב-`https://lumen-md.vercel.app`, התיעוד ב-`https://lumen-md-docs.vercel.app`, השירותים בכתובות ברירת המחדל של Fly / Cloudflare. PR #109 |
| "העבר כל פקודות AI לסוכנים מקומיים שיבצעו אותן" | כל פקודת AI עוברת דרך **זמן ריצה אחד של סוכנים** שרץ על המכונה של המשתמש: Ollama, WebGPU בדפדפן (web-llm), או transformers.js. ספקי הענן נשארים רק כאפשרות שמדליקים במפורש (§2, §4) |
| "סוכנים מקומיים שיציעו שיפורים במידה ולא יהיה מענה" | **סוכן שיפור** לכל פקודה: כשאין תשובה, התשובה לא עוברת אימות, או שהמודל לא זמין — הוא מאבחן, מנסה שוב עם שינוי (עד פעמיים), ואם עדיין אין — מציג הצעות שאפשר ללחוץ עליהן (§5) |
| "צור master plan חדשה ומפורטת עם כל הכלים החדשים" | המסמך הזה. הכלים ב-§3, מפת ההעברה ב-§4, לוח הזמנים ב-§7 |
| "תן רשימה של כל החולשות… והוסף לתוכנית כלים מקומיים שיפתרו אותן… אם יש לך עוד רעיונות תוסיף, אני מאשר הכול" (17.10 20:38) | **§12** — ביקורת החולשות (W1–W4x) עם ראיות, והפער מול Obsidian / Notion / Typora / Logseq. **§13** — 22 כלים מקומיים חדשים (T21–T43) בשישה שלבים (F–K), ≈ 126 שעות. T22 כבר בוצע (#155) |

## 1. איפה אנחנו

| מדד | ערך |
|---|---|
| PR-ים שמוזגו | #106–#108, #110–#114, #117–#134 |
| PR-ים פתוחים, ממתינים למיזוג של טל (לפי הסדר) | **#109**, **#135**, **#136** (המסמך הזה), ואז המחסנית **#137 → #150, #155** (A1…E2), כל אחד על קודמו |
| תוכנית הסוכנים המקומיים (§3–§7) | **100% כתוב** (A1–E2, 15 PR-ים), 2,637 בדיקות עוברות, כל הערות ה-review של Codex נענו ונסגרו (0 פתוחות) |
| אומת חי על מודל אמיתי | **0%** — אין Ollama / GPU / docker בסביבה שלי. ב-CI רץ Ollama מזויף (T22) שמוכיח חיווט, לא איכות |
| תוכנית סגירת החולשות (§12–§13) | **כלי אחד מ-22 בוצע** (T22). ≈ 126 שעות, ≈ 8–10 ימי עבודה רציפים אחרי המיזוג |
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
| 1 | **למזג ב-GitHub לפי הסדר**: #109, #135, #136, ואז #137, #138, … #150, #155 (כל PR בנוי על קודמו; אחרי כל מיזוג GitHub מעדכן את הבסיס של הבא). המיזוג נחסם אצלי על ידי בקר האבטחה | כל התוכנית | 10 דק׳ |
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

> ביקורת שנעשתה 17.10 בערב על הקוד כפי שהוא ב-#155 (ראש המחסנית). כל שורה מצביעה על ראיה בקוד או על מדידה; מה שלא נמדד מסומן. ההשוואה למתחרים היא הערכה שלי, לא מדידה.

### 12.1 הפער מול המובילים

| יכולת | Obsidian | Notion | Typora / iA | Logseq | **Lumen היום** | מה סוגר את הפער |
|---|---|---|---|---|---|---|
| עורך עברי / RTL | בינוני (כיוון לכל שורה) | חלש | חלש | חלש | **חלש**: העורך כפוי ל-LTR (`index.css:1382`), אין `dir` לפי פסקה | T25, T26 |
| AI מקומי עם מאמתים וסוכן שיפור | אין (תוספים חיצוניים) | ענן בלבד | אין | אין | **ייחודי** (#137–#150), לא אומת חי | T21, T22 ✓, T27 |
| מובייל | אפליקציות מקוריות | אפליקציות מקוריות | iOS | אפליקציות | PWA בלבד, לא נבדק במגע | T41 |
| סנכרון | שירות בתשלום / git | ענן | iCloud | git / ענן | git (יש) · Yjs (שרת לא פרוס) | §8 פעולה 6 |
| היסטוריה וגיבוי | היסטוריית קבצים + סנכרון | היסטוריה מלאה | — | — | היסטוריית גרסאות (יש), אין תמונות מצב אוטומטיות / ייצוא | T35 |
| גרף, backlinks, canvas | כן | — | — | כן | כן (GraphView, backlinks, tldraw) | — |
| מסדי נתונים / properties | Bases | חזק | — | חלש | תצוגות מסד נתונים (יש) | — |
| חיפוש | מהיר, בלי סמנטי | סמנטי בענן | מקומי | מקומי | היברידי מקומי (יש) · בלי reranker · בלי עברית מנורמלת | T26, T29 |
| OCR / תמונות / הקראה | תוספים | OCR בענן | — | — | אין | T31, T32 |
| קוצץ רשת | רשמי | רשמי | — | — | אין | T34 |
| פרסום לרשת | Publish בתשלום | כן | — | — | מתוכנן (C8) | אחרי המחסנית |
| תוספים | 2,000+ | — | — | מאות | API משלנו, מעט תוספים | שוק ערכות (C8) |
| נגישות | בינוני | טוב | טוב | בינוני | **לא נמדד**: 323 `aria-*`, בלי בדיקת axe | T40 |
| ביצועים בהפעלה | מהיר | בינוני | מהיר | בינוני | 7.0MB gzip סה״כ, 184KB ראשי, 480KB chunk תוספים עצל | T38 |

### 12.2 רשימת החולשות

| # | תחום | חולשה | ראיה | חומרה | פותר |
|---|---|---|---|---|---|
| W1 | אימות | כל מחסנית ה-AI המקומי (#137–#150) לא רצה מעולם מול מודל אמיתי, WebGPU או docker | אין Ollama/GPU בסביבת הפיתוח; `eval/results/` ריק | **גבוהה** | T21, T22 ✓, פעולה של טל (§8) |
| W2 | אימות | אין אבחון עצמי: משתמש שמשהו לא עובד אצלו לא יודע מה (CORS? מודל חסר? CSP? מכסת OPFS?) | הבדיקות מפוזרות: `available()` לכל executor בנפרד, אין `navigator.storage.estimate()` בקוד | גבוהה | T21 |
| W3 | אימות | איכות העברית של מודלים קטנים לא ידועה; ברירת המחדל `qwen2.5:7b` נבחרה בלי מדידה | §9; `RECOMMENDED_OLLAMA_MODEL` קבוע ב-`executors/ollama.ts:17` | גבוהה | T19 ✓, T27 |
| W4 | אמינות | e2e ב-Firefox נופל לסירוגין (3 מתוך 12 הריצות האחרונות שנכשלו), עם 2 ניסיונות חוזרים ב-CI שמסתירים את זה | `playwright.config.ts:22` (`retries: 2`), היסטוריית Actions | בינונית | T23 |
| W5 | פריסה | Vercel חינמי מוגבל ל-100 פריסות ביום — ה-preview של כל PR נכשל ("retry in 24 hours") | סטטוס Vercel על #137–#155 | בינונית | T24, #135 ✓ |
| W6 | עברית | העורך כפוי ל-LTR גם בממשק עברי; אין כיוון לפי פסקה בתצוגה המקדימה וב-WYSIWYG | `src/index.css:1382` (`.cm-editor { direction: ltr }`), אין `perLineTextDirection` / `dir="auto"` בקוד | **גבוהה** | T25 |
| W7 | עברית | החיפוש לא מנרמל עברית: "ספרים" לא מוצא "הספרים", "סופר" ≠ "סופר" עם ניקוד, אותיות סופיות | `workspaceIndex.ts` — tokenizer כללי | גבוהה | T26 |
| W8 | עברית | אין מודל מומלץ לעברית; קטלוג web-llm מסומן "multilingual" לפי הצהרת היצרן, לא לפי מדידה | `modelManager.ts` (`multilingual: true` בהערה "Hebrew not verified by us") | בינונית | T27 |
| W9 | עברית | בדיקת איות ודקדוק בעברית תלויה ב-LanguageTool (תמיכה חלקית) או במודל (מנחש) | `grammar.ts` → `checkWithModel` | בינונית | T28 |
| W10 | AI | "שאל את הכספת" עונה בלי ציטוטים מאומתים לפתקים; אין reranker | `askWorkspace` משתמש ב-`searchHybrid` בלבד | בינונית | T29 |
| W11 | AI | סוכן השיפור מציע רשימה קבועה; לא לומד מה עזר על המכונה הזו | `critic.ts` — היוריסטיקות סטטיות | נמוכה | T30 |
| W12 | ידע | תמונות הן "חור שחור": אין OCR, אין טקסט חלופי, לא נמצאות בחיפוש | 0 קבצים עם `tesseract`/OCR ב-`src` | בינונית | T31 |
| W13 | נגישות | תמונות מודבקות מקבלות `alt` = שם הקובץ | `Editor.tsx:454` (`const alt = f.name…`) | בינונית | T31 |
| W14 | ידע | אין הקראה | 0 קבצים עם `speechSynthesis` | נמוכה | T32 |
| W15 | ידע | אין "מה השתנה" — חזרה לכספת אחרי יום דורשת לחפש ידנית | — | נמוכה | T33 |
| W16 | ידע | אין קוצץ רשת / ספריית קריאה | 0 קבצים עם `clipper` | בינונית | T34 |
| W17 | פרטיות | `research.ask` תחת `local-only` שולח את השאילתה ל-SearXNG שמעביר למנועי חיפוש חיצוניים — סותר את הבטחת §2.4 | ממצא Codex P1 ב-#136; `docker/local-ai.yml` | **גבוהה** | T34, T37 |
| W18 | נתונים | אין תמונות מצב אוטומטיות של הכספת ואין ייצוא גיבוי בלחיצה; היסטוריית הגרסאות היא לכל קובץ | `VersionHistory.tsx` (קיים), אין `snapshots` | גבוהה | T35 |
| W19 | נתונים | אין אזהרה לפני `git pull` שדורס עריכה לא שמורה | `src/sync/git.ts` | בינונית | T35 |
| W20 | אבטחה | מפתחות ענן ב-`localStorage` גלוי (`lumen.ai.key.<provider>`) | `credentials.ts:7,50` | בינונית | T36 |
| W21 | אבטחה | worker המחקר סומך על `Origin`; CSP של Tauri כולל `unsafe-inline` ו-`unsafe-eval` | `edge-workers/research/worker.ts:66`, `tauri.conf.json:27` | בינונית | T37, T43 |
| W22 | ביצועים | 7.0MB gzip סה״כ (mermaid 800KB, graphviz 600KB, prettier 590KB, בודק TS 1.4MB), ותקציב הבנייה נבדק לכל קובץ ולא לסכום ההפעלה | הערת bundle-size ב-#123, ממצא Codex `scripts/bundle-budget.mjs:37` | בינונית | T38 |
| W23 | קוד | קבצים ענקיים: `useCommands.ts` 2,268 שורות (116 פקודות), `fileFormats.ts` 1,306, `tsBlocks.ts` 1,046, `App.tsx` 1,033; 134 בלוקי `catch` שבולעים שגיאה בשקט ב-84 קבצים | `wc -l`, סריקת regex | בינונית | T38, T42 |
| W24 | ביצועים | אינדקס הטקסט (backlinks, חיפוש) נבנה מחדש כולו אחרי כל שינוי בכספת; האינדקס הסמנטי כבר דלתאי לפי hash. לא נבדק עם אלפי פתקים | `workspaceIndex.ts:80` (`cache.builtAt = 0` על כל `lumen-workspace-changed`) | בינונית | T39 |
| W25 | נגישות | אין בדיקת נגישות אוטומטית; 323 מופעי `aria-*` אבל בלי axe, בלי מסע מקלדת, בלי `prefers-reduced-motion` ב-e2e | `e2e/` — אין `a11y.spec.ts` | בינונית | T40 |
| W26 | מובייל | PWA בלבד; יש `responsive-sweep` אבל אין בדיקת מגע/מקלדת וירטואלית | `e2e/responsive-sweep.spec.ts` | בינונית | T41 |
| W27 | קוד | מגבלות ידועות שלא תוקנו (§11): אצווה כותבת עותק כפול, CriticMarkup חוצה בלוקים, worker בלי אימות | §11 | נמוכה–בינונית | T43 |

## 13. הכלים המקומיים החדשים (T21–T43)

כולם רצים על המחשב של המשתמש או בדפדפן. אין קריאה לענן בשום כלי, אלא אם המשתמש מדליק מדיניות ענן במפורש.

### F. אימות ואמינות — "לא נבדק" הופך ל"נבדק בכל PR"

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T21 | **רופא AI** (`ai.doctor`) | `src/agents/doctor.ts`, `src/ui/AiDoctorPanel.tsx` | בודק בסדר: Ollama (גרסה, מודלים, `OLLAMA_ORIGINS`, תמיכה בכלים), WebGPU (f16, תקציב VRAM), transformers.js (wasm/webgpu), OPFS (מכסה ושימוש), service worker, CSP ל-11434/8787/8010, docker (SearXNG, LanguageTool). ואז מריץ מקרה זהב אחד לכל סוכן (מ-T19). כל ממצא = פעולה בלחיצה דרך לוח ההצעות (T12) | W1, W2, W3 | 6 |
| T22 | **Ollama מזויף ב-CI** | `scripts/fake-ollama.mjs`, job `local-ai` ב-`ci.yml` | שרת HTTP שעונה ל-API של Ollama מתוך מקרי ה-eval. כל 12 הסוכנים רצים דרך זמן הריצה האמיתי בכל PR, בלי GPU. **בוצע ב-#155** | W1 | 3 ✓ |
| T23 | **צייד flakes** | `scripts/e2e-flake.mjs`, `playwright.config.ts` | `npm run e2e:flake -- <spec> --times 10`: מריץ בדיקה N פעמים עם trace, מדווח אחוז הצלחה ואת ה-trace של הכישלון. ב-CI: trace לכל כישלון ב-firefox. מדיניות: לא משתיקים בדיקה, מתקנים את הסיבה | W4 | 4 |
| T24 | **תצוגה מקדימה מקומית + רגרסיה חזותית** | `scripts/preview-visual.mjs`, `e2e/visual-smoke.spec.ts` (קיים) | בנייה מקומית + צילומי מסך של כל משטח בשני כיווני ממשק (LTR/RTL) ובשני ערכות נושא, השוואה לצילומים שבריפו. מבטל את התלות ב-preview של Vercel (100 פריסות ביום) | W5 | 4 |

### G. עברית ו-RTL — מהמקום החלש ביותר למקום החזק ביותר

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T25 | **כיוון לכל פסקה בעורך** | `src/editor/bidi.ts`, `CodeMirrorEditor.tsx`, `WysiwygEditor.tsx`, `index.css` | מצב מקור: `EditorView.perLineTextDirection` + `dir="auto"` במקום `direction: ltr` כפוי; WYSIWYG ותצוגה מקדימה: `dir` לכל בלוק לפי התו החזק הראשון (UAX #9). קוד, מתמטיקה וטבלאות נשארים LTR. ממשק RTL מלא: קיצורי מקלדת, פאנלים, גרירה | W6 | 8 |
| T26 | **חיפוש מודע לעברית** | `src/storage/workspaceIndex.ts`, `src/search/hebrew.ts` | נרמול אותיות סופיות (ך→כ…), הסרת ניקוד, הסרת אותיות שימוש (ו, ה, ב, ל, מ, ש, כ, וה, וב, ול, מה, שה…) כמילת חיפוש חלופית, התאמת תגיות וכותרות בעברית. דטרמיניסטי, בלי מודל | W7 | 5 |
| T27 | **קטלוג מודלים לעברית** | `src/ai/modelCatalog.ts`, `modelManager.ts`, `eval/results/` | ציון עברית לכל מודל מתוך ה-eval (T19) שרץ על המחשב של טל; מנהל המודלים ממליץ לפי שפת הכספת (זוהתה מחלק האותיות העבריות בפתקים): `aya-expanse:8b`, `gemma3:12b`, `qwen3:8b`, `dictalm2.0` (Ollama); בדפדפן: Qwen3 / Llama 3.2 | W8 | 4 |
| T28 | **איות ודקדוק עברי מקומי** | `src/ai/hebrewSpell.worker.ts`, `src/agents/defs/proofreader.ts` | מילון עברי ב-worker (hspell הוא GPL ולא מתאים לאפליקציית MIT כקוד — נטען כקובץ נתונים נפרד שהמשתמש מוריד, או מילון מוויקימילון CC BY-SA; ההחלטה בתחילת T28): שגיאות כתיב בעברית בלי רשת; כללי דקדוק דטרמיניסטיים (ה׳ הידיעה לפני מילת יחס, כפילות מילים, "את" לפני לא-מיודע); ה-proofreader מקבל את הרשימה כעובדות ולא מנחש | W9 | 8 |

### H. ידע ואיכות AI — התשובות טובות יותר, והאפליקציה לומדת

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T29 | **Reranker מקומי + ציטוטים לפתקים** | `src/ai/reranker.ts`, `semanticSearch.ts`, `askWorkspace.ts` | `bge-reranker-v2-m3` ב-transformers.js מדרג מחדש את 30 התוצאות הראשונות; "שאל את הכספת" עונה עם ציטוטים לפתק ולשורה, ואימות `quoteCoverage` (קיים) על כל ציטוט. תשובה בלי ציטוט מאומת מסומנת | W10 | 6 |
| T30 | **מבקר לומד** | `src/agents/outcomes.ts`, `critic.ts`, `suggestions.ts` | כל הצעה שנלחצה נרשמת עם התוצאה של הריצה החוזרת (IndexedDB). בפעם הבאה ההצעה שעבדה על המכונה הזו מופיעה ראשונה; הצעות שלא עזרו יורדות. "מה עבד בשבילך" במקום רשימה קבועה | W11 | 4 |
| T31 | **ראייה מקומית: OCR וטקסט חלופי** | `src/ai/vision.worker.ts`, `src/agents/defs/captioner.ts`, `imagePaste.ts` | תמונה שמודבקת/מצורפת: OCR (tesseract.js, עברית+אנגלית) → טקסט לחיפוש ו-alt; תיאור קצר ממודל ראייה מקומי (Ollama: `qwen2.5vl`/`llava`; דפדפן: Florence-2 ב-transformers.js). סריקות PDF עוברות OCR לעמוד | W12, W13 | 8 |
| T32 | **הקראה מקומית** (`note.read`) | `src/ai/tts.ts` | Web Speech API עם קולות המערכת (עברית ב-macOS/Windows), הדגשת המשפט הנקרא, מהירות; בלי רשת | W14 | 2 |
| T33 | **סיכום יומי מקומי** (`vault.digest`) | `src/agents/defs/digester.ts` | בפתיחה: מה השתנה מאז הביקור הקודם (mtime / git diff) → פתק סיכום קצר עם קישורים ומשימות פתוחות (tasker + writer). רץ רק אם יש שינויים | W15 | 4 |
| T34 | **קוצץ רשת וספריית קריאה** | `src/research/clipper.ts`, `extract.ts` (רץ בדפדפן), `library/` | שמירת דף אינטרנט כ-Markdown בכספת (חילוץ בצד הלקוח, בלי worker), עם מקור ותאריך; embeddings לספרייה. מחקר במצב `local-only` = חיפוש בספרייה שלך בלבד; חיפוש ברשת דורש הסכמה מפורשת פעם אחת ושולח **רק** את השאילתה, לא את המסמך (סוגר את ממצא Codex ב-#136) | W16, W17 | 7 |

### I. בטיחות נתונים ופרטיות

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T35 | **תמונות מצב וגיבוי** | `src/storage/snapshots.ts`, `src/ui/SnapshotsPanel.tsx` | תמונת מצב של הכספת ל-OPFS כל 10 דק׳ ובסגירה (דלתא, דחוסה), שחזור של קובץ/כספת לנקודה, ייצוא zip. אזהרה לפני `git pull` שידרוס עריכה לא שמורה; "יש שינויים לא שמורים" בסגירת הלשונית | W18, W19 | 6 |
| T36 | **סודות מוצפנים** | `src/ai/credentials.ts`, `src/lib/secretStore.ts`, Tauri keyring | מפתחות ענן מוצפנים ב-WebCrypto (AES-GCM, מפתח מ-passphrase או מ-`crypto.subtle` לא-ניתן-לייצוא ב-IndexedDB); ב-Tauri — keychain של המערכת. לא עוד `localStorage` גלוי | W20 | 4 |
| T37 | **יומן פרטיות** | `src/ai/privacyLedger.ts`, לוח הגדרות AI | כל בקשת רשת של מחסנית ה-AI נרשמת (מארח, בייטים, סיבה, מדיניות); מוצג בלוח ההגדרות. "מקומי בלבד" הופך לניתן לביקורת. חריגה (מארח לא מקומי תחת local-only) = חסימה + הצעה | W17, W21 | 3 |

### J. ביצועים, נגישות, מובייל

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T38 | **תקציב הפעלה** | `scripts/bundle-budget.mjs`, `vite.config.ts`, `useCommands` → `src/commands/*` | תקציב על **סכום** ה-chunks הנטענים בהפעלה (ממצא Codex #123); פיצול `useCommands.ts` (2,268 שורות) למודולים לפי תחום עם טעינה עצלה; Lighthouse מקומי (`npm run perf`) עם סף TTI | W22, W23 | 8 |
| T39 | **כספת גדולה** | `workspaceIndex.ts`, `semanticSearch.ts`, `FileTree.tsx` | אינדוקס ב-worker עם עדכון דלתא (לא אינדוקס מלא בכל שינוי), עץ קבצים וירטואלי, בדיקת ביצועים עם 10,000 פתקים ב-e2e | W24 | 6 |
| T40 | **סוכן נגישות** | `e2e/a11y.spec.ts` (axe-core), `src/ui/*` | axe על כל משטח (LTR+RTL), מסע מקלדת בלבד, מלכודות פוקוס, `prefers-reduced-motion`, שמות נגישים לכל כפתור אייקון. הממצאים מתוקנים, לא רק מדווחים | W25 | 8 |
| T41 | **מובייל ומגע** | `index.css`, `e2e/responsive-sweep.spec.ts` (קיים) | יעדי מגע ≥ 44px, סרגל כלים מתקפל, מקלדת וירטואלית לא מסתירה את הסמן, e2e באמולציית iPhone/Android, התקנת PWA | W26 | 6 |

### K. בריאות הקוד

| # | כלי | קבצים | מה הוא עושה | פותר חולשה | שעות |
|---|---|---|---|---|---|
| T42 | **גדר גודל קבצים** | `scripts/check-code-hygiene.mjs` | קובץ ייצור מעל 800 שורות נכשל ב-CI (רשימת חריגים מצטמצמת); `App.tsx`, `fileFormats.ts`, `tsBlocks.ts` מפוצלים | W23 | 5 |
| T43 | **סגירת המעקבים** | §11 | המגבלות הידועות שניתנות לתיקון (אצווה כותבת עותק כפול, Accept/Reject All על CriticMarkup חוצה בלוקים ב-WYSIWYG, worker המחקר סומך על Origin → token חובה) | W27 | 10 |

### לוח זמנים לשלבים F–K

| שלב | כלים | שעות | מתי |
|---|---|---|---|
| F אימות | T21, T23, T24 (T22 בוצע) | 14 | אחרי מיזוג #137–#155 |
| G עברית | T25–T28 | 25 | אחרי F |
| H ידע | T29–T34 | 31 | במקביל ל-G (קבצים שונים) |
| I בטיחות | T35–T37 | 13 | אחרי H |
| J ביצועים/נגישות | T38–T41 | 28 | אחרי I |
| K קוד | T42–T43 | 15 | לאורך הדרך |
| **סה״כ** | 22 כלים | **≈ 126 שעות** (טווח 110–150) | ≈ 8–10 ימי עבודה רציפים |

הסדר נקבע לפי כאב: קודם מה שמונע לדעת אם זה עובד (F), אחר כך מה שהמשתמש הראשון רואה כל יום (G), אחר כך מה שמבדיל מהמתחרים (H), ואז הגנה (I), מהירות ונגישות (J) ותחזוקה (K).
