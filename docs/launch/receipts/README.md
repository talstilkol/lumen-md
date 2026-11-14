# Launch receipts / קבלות השקה

`npm run launch:gate -- M0` reads `docs/launch/milestones.json` and one receipt
per criterion: `docs/launch/receipts/<milestone>/<criterion>.json`. A criterion
without a valid receipt fails. The gate runs nothing itself, so a receipt is
the record of a run someone made, committed in a PR so the history shows who
ran what on which commit.

`npm run launch:gate -- M0` קורא את `docs/launch/milestones.json` וקבלה אחת לכל
קריטריון. קריטריון בלי קבלה תקפה נכשל. השער לא מריץ כלום בעצמו: הקבלה היא
תיעוד של ריצה שמישהו עשה, ונכנסת ב-PR כדי שבהיסטוריה יופיע מי הריץ מה ועל איזה commit.

Every receipt has `criterion` (the criterion id), `kind` (the kind the
criterion asks for), `result: "pass"`, `date` (YYYY-MM-DD, not in the future),
`by`, and `commit` (a commit in this repository). Then, by kind:

```jsonc
// kind "test": every listed test file, all green
{ "criterion": "no-unearned-verified-badge", "kind": "test", "result": "pass", "date": "2026-11-20", "by": "lane S", "commit": "abc1234",
  "tests": [{ "file": "src/__tests__/pluginGallery.test.tsx", "passed": 12, "total": 12, "command": "npx vitest run src/__tests__/pluginGallery.test.tsx" }] }

// kind "run": every named run, with evidence (a log, a report or an artifact path)
{ "criterion": "ttfv-e2e-three-browsers", "kind": "run", "result": "pass", "date": "2026-12-01", "by": "Tal (Mac)", "commit": "abc1234",
  "runs": [{ "name": "ttfv-chromium", "result": "pass", "evidence": "playwright-report/ttfv-chromium.json" }, "…"] }

// kind "owner": every named fact, recorded
{ "criterion": "beta1-signed-and-updates", "kind": "owner", "result": "pass", "date": "2026-12-05", "by": "Tal", "commit": "abc1234",
  "facts": { "version": "0.2.0-beta.1", "releaseVerify": "npm run release:verify → ok", "installedOn": "macOS 26.1", "autoUpdatedTo": "0.2.0-beta.2" } }

// kind "metric" (W11.L2): every named metric as a number within the criterion's min/max, with evidence.
// For metrics "from": "beta-reports", `reports` is how many weekly opt-in beta reports they came from:
// put one week's reports (the latest per tester) in a folder and run
//   npm run launch:gate -- --beta-metrics <folder>
{ "criterion": "activation-and-d7", "kind": "metric", "result": "pass", "date": "2027-01-11", "by": "Tal", "commit": "abc1234",
  "metrics": { "activationRate": 0.52, "d7": 0.31 }, "reports": 54, "evidence": "beta-reports/2027-01-04 (not committed: testers' reports stay private)" }
```

M1–M4 and the 1.0 GA checklist are in the same file; `docs/launch/ga-checklist.md`
is built from it (`npm run launch:gate -- --checklist`, and `--check` fails when it is stale).

ל-M1–M4 ולרשימת היציאה של 1.0 GA יש קבלות מאותו סוג, וגם `metric`: כל מדד כמספר בתוך
הסף של הקריטריון, עם ראיה. מדדי הבטא מחושבים מהדוחות השבועיים שהבודקים בחרו לשלוח.

Any `result` other than `"pass"`, a missing test result, a test count like
11/12, an unknown commit or a missing fact fails the criterion, and the gate
prints why.

כל תוצאה שאינה `"pass"`, תוצאת בדיקה חסרה, ספירה כמו 11/12, commit לא מוכר או
עובדה חסרה מכשילים את הקריטריון, והשער מדפיס למה.
