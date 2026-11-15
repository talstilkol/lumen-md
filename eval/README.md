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
