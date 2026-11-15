# Agent and prompt evals

| File | What it is |
|---|---|
| `baseline/agents-fake.json`, `baseline/prompts-fake.json` | **Wiring baselines** (`"kind": "wiring"`, `"model": "fake-ollama"`). CI runs every agent and prompt case against `scripts/fake-ollama.mjs`. A pass means the plumbing works (prompts, parsing, JSON schemas, tool calls). It says **nothing** about model quality. |
| `results/*.json` | Output of a run. A run against the fake server is labelled `"kind": "wiring"`; a run against a real Ollama model is `"kind": "model"`. The JSON of a real run is committed (the Markdown and HTML reports are not). |
| `acceptance.json`, `failures.md` | What `npm run eval:ingest` takes and the threshold for an agent's default; the agents no measured model passes (generated). |

`npm run eval:compare` refuses to compare a wiring run with a model baseline, or the other way round (exit 2).

**Real-model numbers** come only from running `npm run eval:agents -- --model <model>` on a machine with Ollama and the model pulled (plan task 7.9). Until such a run is committed, no file in this folder is a quality score. `npm run eval:ingest` then takes it into `models/registry.json` (`measured`) and `src/ai/defaults.ts` (each agent's default model).

## Eval cards (plan W11.I18)

Every eval report carries a top-level `card` (built with `makeCard` in `scripts/lib/evalCard.mjs`):

| Field | What |
|---|---|
| `tag` | `dev` (a set we wrote or tuned on), `heldout` (a sealed W6.17 set) or `public` (a published split; `dataset.source` is its URL) |
| `model.name`, `model.digest` | the pinned weights (sha256 or the Ollama digest) |
| `seed`, `temperature` | so the run can be repeated (W7.15) |
| `dataset.name`, `.version`, `.license` | which set, which revision, under which licence |
| `n` | items scored |
| `metrics.<name>` | `value` with a bootstrap 95% interval `ci95` (`method: "bootstrap"`) |
| `judgeCalibration` | required when a metric has `judge: "llm"`: Cohen's κ ≥ 0.6 against ≥ 50 human labels |

- `npm run eval:card [file|dir …]` fails any report under `eval/results` and `eval/cards` (or the given paths) whose card is missing a field.
- plan:check refuses a plain ✅ that rests on a `dev` card: a task's `evalCards` lists committed card files, and a ✅ task whose `dod` runs an eval (`eval:*`, `models:day`, `heldout`, `bench:*`) must list them, each tagged `public` or `heldout`. A dev number keeps the task at ✅* at most.
- A synthetic dataset is `dev` only: a card whose `dataset.origin` is `"synthetic"`, or whose `dataset.name` starts with `synthetic/` or `eval/synthetic/`, is refused when tagged `heldout` or `public`, so it can never back a ✅.

### Synthetic sets: eval/synthetic (plan W7.13)

`eval/golden` holds only sets that meet the golden-set rules (`scripts/lib/golden.mjs`), with a CI-only test split. A set we generated or rewrote ourselves, and that commits its "held-out" file, lives under `eval/synthetic` instead. Its manifest says `"origin": "synthetic"`, its parts are listed under `synthetic` in `eval/origins.json`, it is frozen (sha256 of every file) and the licence gate reads it like a golden set. Today it holds `retrieval-hard` (W7.13): 297 of its 300 HeQ questions are rewritten by rule, and its cross-lingual part was written for this repo. `npm run eval:embed-compete` reads it and writes `dev` cards only.

## כרטיסי הערכה (משימה W11.I18)

לכל דוח הערכה יש שדה `card` ברמה העליונה (נבנה עם `makeCard` ב-`scripts/lib/evalCard.mjs`):

| שדה | מה |
|---|---|
| `tag` | ‏`dev` (סט שכתבנו או כיווננו עליו), ‏`heldout` (סט חתום של W6.17) או `public` (חלוקה שפורסמה; ‏`dataset.source` הוא הכתובת שלה) |
| `model.name`, ‏`model.digest` | המשקולות הנעוצות (sha256 או ה-digest של Ollama) |
| `seed`, ‏`temperature` | כדי שאפשר יהיה לחזור על ההרצה (W7.15) |
| `dataset.name`, ‏`.version`, ‏`.license` | איזה סט, באיזו גרסה ובאיזה רישיון |
| `n` | מספר הפריטים שנמדדו |
| `metrics.<name>` | ‏`value` עם רווח סמך bootstrap של 95% ב-`ci95` ‏(`method: "bootstrap"`) |
| `judgeCalibration` | חובה כשלמדד יש `judge: "llm"`: ‏κ של Cohen ≥ 0.6 מול ≥ 50 תוויות אנושיות |

- ‏`npm run eval:card [קובץ|תיקייה …]` נכשל על כל דוח ב-`eval/results` וב-`eval/cards` (או בנתיבים שניתנו) שחסר שדה בכרטיס שלו.
- ‏plan:check מסרב ל-✅ מלא שנשען על כרטיס `dev`: השדה `evalCards` של משימה מונה קובצי כרטיס שנמצאים בריפו, ומשימה ב-✅ שה-`dod` שלה מריץ הערכה (`eval:*`, ‏`models:day`, ‏`heldout`, ‏`bench:*`) חייבת למנות אותם, וכל אחד מהם מתויג `public` או `heldout`. מספר dev משאיר את המשימה לכל היותר ב-✅*.
- ‏סט סינתטי הוא `dev` בלבד: כרטיס שה-`dataset.origin` שלו `"synthetic"`, או שה-`dataset.name` שלו מתחיל ב-`synthetic/` או ב-`eval/synthetic/`, נדחה כשהוא מתויג `heldout` או `public`, ולכן הוא לעולם לא יכול לתמוך ב-✅.

### סטים סינתטיים: eval/synthetic (משימה W7.13)

ב-`eval/golden` יש רק סטים שעומדים בכללי סטי הזהב (`scripts/lib/golden.mjs`), עם חלוקת test שקיימת רק ב-CI. סט שייצרנו או שכתבנו בעצמנו, ושקובץ ה-"held-out" שלו נמצא בריפו, יושב ב-`eval/synthetic`. במניפסט שלו כתוב `"origin": "synthetic"`, החלקים שלו רשומים תחת `synthetic` ב-`eval/origins.json`, הוא קפוא (sha256 לכל קובץ), ושער הרישיונות קורא אותו כמו סט זהב. כרגע יש בו את `retrieval-hard` ‏(W7.13): ‏297 מתוך 300 שאלות HeQ שלו שוכתבו לפי כלל, והחלק הבין-לשוני שלו נכתב בשביל הריפו הזה. ‏`npm run eval:embed-compete` קורא אותו וכותב רק כרטיסי `dev`.

## BFCL v4 (plan W11.I15)

`eval/public/bfcl-v4/` holds BFCL v4's simple (Python, 400), multiple (200), parallel (200) and multi_turn_base (200) categories, their possible answers and the multi-turn function docs, unchanged from https://github.com/ShishirPatil/gorilla at the commit in `manifest.json` (Apache-2.0, `LICENSE`), each file with its sha256.

- `src/agents/eval/bfcl.ts` ports BFCL's AST checker (`ast_checker.py`) and runs any engine with and without `toolRepair`, so the repair's share is reported separately. The W4.31 mock stays a unit test only.
- `npm run eval:bfcl` runs Ollama models (default `gemma4:e4b,qwen3.5:4b,qwen2.5:7b`) and writes one carded report per model and mode to `eval/results/`.
- `multi_turn_calls` is **not** BFCL's multi-turn accuracy. BFCL executes multi-turn calls against Python backends that are not ported. This harness compares the ordered calls of each turn, with stubbed tool results.

## BFCL v4 (משימה W11.I15)

ב-`eval/public/bfcl-v4/` נמצאות הקטגוריות simple (‏Python, ‏400), ‏multiple (200), ‏parallel (200) ו-multi_turn_base (200) של BFCL v4, עם התשובות האפשריות ותיעוד הפונקציות של ה-multi-turn. הן הועתקו בלי שינוי מ-https://github.com/ShishirPatil/gorilla בקומיט שב-`manifest.json` (‏Apache-2.0, ‏`LICENSE`), עם sha256 לכל קובץ.

- ‏`src/agents/eval/bfcl.ts` מעביר את בודק ה-AST של BFCL (`ast_checker.py`) ומריץ כל מנוע עם `toolRepair` ובלעדיו, כך שהתרומה של התיקון מדווחת בנפרד. ה-mock של W4.31 נשאר בדיקת יחידה בלבד.
- ‏`npm run eval:bfcl` מריץ מודלים ב-Ollama (ברירת מחדל `gemma4:e4b,qwen3.5:4b,qwen2.5:7b`) וכותב ל-`eval/results/` דוח עם כרטיס לכל מודל ולכל מצב.
- ‏`multi_turn_calls` **אינו** דיוק ה-multi-turn של BFCL. ‏BFCL מריץ את הקריאות של multi-turn מול צדי שרת ב-Python שלא הועברו. הרתמה הזו משווה את הקריאות של כל תור לפי הסדר, עם תוצאות כלים מדומות.
## The measured default per RAM tier (plan W11.I12)

`npm run models:select` reads the eval cards under `eval/cards` (add `--from eval/results` for a Mac run's reports) and writes `models/default-selection.json`. The app reads that file (`src/ai/defaultSelection.ts`).

- **Inputs.** HeQ test F1, AlephBench macro and nikud, BFCL v4 simple and multiple (the raw run, without toolRepair), and tok/s and peak RAM. Quality counts only from `public` or `heldout` cards.
- **Score.** composite = 0.30 HeQ + 0.30 AlephBench + 0.25 BFCL + 0.15 speed.
- **Rule.** A tier's default is replaced only by a model with a higher composite, at least 5 more AlephBench macro points, and at most 3 nikud points lost.
- **Tiers.** 4 GB and 8 GB. A model whose peak RAM is above the tier is never picked, and the app never uses a tier above the device's memory.
- **Today.** No card has been measured yet, so qwen2.5:7b stays the 8 GB default and the 4 GB tier has none. `--check` fails when the committed file differs from what the cards give.

## ברירת המחדל שנמדדה לכל דרגת RAM (משימה W11.I12)

‏`npm run models:select` קורא את כרטיסי ההערכה שב-`eval/cards` (עם `--from eval/results` גם את הדוחות של הרצה ב-Mac) וכותב את `models/default-selection.json`. האפליקציה קוראת את הקובץ הזה (`src/ai/defaultSelection.ts`).

- **קלט.** ‏F1 על HeQ test, ממוצע מאקרו וניקוד של AlephBench, ‏simple ו-multiple של BFCL v4 (ההרצה הגולמית, בלי toolRepair), ו-tok/s ו-RAM שיא. איכות נספרת רק מכרטיסים `public` או `heldout`.
- **ציון.** ציון משוקלל = ‏0.30 HeQ + ‏0.30 AlephBench + ‏0.25 BFCL + ‏0.15 מהירות.
- **כלל.** ברירת המחדל של דרגה מוחלפת רק במודל עם ציון משוקלל גבוה יותר, לפחות 5 נקודות יותר במאקרו של AlephBench, ולא יותר מ-3 נקודות פחות בניקוד.
- **דרגות.** ‏4 GB ו-8 GB. מודל שה-RAM השיא שלו מעל הדרגה לא נבחר אף פעם, והאפליקציה לא משתמשת אף פעם בדרגה שמעל הזיכרון של המכשיר.
- **היום.** עוד לא נמדד אף כרטיס, ולכן qwen2.5:7b נשאר ברירת המחדל של 8 GB, ולדרגת 4 GB אין ברירת מחדל. ‏`--check` נכשל כשהקובץ שבריפו שונה ממה שהכרטיסים נותנים.
## Public retrieval sets (plan W11.I13)

`src/agents/eval/retrievalPublic.ts` measures retrieval on published sets instead of the saturated HeQ dev.

- **Loaders.** It reads the BEIR / MTEB file format (BEIR SciFact, NFCorpus, FiQA, and MTEB WebFAQRetrieval `heb`) and Belebele rows (`heb_Hebr`, and he→en: Hebrew questions over English passages).
- **Metrics.** nDCG@10 and Recall@100 per query, with bootstrap 95% intervals in an eval card, p95 query latency, and the index size.
- **Retrievers.** Lumen's BM25 here, and RRF over any retrievers. Embedding models and rerankers join on the Mac (W11.M5). jina-reranker-v3 is excluded for its non-commercial licence.
- **Decision rules.** The default switches only at ≥ +3 nDCG points on WebFAQ-heb with intervals that don't overlap. A reranker is turned on only at ≥ +2 points and ≤ 150 ms p95.
- **Running it.** `python3 scripts/retrieval/fetch.py` (network) writes the sets with their pinned revision to `eval/public-data/` (gitignored). Then `npm run eval:retrieval-public` writes one public card per set.
- **MAFAT HSRC** waits for its registration (W11.O4).

## סטים ציבוריים לאחזור (משימה W11.I13)

‏`src/agents/eval/retrievalPublic.ts` מודד אחזור על סטים שפורסמו, במקום HeQ dev שכבר רווי.

- **טוענים.** הוא קורא את פורמט הקבצים של BEIR / MTEB (‏BEIR SciFact, ‏NFCorpus, ‏FiQA ו-MTEB WebFAQRetrieval ‏`heb`) ושורות של Belebele (‏`heb_Hebr`, וגם he→en: שאלות בעברית על קטעים באנגלית).
- **מדדים.** ‏nDCG@10 ו-Recall@100 לכל שאילתה, עם רווח סמך bootstrap של 95% בכרטיס הערכה, ‏p95 של זמן שאילתה וגודל האינדקס.
- **מאחזרים.** כאן ה-BM25 של Lumen, ו-RRF מעל כל מאחזר. מודלי embedding ו-rerankers מצטרפים ב-Mac ‏(W11.M5). ‏jina-reranker-v3 נפסל בגלל רישיון לא מסחרי.
- **כללי החלטה.** ברירת המחדל מוחלפת רק ב-+3 נקודות nDCG לפחות על WebFAQ-heb, עם רווחי סמך שלא חופפים. ‏reranker מופעל רק ב-+2 נקודות לפחות וב-p95 של 150 ms לכל היותר.
- **הרצה.** ‏`python3 scripts/retrieval/fetch.py` (דורש רשת) כותב את הסטים, עם הגרסה הנעוצה שלהם, ל-`eval/public-data/` (מחוץ ל-git). אחר כך `npm run eval:retrieval-public` כותב כרטיס public לכל סט.
- **‏MAFAT HSRC** מחכה להרשמה (W11.O4).
