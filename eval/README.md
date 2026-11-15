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
