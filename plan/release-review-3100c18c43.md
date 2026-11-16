# W10.Z3 — P0 definition-of-done re-review on verify/train-7 @ 3100c18c43

Lane T8-Z3, 2026-11-16. Every P0 task in plan/plan.json (163): each `dod` command and each acceptance item, against the code on 3100c18c43.
Tests ran in the offline shim v4 (`$S/shim-v4/v4.sh`, Node with happy-dom, Chromium fallback) with the train-7 node_modules overlay; `n/m` is pass/total. Nothing was marked ✅.

Verdicts: **met** (implemented, and a test or command here shows it) · **partial** (implemented, but a check is red or missing; the fix PR is named when this lane made one) · **missing** · **Mac-only** (needs a real browser, build, device, model or the full install: W10.M1/M3) · **owner-only** (the owner's accounts, keys, settings, or time).

**Counts (374 items):** met 181 · partial 23 · missing 1 · Mac-only 114 · owner-only 55

## Partial and missing, and who owns each

| task | item | state | owner |
|---|---|---|---|
| 0.5 | `retries: 0` | playwright.gifs.config.ts had retries: 1 → fixed in #952 with playwrightRetries.test.ts 5/5 | fixed in a T8-Z3 PR (integrator merges) |
| 0.9 | על כשל ה-zip של #189 מזהה ״עבר ב-#191 באותו קוד״ | status: the --around fix is only on #204, not in the train (scripts/ci-doctor/); a cloud port is owed | cloud code, a next lane |
| 1.4 | dod: `npx vitest run src/__tests__/aiCallsCarrySignal.test.ts` | src/__tests__/aiCallsCarrySignal.test.ts 0/1; real red → fixed in #953 | fixed in a T8-Z3 PR (integrator merges) |
| 1.4 | הבדיקה הסטטית: 0 קריאות בלי signal | aiCallsCarrySignal.test.ts 0/1: 9 calls without a signal → fixed in #953 (1/1, aiSignalReach 5/5) | fixed in a T8-Z3 PR (integrator merges) |
| 1.7 | מודל מותנה מציג הודעת רישיון | status: DictaLM not the default (recommend: false); the licence notice screen is in #429, verified only in code review | cloud code, a next lane |
| 5.5 | 0 קריאות עוקפות | allThroughRuntime.test.ts 15/16: entities/relations.ts, eval/public/adapters/entityGraph.ts, sources/knesset/app.ts call executor.chat directly (not fixed here: needs agent defs; cloud-code, next lane) | cloud code, a next lane |
| 8.1 | פלט זהה (snapshot של 50 מסמכים) | renderSnapshot.test.ts: the set is 96 documents, not 50 (the template gallery grew after the snapshots) → pinned in #954 (set cases 2/2); the 50 per-document snapshots need the real remark pipeline (Mac) | fixed in a T8-Z3 PR (integrator merges) |
| 13.5 | כל ה-P0 ירוקים | this re-review (W10.Z3): code reds fixed in #951–#954 (not merged); 5.5 and W10.A4 open; Mac and owner items remain | fixed in a T8-Z3 PR (integrator merges) |
| W6.4 | dod: `node --experimental-transform-types $S/rr7/*.test.ts (r7-1..r7-5)` | the dod runs files in the scratchpad ($S/rr7), outside the repo; the same tests are in security/attacks/rr7-1..5 (all pass, shim v4) → dod fixed in the plan PR to `npx vitest run security/attacks` | fixed in a T8-Z3 PR (integrator merges) |
| W6.4 | dod: `npx vitest run src/sync/__tests__/e2eeFifthReview.test.ts src/sync/__tests__/e2eeThi | the three files are not in src/sync/__tests__/ but in src/__tests__/: e2eeFifthReview 16/16, e2eeThirdReview 10/10, e2eeRekeyIntegrity 15/15 (shim v4) → paths fixed in the plan PR | fixed in a T8-Z3 PR (integrator merges) |
| W6.4 | dod: `python3 scripts/crypto/vectors.py --check` | scripts/crypto/vectors.py does not exist; the checker is scripts/sync-protocol/check_vectors.py: 51/51 vectors → dod fixed in the plan PR | fixed in a T8-Z3 PR (integrator merges) |
| W6.17 | לכל טענת איכות של AI, חיפוש ודיבור בתוכנית יש מספר מוחזק | heldout.test.ts 16/17 (the end-to-end case spawns a process the shim can't); held-out numbers exist only for the sets wired so far | cloud code, a next lane |
| W9.9 | verify/train-6 עובר כל שער לא מקוון | of the 140 P0 test files run here, 21 are not green: 5 code reds fixed in #951–#954; secretsScanLive (allow-list, owner), helpCoverage (W3.7, not P0); 3 timing cases on a loaded machine; 11 shim-only (stubbed packages, snapshots, spawn) | fixed in a T8-Z3 PR (integrator merges) |
| W10.A4 | hebrewLexicon 13/13, ‏respectfulMessages ירוק, ‏bookEpub ירוק ב-shim | hebrewLexicon.test.ts 12/13 (browser): the ≤20 ms timing case fails here (46–187 ms on this machine); respectfulMessages and bookEpub.test.ts 5/5 (browser) green | cloud code, a next lane |
| W10.A4 | 0 בדיקות תזמון קשיחות ב-unit | hebrewLexicon.test.ts still holds a hard timing bound in a unit test (the case above); not changed here: removing it would weaken a test — owner/coordinator to move it to the bench | owner / coordinator |
| W10.A6 | skipAudit 7/7 על הרכבת | skipAudit.test.ts 6/7: 36 violations → fixed in #952 (7/7, 0 violations, e2e 13 ≤ 15) | fixed in a T8-Z3 PR (integrator merges) |
| W10.A6 | 0 דילוגים בלי סיבה | same; fixed in #952 | fixed in a T8-Z3 PR (integrator merges) |
| W10.A9 | settingsSchema.test 6/6 | settingsSchema.test.ts 4/6: 20 keys missing + 1 false stale → fixed in #951 (6/6) | fixed in a T8-Z3 PR (integrator merges) |
| W10.A12 | externalChanges וה-watcher ירוקים ב-shim | externalChanges.test.ts 21/21; src/__tests__/watcher.test.ts named in the task does not exist (the watcher cases live in externalChanges) | cloud code, a next lane |
| W10.D6 | dodMock של W6.4 מוסר | W6.4 still has dodMock: true and its dod points outside the repo ($S/rr7, scripts/crypto/vectors.py) → dod fixed in the plan PR (fix/t8-z3-plan); dodMock stays (W6.4 is owner-reviewed) | fixed in a T8-Z3 PR (integrator merges) |
| W10.E1 | snapshot זהה בין worker ל-fallback על 40 ה-fixtures | same set as 8.1: 96 ≠ 50 → #954; per-document snapshots on the Mac | fixed in a T8-Z3 PR (integrator merges) |
| W10.E2 | snapshot זהה | same set as 8.1 → #954; per-document snapshots on the Mac | fixed in a T8-Z3 PR (integrator merges) |
| W10.G6 | ברירת מחדל קפדנית | --wip-strict is still opt-in (plan:check prints 5 WIP warnings, exit 0); status: on after train 6 — coordinator's switch | owner / coordinator |
| W10.Z3 | 0 P0 אדומים מסיבת קוד | this table: the code reds found are fixed in #951–#954 and W6.4's dod in the plan PR (none merged yet); open: 5.5 (3 direct executor calls), W10.A4 (timing bound in a unit test), the VITE_ allow-list entry (owner) | fixed in a T8-Z3 PR (integrator merges) |

PRs from this re-review (draft, base verify/train-7): #951 settings schema (W10.A9) · #952 skips, retries, e2e hooks (W10.A6, W10.A5/0.5, W4.2) · #953 cancel signal (1.4; sensitive: receipt and human-reviewed label owed by the owner) · #954 render set (8.1, W10.E1–E2) · #955 W10.G9 · the plan PR (W6.4 dod, this report).

## All items

| task | dod / acceptance item | evidence | verdict |
|---|---|---|---|
| 0.1 | dod: `npx vitest run src/__tests__/laneMerge.test.ts` | src/__tests__/laneMerge.test.ts 7/7 | met |
| 0.1 | מסלול חדש מוכן בפקודה אחת | scripts/lane.sh; laneMerge.test.ts 7/7 | met |
| 0.1 | מיזוג 4 ענפים כולל lockfile בלי התערבות ידנית | scripts/lane-merge.sh; laneMerge.test.ts 7/7 | met |
| 0.2 | אין קובץ ב-`src/commands` מעל 500 שורות | largest file in src/commands: domains/view.ts 485 lines (wc -l) | met |
| 0.2 | snapshot זהה | commandIds.test.ts 1/2: 1/2 here because the shim has no toMatchFileSnapshot; the real vitest run (W10.M1) | Mac-only |
| 0.2 | סכום chunks ההפעלה לא גדל | startup measured only on a real build (train4/startupB.mjs; ceiling 227,328 B, now 225,877) | Mac-only |
| 0.3 | dod: `npx vitest run src/__tests__/i18n.test.ts` | src/__tests__/i18n.test.ts 14/14 | met |
| 0.3 | שני מסלולים שמוסיפים מפתחות בתחומים שונים — 0 קונפליקטים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| 0.4 | dod: `npx vitest run src/__tests__/eslintEmptyCatchWhy.test.ts` | src/__tests__/eslintEmptyCatchWhy.test.ts 18/18 | met |
| 0.4 | rules-of-hooks: 0 הפרות | eslint is not runnable in the overlay (no full install); eslintEmptyCatchWhy.test.ts 18/18 covers the empty-catch rule only | Mac-only |
| 0.4 | PR עם catch ריק בלי הסבר נכשל | eslint-rules/ + eslintEmptyCatchWhy.test.ts 18/18 | met |
| 0.5 | 0 `waitForTimeout` | git grep waitForTimeout -- e2e without hygiene-allow: 0 | met |
| 0.5 | `retries: 0` | playwright.gifs.config.ts had retries: 1 → fixed in #952 with playwrightRetries.test.ts 5/5 | partial |
| 0.5 | 3 לילות רצופים: 0 flakes (נמדד אחרי המשימה — עד אז ⏳) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 0.6 | dod: `npm run plan:check` | npm run plan:check: exit 0 (818 tasks; 5 WIP warnings) | met |
| 0.6 | dod: `npx vitest run src/__tests__/planBuild.test.ts` | src/__tests__/planBuild.test.ts 32/32 | met |
| 0.6 | עדכון סטטוס = שורה אחת | plan/plan.json phases[].tasks[].status; planBuild.test.ts 32/32 (32/32 on the receipts branch) | met |
| 0.6 | CI נכשל כשהמסמך לא תואם | npm run plan:check exit 0; stale docs fail (planBuild.test.ts) | met |
| 0.7 | dod: `node scripts/dod.mjs --list` | node scripts/dod.mjs --list: exit 0 (67 tasks with a dod) | met |
| 0.7 | dod: `npx vitest run src/__tests__/dod.test.ts` | src/__tests__/dod.test.ts 15/15 | met |
| 0.7 | אי אפשר לסמן ✅ בלי DoD ירוק | scripts/dod.mjs checkDod + claimGuard in plan:check; dod.test.ts 15/15 | met |
| 0.7 | 15 ה-✅ הקיימים עוברים DoD או יורדים ל-⏳ | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| 0.8 | dod: `npx vitest run src/__tests__/reviewTools.test.ts` | src/__tests__/reviewTools.test.ts 35/35 | met |
| 0.8 | הרצה אחת מחזירה את כל הממצאים הפתוחים | scripts/review-triage.mjs; reviewTools.test.ts 35/35 | met |
| 0.8 | מענה וסגירה של 90 שרשורים בפקודה אחת | needs the live GitHub threads (gh api), not a code item | owner-only |
| 0.9 | על כשל ה-zip של #189 מזהה ״עבר ב-#191 באותו קוד״ | status: the --around fix is only on #204, not in the train (scripts/ci-doctor/); a cloud port is owed | partial |
| 0.10 | dod: `npx vitest run src/__tests__/licenses.test.ts` | src/__tests__/licenses.test.ts 95/95 | met |
| 0.10 | כל מודל, סט וחבילה רשומים | licenses.allow.json + licenses.test.ts 95/95 | met |
| 0.10 | רישיון אסור נחסם ב-CI, כולל תלות עקיפה | needs a real browser, build, device, model or the Mac run | Mac-only |
| 0.12 | dod: `npx vitest run src/__tests__/stack.test.ts` | src/__tests__/stack.test.ts 25/25 | met |
| 0.12 | תיקון בשכבה אמצעית מתגלגל לכל השכבות שמעליה בפקודה אחת | stack.test.ts 25/25 | met |
| 0.13 | dod: `npx vitest run src/__tests__/handoff.test.ts` | src/__tests__/handoff.test.ts 12/12 | met |
| 0.13 | סוכן חדש מבצע את הצעד הבא נכון מהמסמך בלבד | handoff.test.ts 12/12 | met |
| 0.14 | ב-20 ה-PR-ים הבאים: 0 כישלונות CI שה-CI המקומי היה תופס (נמדד אחרי המשימה — ⏳ עד אז) | measured over the next 20 PRs after the task; time-based | owner-only |
| 0.17 | dod: `npx vitest run src/__tests__/headersPolicy.test.ts` | src/__tests__/headersPolicy.test.ts 30/30 | met |
| 0.17 | 6 מקורות = טבלה אחת (בדיקה); דפי ה-runner — חריגה מתועדת (unsafe-eval בתוך sandbox) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 0.18 | dod: `npx vitest run src/__tests__/docsSync.test.ts` | src/__tests__/docsSync.test.ts 6/6 | met |
| 0.18 | docs-sync ירוק | docsSync.test.ts 6/6 | met |
| 0.18 | README בלי מספרים ידניים | docsSync.test.ts 6/6 | met |
| 1.1 | 0 שרשורים פתוחים בכל ה-PR-ים | open GitHub threads; a process item, not code | owner-only |
| 1.1 | CI ירוק | needs a real browser, build, device, model or the Mac run | Mac-only |
| 1.1 | B6: מילה מנוקדת = מילה אחת בחיפוש | nikud folding in search (src/search); covered by search tests in the train; status: B6 done | met |
| 1.2 | dod: `npx vitest run src/__tests__/evalBaseline.test.ts` | src/__tests__/evalBaseline.test.ts 10/10 | met |
| 1.2 | אין קובץ שמציג מודל אמיתי בלי ריצה אמיתית | needs a real browser, build, device, model or the Mac run | Mac-only |
| 1.3 | dod: `npx vitest run src/__tests__/dictationLocal.test.ts` | src/__tests__/dictationLocal.test.ts 19/19 | met |
| 1.3 | 0 שימוש ב-Web Speech ב-local-only (בדיקה) | dictationLocal.test.ts 19/19 | met |
| 1.3 | הכתבה offline אחרי הורדת Whisper | needs a real browser, build, device, model or the Mac run | Mac-only |
| 1.4 | dod: `npx vitest run src/__tests__/aiCallsCarrySignal.test.ts` | src/__tests__/aiCallsCarrySignal.test.ts 0/1; real red → fixed in #953 | partial |
| 1.4 | הבדיקה הסטטית: 0 קריאות בלי signal | aiCallsCarrySignal.test.ts 0/1: 9 calls without a signal → fixed in #953 (1/1, aiSignalReach 5/5) | partial |
| 1.4 | e2e הביטול ירוק | needs a real browser, build, device, model or the Mac run | Mac-only |
| 1.5 | dod: `npx vitest run src/__tests__/ttsLocalVoices.test.ts` | src/__tests__/ttsLocalVoices.test.ts 13/13 (browser) | met |
| 1.5 | בדיקה: ב-local-only לא נבחר קול רשת | ttsLocalVoices.test.ts 13/13 (browser) | met |
| 1.6 | dod: `npx vitest run src/__tests__/secretStore.test.ts` | src/__tests__/secretStore.test.ts 8/8 (browser) | met |
| 1.6 | 0 קוד מת בנושא | secretStore.test.ts 8/8 (browser) | met |
| 1.6 | התיעוד תואם לקוד (נבדק ב-1.8) | docs checked in 1.8; docsSync.test.ts 6/6 | met |
| 1.7 | כל מודל בקוד מסווג (בדיקה) | modelCredits.test.ts 7/7; models/registry.json | met |
| 1.7 | 0 מודלים אסורים | licenses.test.ts 95/95 | met |
| 1.7 | מודל מותנה מציג הודעת רישיון | status: DictaLM not the default (recommend: false); the licence notice screen is in #429, verified only in code review | partial |
| 1.9 | מדידת הרשת מתועדת | plan notes record the network measurement (status #198/#216) | met |
| 1.9 | החלטה 15.10 רשומה בתוכנית | decision 15.10 in plan.json | met |
| 1.8 | dod: `node scripts/dod.mjs --list` | node scripts/dod.mjs --list: exit 0 (67 tasks with a dod) | met |
| 1.8 | dod: `npm run plan:check` | npm run plan:check: exit 0 (818 tasks; 5 WIP warnings) | met |
| 1.8 | 0 פערים בין סטטוס ל-DoD | node scripts/dod.mjs --list exit 0; npm run plan:check exit 0 | met |
| 2.1 | dod: `npx vitest run src/__tests__/headersPolicy.test.ts` | src/__tests__/headersPolicy.test.ts 30/30 | met |
| 2.1 | 0 `unsafe-eval` ו-0 `https:` פתוח | headersPolicy.test.ts 30/30 | met |
| 2.1 | בדיקת המדיניות ירוקה | headersPolicy.test.ts 30/30 | met |
| 2.2 | dod: `npx vitest run src/__tests__/remoteImageRetained.test.tsx` | src/__tests__/remoteImageRetained.test.tsx 1/1 | met |
| 2.2 | 0 בקשות לתמונה חיצונית לפני אישור | remoteImageRetained.test.tsx 1/1 | met |
| 2.2 | 0 `ws:` חשוף | headersPolicy.test.ts 30/30 | met |
| 2.3 | dod: `npx vitest run src/__tests__/liveJsIsolation.test.ts` | src/__tests__/liveJsIsolation.test.ts 3/3 | met |
| 2.3 | security.spec ירוק ב-3 דפדפנים | needs a real browser, build, device, model or the Mac run | Mac-only |
| 2.4 | dod: `npx vitest run src/__tests__/ledgerComplete.test.ts` | src/__tests__/ledgerComplete.test.ts 14/14 | met |
| 2.4 | הורדה מתוך worker מופיעה ביומן | ledgerComplete.test.ts 14/14 | met |
| 2.4 | מסע מלא: 0 בקשות לא מקומיות | needs a real browser, build, device, model or the Mac run | Mac-only |
| 2.5 | dod: `npx vitest run src/__tests__/secretStore.test.ts` | src/__tests__/secretStore.test.ts 8/8 (browser) | met |
| 2.5 | סריקת האחסון: 0 טוקנים גלויים | secretStore.test.ts 8/8 (browser); secretsScanLive.test.ts 12/13: the storage and bundle scans pass; the red case is the VITE_ allow-list (W4.4) | met |
| 2.5 | בדיקות keychain ירוקות ב-macOS וב-Windows | needs a real browser, build, device, model or the Mac run | Mac-only |
| 2.8 | 3 בדיקות בכל PR | gitleaks/semgrep/audit run in Buildkite and ci:local (W10.D14); not run here | Mac-only |
| 3.1 | dod: `npx vitest run src/__tests__/trashUndo.test.ts` | src/__tests__/trashUndo.test.ts 25/25 | met |
| 3.1 | מחיקה → Ctrl+Z → התוכן האחרון חוזר, כולל לשונית לא פעילה | trashUndo.test.ts 25/25 | met |
| 3.2 | dod: `npx vitest run src/__tests__/versionHistory.test.ts` | src/__tests__/versionHistory.test.ts 10/10 | met |
| 3.2 | גודל ממוצע לגרסה ≤ 10% מטקסט מלא על פני 1,000 גרסאות | versionHistory.test.ts 10/10 | met |
| 3.2 | עריכת collab מופיעה בפאנל | versionHistory.test.ts 10/10 | met |
| 3.2 | מצב persist מוצג | versionHistory.test.ts 10/10 | met |
| 3.3 | dod: `npx vitest run src/__tests__/gitMerge.test.ts src/__tests__/gitPull.test.ts src/__tests__/gitSync.test.ts src/__tests__/gitProxy.test.ts src/__tests__/gitMirror.test.ts` | src/__tests__/gitMerge.test.ts 22/22; src/__tests__/gitPull.test.ts 0/13 (browser); shim only (isomorphic-git stubbed): real vitest on the Mac; src/__tests__/gitSync.test.ts 7/7; src/__tests__/gitProxy.test.ts 7/7; src/__tests__/gitMirror.test.ts 3/3 | Mac-only |
| 3.3 | dod: `npx playwright test e2e/data-safety.spec.ts -g "git pull"` | Playwright (browsers): the Mac run, W10.M1 | Mac-only |
| 3.3 | data-safety חלק ד׳ ירוק | e2e/data-safety.spec.ts part D (Playwright) | Mac-only |
| 3.3 | 0 קבצים נמחקים ב-pull | gitPull.test.ts 0/13 (browser): 0/13 here only because the shim stubs isomorphic-git (git.init is not a function); real vitest on the Mac; gitMerge 22/22, gitSync 7/7 | Mac-only |
| 3.6 | dod: `npx vitest run src/__tests__/collabRoomProof.test.ts` | src/__tests__/collabRoomProof.test.ts 5/5 | met |
| 3.6 | חדר שנסגר וחוזר — התוכן נשמר | collabRoomProof.test.ts 5/5 | met |
| 3.6 | 0 סודות ב-bundle | secretsScanLive.test.ts 12/13: the bundle scan cases pass (the red case is the VITE_ allow-list, W4.4) | met |
| 3.7 | dod: `npx playwright test e2e/data-safety.spec.ts e2e/sync-providers.spec.ts --project=chromium --project=firefox --project=webkit` | Playwright (browsers): the Mac run, W10.M1 | Mac-only |
| 3.7 | 11/11 ירוקים | dataSafetyMatrix.test.ts 15/15; the 11 e2e cases are Playwright | Mac-only |
| 4.1 | dod: `npx vitest run src/__tests__/vaultBackend.contract.test.ts` | src/__tests__/vaultBackend.contract.test.ts 476/476 | met |
| 4.1 | 0 גישות ישירות ל-OPFS מחוץ למימוש (בדיקה) | vaultBackend.contract.test.ts 476/476 | met |
| 4.1 | בדיקות החוזה ירוקות | vaultBackend.contract.test.ts 476/476 | met |
| 4.2 | הקבצים בתיקייה זהים בייט-לבייט למה שנשמר (e2e קורא את התיקייה); פתיחה ב-Obsidian — בדיקה ידנית (15.8) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 4.2 | בדיקות החוזה ירוקות | vaultBackend.contract.test.ts 476/476 | met |
| 4.3 | dod: `npx vitest run src/__tests__/vaultDesktop.test.ts` | src/__tests__/vaultDesktop.test.ts 11/11 | met |
| 4.3 | הגירה של 1,000 פתקים: 0 אובדן (בדיקה) | vaultDesktop.test.ts 11/11 | met |
| 4.3 | טל: עריכה ב-Lumen נראית ב-Obsidian (15.8) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 4.4 | עריכה בעורך חיצוני מופיעה תוך 2 שניות | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| 4.4 | עריכה מקבילה = קונפליקט, 0 אובדן | externalChanges.test.ts 21/21 | met |
| 4.5 | dod: `npx vitest run src/__tests__/wikiComplete.test.ts` | src/__tests__/wikiComplete.test.ts 25/25 | met |
| 4.5 | 10,000 פתקים: הצעות < 50ms | wikiComplete.test.ts 25/25 | met |
| 4.5 | e2e בעברית ובאנגלית | needs a real browser, build, device, model or the Mac run | Mac-only |
| 4.7 | תאימות לתחביר Obsidian על 20 קבצי בדיקה | needs a real browser, build, device, model or the Mac run | Mac-only |
| 4.7 | מחזור = הודעה, לא קריסה | embeds.test.ts 5/56 (browser): 5/56 here because the shim stubs remark/rehype; real vitest on the Mac | Mac-only |
| 4.12 | dod: `npx vitest run src/__tests__/dailyNote.test.ts` | src/__tests__/dailyNote.test.ts 16/16 | met |
| 4.12 | e2e: פתק היום נוצר ונפתח | needs a real browser, build, device, model or the Mac run | Mac-only |
| 4.12 | תאריך עברי נכון על 20 תאריכי זהב | dailyNote.test.ts 16/16 | met |
| 4.19 | dod: `npx vitest run src/__tests__/tldrawToExcalidraw.test.ts src/__tests__/excalidrawFile.test.ts` | src/__tests__/tldrawToExcalidraw.test.ts 184/184; src/__tests__/excalidrawFile.test.ts 16/16 | met |
| 4.19 | 0 בקשות רשת מהקנבס ב-local-only (יומן הפרטיות) | privacy-ledger check in a browser (e2e) | Mac-only |
| 4.19 | 20 קנבסים של tldraw מומרים בלי לאבד צורה | tldrawToExcalidraw.test.ts 184/184 | met |
| 4.19 | tldraw לא ב-bundle | excalidrawFile.test.ts 16/16; budget script refuses tldraw (scripts/check-bundle-budget) | met |
| 5.3 | כל סוכן מבצע לפחות קריאת כלי אחת ב-eval — ✅* מול Ollama מזויף, ✅ מול המודל האמיתי ב-CI (7.2) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 5.3 | builder שנכשל באמצע = 0 קבצים | status: staged write_file; agentsUseTools.test.ts 105/105 | met |
| 5.5 | 0 קריאות עוקפות | allThroughRuntime.test.ts 15/16: entities/relations.ts, eval/public/adapters/entityGraph.ts, sources/knesset/app.ts call executor.chat directly (not fixed here: needs agent defs; cloud-code, next lane) | partial |
| 5.5 | כל ריצה ב-trace | allThroughRuntime.test.ts trace cases pass (15/16, the failing one is #0) | met |
| 6.5 | דיוק ≥ 95% על Tatoeba (8 שפות, 7.1) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 6.10 | local-only: 0 בקשות ל-api.languagetool.org | needs a real browser, build, device, model or the Mac run | Mac-only |
| 6.10 | recall ≥ 90% על סט שגיאות באנגלית | needs a real browser, build, device, model or the Mac run | Mac-only |
| 6.17 | dod: `npx vitest run src/__tests__/cloudRoutes.test.ts src/__tests__/aiPolicyGates.test.ts src/__tests__/VoiceDictationUnit.test.ts` | src/__tests__/cloudRoutes.test.ts 31/31; src/__tests__/aiPolicyGates.test.ts 6/6; src/__tests__/VoiceDictationUnit.test.ts 5/5 | met |
| 6.17 | dod: `npx playwright test e2e/local-only-all-commands.spec.ts` | Playwright (browsers): the Mac run, W10.M1 | Mac-only |
| 6.17 | local-only: 0 מסלולים לענן במסע המלא | needs a real browser, build, device, model or the Mac run | Mac-only |
| 7.1 | dod: `npx vitest run src/__tests__/golden-sets.test.ts` | src/__tests__/golden-sets.test.ts 52/52 | met |
| 7.1 | 10 סטים, כל אחד עובר שער רישיונות (0.10) | golden-sets.test.ts 52/52 | met |
| 7.1 | גדלים: 80 / 250 / 100 / 150 / 200 / 130 / 250 / 50 / 130 / 240 | golden-sets.test.ts 52/52 | met |
| 7.1 | אף קובץ test בריפו (בדיקה); אותו seed → אותו sha256 (sampler דטרמיניסטי) | golden-sets.test.ts 52/52 | met |
| 7.2 | 14/14 סוכנים (כולל researcher) מחזירים פלט שעובר סכמה מול מודל אמיתי | needs a real browser, build, device, model or the Mac run | Mac-only |
| 7.2 | LanguageTool ו-SearXNG נבדקים באמת (T15) | needs a real browser, build, device, model or the Mac run | Mac-only |
| 7.3 | כל סוכן עם ≥ 5 מקרים | eval cases per agent (status 162/162 on train-2) | met |
| 7.3 | `npm run eval:agents` מייצר דוח | npm run eval:agents needs the models (W10.M1 / owner model day) | Mac-only |
| 7.9 | ≥ 90% gemma3:12b, ≥ 80% qwen2.5:7b — או משימת תיקון פתוחה לכל כישלון | needs a real browser, build, device, model or the Mac run | Mac-only |
| 8.1 | TBT בנייד < 300ms | needs a real browser, build, device, model or the Mac run | Mac-only |
| 8.1 | פלט זהה (snapshot של 50 מסמכים) | renderSnapshot.test.ts: the set is 96 documents, not 50 (the template gallery grew after the snapshots) → pinned in #954 (set cases 2/2); the 50 per-document snapshots need the real remark pipeline (Mac) | partial |
| 8.3 | השער פעיל וירוק ב-3 ריצות לילה רצופות (תנאי ה-P0 לשחרור); שבוע שלם בלי flakes נמדד אחרי השחרור ונרשם ב-13.6 | needs a real browser, build, device, model or the Mac run | Mac-only |
| 8.3 | 0 העלאות ל-temporary-public-storage | lighthouserc.json uploads to filesystem only; perfGate.test.ts 15/15 | met |
| 9.1 | הסריקה: 0 | i18nHardcoded.test.ts 5/5 | met |
| 9.8 | טבלה עברית נפתחת ב-Word מיושרת נכון | needs a real browser, build, device, model or the Mac run | Mac-only |
| 10.1 | axe: 0 serious / critical | needs a real browser, build, device, model or the Mac run | Mac-only |
| 10.1 | מסע מקלדת ירוק | needs a real browser, build, device, model or the Mac run | Mac-only |
| 10.2 | מסע מלא ירוק בשני המכשירים | needs a real browser, build, device, model or the Mac run | Mac-only |
| 13.1 | כל פיצ'ר עם עמוד; docs-sync ירוק | docsComplete.test.ts 10/10; docsSync.test.ts 6/6 | met |
| 13.5 | כל ה-P0 ירוקים | this re-review (W10.Z3): code reds fixed in #951–#954 (not merged); 5.5 and W10.A4 open; Mac and owner items remain | partial |
| 13.5 | `v1.0.0-rc` רק אחרי הביקורת | the tag is the owner's (W10.O4) | owner-only |
| W1.1 | main מכיל את כל המשימות שמסומנות ⏳ או ✅ בתוכנית (בדיקת plan מול git log: 0 פערים) | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W1.1 | 0 PR-ים של פיצ׳רים פתוחים מעל 7 ימים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W1.1 | חבילת הבדיקות המלאה ירוקה על main ב-Vercel Sandbox ב-3 ריצות רצופות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W1.35 | dod: `node scripts/vercel-build.mjs --dry-run` | node scripts/vercel-build.mjs --dry-run: exit 0 (18 gates listed) | met |
| W1.35 | dod: `npx vitest run src/__tests__/vercelBuild.test.ts` | src/__tests__/vercelBuild.test.ts 8/8 | met |
| W1.35 | PR עם בדיקה שנכשלת מקבל סטטוס Vercel failure | needs a real browser, build, device, model or the Mac run | Mac-only |
| W1.35 | PR נקי מקבל success | needs a Vercel preview build; vercelBuild.test.ts 8/8 | Mac-only |
| W1.35 | main נבנה כמו היום | a real build; vercel-build --dry-run lists the gates (exit 0) | Mac-only |
| W4.1 | 0 PR-ים פתוחים עם מספר > 354 שאינם בתוך verify/train-2 או סגורים עם נימוק | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W4.1 | vercel-build: 7/7 שערים ירוקים על הראש; vitest 0 כשלים | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.1 | startup ≤ 460 KB gz אחרי כל המיזוגים, בלי שינוי תקציב | startup 225,877 B gz ≤ 227,328 (lane rules, train4/startupB.mjs) — stricter than 460 KB | met |
| W4.1 | main מקודם ל-verify/train-2 תוך 3 ימים מ-W4.2 ירוק | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W4.2 | דוח e2e מלא (3 דפדפנים) על הראש של verify/train ואחר כך verify/train-2, עם 0 כשלים לא מוסברים | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.2 | smoke chromium רץ בכל בניית preview ונכשל כשהאפליקציה לא עולה (בדיקה עצמית שבורה בכוונה) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.2 | זמן כל shard ≤ 40 דקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.3 | curl ל-lumen-md.vercel.app מחזיר 0 מופעים של הדומיין הישן ב-HTML | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.3 | שער הדומיין נכשל על קובץ שתול עם הדומיין הישן | takenDomain.test.ts 5/5 | met |
| W4.4 | דוח סריקה ל-production ול-3 ה-previews האחרונים: 0 סודות, או רשימת סודות שבוטלו | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W4.4 | בדיקה עצמית: טוקן שתול בבנייה מקומית נמצא | secretsScanLive.test.ts 12/13: the planted-token case passes; 1 failure is VITE_CONTENT_FRAME_URL missing from security/vite-env-allowlist.json (an allow-list change: not made by lanes, owner/coordinator decision) | met |
| W4.5 | release ציבורי ב-GitHub עם לפחות 3 ארטיפקטים ו-SHA256SUMS שמאומת ב-minisign | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W4.5 | עדכון אוטומטי beta.1 → beta.2 עובד ב-macOS או ב-Linux, כולל בדיקת חתימה שנכשלת על קובץ שהשתנה | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.5 | pubkey לא ריק ובדיקה שנכשלת אם הוא ריק | releaseRun.test.ts 19/19 | met |
| W4.6 | דוח אחד עם ציון אמיתי לכל 14 הסוכנים, WER, p50/p95 ל-FIM, nDCG ל-pdf-chat | needs a real browser, build, device, model or the Mac run | Mac-only |
| W4.6 | 0 משימות AI בסטטוס ✅* שמבוסס על מודל מדומה בלבד, או נימוק לכל אחת | modelsDay.test.ts 14/14; plan:check refuses ✅ built on mocks (W10.G8) | met |
| W4.6 | זמן ההרצה בפועל של טל ≤ 20 דקות עבודה ידנית | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.1 | main שווה לקומיט שיש לו קבלה חתומה על כל השערים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.1 | e2e ב-chromium ‏327/327 ו-firefox מלא עובר; WebKit עובר במארח השני | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.1 | התרגיל: 0 פתקים אבודים או פגומים ב-4 הנתיבים, ו-0/36 מחיקות בדיסק מלא | the data drill runs in browsers (e2e) | Mac-only |
| W6.1 | חזרה ל-tag הקודם נבדקה ולוקחת פחות מ-5 דקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.2 | live:meta עובר על הייצור: 0 הפניות לדומיין שאינו שלנו | needs the live production site | owner-only |
| W6.2 | הבדיקה רצה אחרי כל פריסה ונכשלת כשמכניסים הפניה זרה לבדיקה עצמית | liveMetaDeploy.test.ts 6/6 | met |
| W6.2 | תוך 14 יום: חיפוש site של הדומיין הישן לא מחזיר את המוצר שלנו | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.3 | כל 8 מבחני ההתקפה ב-rr12 עוברים (t1 ×2, ‏t3, ‏t4, ‏t5, ‏t6, ‏t8), וגם rev12/r472-* | security/attacks/rr12-*.test.ts all pass (7 files, shim v4 node) | met |
| W6.3 | check_vectors.py ו-TS מסכימים על כל הווקטורים, כולל 5 הווקטורים החדשים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.3 | git merge-base מראה שאין ב-chore/release-beta1 קוד keyring מלפני התיקון | release branch rebuild is W10.E68 / owner W10.O5 | owner-only |
| W6.3 | e2eeRekeyIntegrity, ‏e2eeKeyring ו-lanSync עוברים ב-vitest אמיתי במארח השני | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.4 | dod: `node --experimental-transform-types $S/rr7/*.test.ts (r7-1..r7-5)` | the dod runs files in the scratchpad ($S/rr7), outside the repo; the same tests are in security/attacks/rr7-1..5 (all pass, shim v4) → dod fixed in the plan PR to `npx vitest run security/attacks` | partial |
| W6.4 | dod: `npx vitest run src/sync/__tests__/e2eeFifthReview.test.ts src/sync/__tests__/e2eeThirdReview.test.ts src/sync/__tests__/e2eeRekeyIntegrity.test.ts` | the three files are not in src/sync/__tests__/ but in src/__tests__/: e2eeFifthReview 16/16, e2eeThirdReview 10/10, e2eeRekeyIntegrity 15/15 (shim v4) → paths fixed in the plan PR | partial |
| W6.4 | dod: `python3 scripts/crypto/vectors.py --check` | scripts/crypto/vectors.py does not exist; the checker is scripts/sync-protocol/check_vectors.py: 51/51 vectors → dod fixed in the plan PR | missing |
| W6.4 | סוקר עצמאי כותב ״אין קריטי ואין גבוה פתוחים״ בקובץ ביקורת עם hash של הראש | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.4 | 100% ממבחני ההתקפה רצים בשער ועוברים | security/attacks: 15 files pass (shim v4); train-offline.mjs runs them (ATTACK_DIR) | met |
| W6.4 | הבקשה לביקורת חיצונית נשלחה ותשובה נרשמה בתוכנית | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.5 | 7 לילות רצופים עם קבלה חתומה לכל ראש verify/* | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.5 | e2e מלא ב-3 דפדפנים מסתיים בפחות מ-60 דקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.5 | מדחיפה לתוצאה מלאה: פחות מ-3 שעות | needs the factory host | owner-only |
| W6.5 | השאלה ״לא נבדק כי ה-Sandbox חסום״ לא מופיעה באף PR חדש | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.6 | תרגיל הנתונים ב-WebKit: ‏0 פגומים | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.6 | רשימת 15.12 רצה אוטומטית ב-Safari macOS ו-iOS, בלי מכשיר של טל | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.6 | סקריפט הקידום מסרב כשאין קבלת WebKit | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.8 | בניית Vercel: חציון ≤ 35 דקות, מקסימום ≤ 38 | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.8 | e2e מלא ב-chromium ‏327/327 בלילה | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.8 | אף בנייה לא נעצרת על מגבלת 45 הדקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.10 | דחיפה לענף שאינו main או verify/* מסתיימת ב-״Canceled by Ignored Build Step״ | the Ignored Build Step is a Vercel project setting (W10.O3) | owner-only |
| W6.10 | בשבוע הראשון: 0 בניות של ענפי PR | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.11 | 100% מה-PR-ים הרגישים ברכבות 2 ו-3 עם קבלת ביקורת על הראש | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.11 | 0 ממצאים קריטיים או גבוהים פתוחים | independentReview.test.ts 19/19; reviewCoverage.test.ts 9/9 | met |
| W6.11 | ל-PRE_AUTH של lanSync יש מבחן התקפה של ניחוש offline | lanPreAuthAttack.test.ts 6/6 | met |
| W6.12 | ה-API מחזיר enabled לשלושתם | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.12 | push protection חוסם טוקן בדיקה | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.12 | SECURITY.md מפנה לדיווח הפרטי | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.14 | 0 critical ו-0 high בראש הרכבת, ב-npm וב-cargo; ‏zip ≥ 9.1.0 | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.14 | PR-ים פתוחים של dependabot: ≤ 5 | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.14 | audit-lock, ‏cargo audit ו-cargo deny check ירוקים בקבלת הלילה | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.17 | לכל טענת איכות של AI, חיפוש ודיבור בתוכנית יש מספר מוחזק | heldout.test.ts 16/17 (the end-to-end case spawns a process the shim can't); held-out numbers exist only for the sets wired so far | partial |
| W6.17 | סריקת הזיהום: 0 פריטי test בריפו | heldout.test.ts 16/17: the contamination-scan case passes (the red one spawns a child process the shim can't) | met |
| W6.17 | יומן המעריך מראה מי ביקש ציון ומתי | heldout.test.ts 16/17: the evaluator-log case passes | met |
| W6.18 | דוח חתום ל-4 מודלים לפחות, עם digest לכל מודל | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.18 | שיעור קריאות כלים תקינות אמיתי ב-qwen2.5:7b מדווח; יעד ≥ 95%, ואם לא — הפער נרשם בכנות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.18 | ≥ 10 משימות AI עוברות מ-dodMock ל-real | needs real models in the cloud GPU run | owner-only |
| W6.21 | תוך 3 ימים מקידום main: ≤ 40 PR-ים פתוחים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.21 | 0 PR-ים נסגרו כשהקומיטים שלהם לא ב-main, חוץ מקטגוריה (ו) שאושרה | closing PRs is the owner's | owner-only |
| W6.21 | כל PR סגור עם הערה מוסברת | closing PRs is the owner's | owner-only |
| W6.25 | codeHealth רץ כבדיקה, לא todo | codeHealth.test.ts 7/7 | met |
| W6.25 | ברכבת 3: אף קובץ ב-baseline לא גדל | max-lines has no baseline now (W10.E31): node scripts/check-max-lines.mjs ✓ 1763 files, none over 800 | met |
| W6.25 | בסיום W4.11: ‏0 קבצים מעל 800 | node scripts/check-max-lines.mjs: none over 800 | met |
| W6.39 | הכלל נבדק בבדיקה עצמית (משימה חדשה נחסמת) | plan:check prints the WIP warnings; planBuild wip cases pass | met |
| W6.39 | תוך 4 שבועות: ≥ 80% מ-P0/P1 ב-browser או real | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W6.39 | 0 PR-ים חדשים של גל 5 בתקופת ההקפאה | a process rule over time | owner-only |
| W6.43 | בבינארי המשוחרר pubkey לא ריק ו-endpoints מוגדר | the released binary (W10.O5) | owner-only |
| W6.43 | התרגיל beta.1 → beta.2 עובר ב-macOS וב-Windows | needs a real browser, build, device, model or the Mac run | Mac-only |
| W6.43 | repro-check: שתי בניות זהות בבייט | two real Tauri builds | Mac-only |
| W6.43 | אין בענף קוד keyring מלפני התיקון (merge-base) | git merge-base: feat/sync-crypto head is in the train (W10.D5) | met |
| W6.43 | E2EE כבוי כברירת מחדל ומסומן ״לא עבר ביקורת אבטחה חיצונית״ (W11.S1) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W9.2 | שלוש הרכבות ירוקות בכל השערים | the Mac run | Mac-only |
| W9.2 | קבלות build נשמרות | the Mac run | Mac-only |
| W9.4 | review:coverage ‏100% על רכבת 5 | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W9.9 | verify/train-6 עובר כל שער לא מקוון | of the 140 P0 test files run here, 21 are not green: 5 code reds fixed in #951–#954; secretsScanLive (allow-list, owner), helpCoverage (W3.7, not P0); 3 timing cases on a loaded machine; 11 shim-only (stubbed packages, snapshots, spawn) | partial |
| W9.9 | 0 PR קוד פתוח שאינו בתוך הרכבת או מסומן כמוחלף | open-PR inventory: npm run train:missing (W10.F7) needs gh | owner-only |
| W10.A1 | tsc: 0 שגיאות TS2305 | BASES_MAX_LENGTH exported again (src/views/bases/evaluate.ts:39); full tsc -b only on the Mac (memory) | Mac-only |
| W10.A1 | obsidian115.test.ts 14/14 | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.A1 | ב-Mac: ‏npm ci && npx tsc -b מחזיר 0 שגיאות ו-npm run build יוצא 0 (W10.M1) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.A2 | 3 הקבצים נטענים ועוברים ב-shim (firstRunLanguage 6/6, ‏israeliTemplates 35/35, ‏pdfHebrew 12/12) | firstRunLanguage.test.ts 6/6, israeliTemplates.test.ts 35/35, pdfHebrew.test.ts 13/13 | met |
| W10.A2 | 0 הפניות לנתיב הישן | git grep locales/he.json in src/scripts: only ci-doctor fixtures and their test (logs quoted on purpose) | met |
| W10.A3 | readingFonts.test 14/14 | readingFonts.test.ts 13/14: the Frank Ruhl Libre file is missing from the node_modules overlay (lockfile has @fontsource/frank-ruhl-libre 5.3.0); npm ci on the Mac | Mac-only |
| W10.A3 | הסטטוס של W3.5 תואם את מספר הגופנים שעוברים | depends on #0's real run | Mac-only |
| W10.A4 | hebrewLexicon 13/13, ‏respectfulMessages ירוק, ‏bookEpub ירוק ב-shim | hebrewLexicon.test.ts 12/13 (browser): the ≤20 ms timing case fails here (46–187 ms on this machine); respectfulMessages and bookEpub.test.ts 5/5 (browser) green | partial |
| W10.A4 | 0 בדיקות תזמון קשיחות ב-unit | hebrewLexicon.test.ts still holds a hard timing bound in a unit test (the case above); not changed here: removing it would weaken a test — owner/coordinator to move it to the bench | partial |
| W10.A5 | 0 waitForTimeout בלי hygiene-allow | git grep waitForTimeout -- e2e without hygiene-allow: 0 | met |
| W10.A5 | 0 retries בכל קונפיג Playwright | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.A6 | skipAudit 7/7 על הרכבת | skipAudit.test.ts 6/7: 36 violations → fixed in #952 (7/7, 0 violations, e2e 13 ≤ 15) | partial |
| W10.A6 | 0 דילוגים בלי סיבה | same; fixed in #952 | partial |
| W10.A7 | 0 catch ריקים בלי why: בתיקיות האלה | eslintEmptyCatchWhy.test.ts 18/18; codeHealth.test.ts 7/7 | met |
| W10.A8 | codeHealth.test ירוק על הרכבת | codeHealth.test.ts 7/7 | met |
| W10.A8 | 0 catch שקטים ב-storage ו-sync | codeHealth.test.ts 7/7 | met |
| W10.A9 | settingsSchema.test 6/6 | settingsSchema.test.ts 4/6: 20 keys missing + 1 false stale → fixed in #951 (6/6) | partial |
| W10.A9 | ייצוא הגדרות לא מכיל אף ערך secret | settingsIo.test.ts 11/11 (secrets never exported) | met |
| W10.A10 | settingsScreen.test ירוק | settingsScreen.test.tsx 13/13 | met |
| W10.A10 | 0 מפתחות גולמיים בלשוניות ב-he וב-en | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.A11 | npm run flags:check יוצא 0 על הרכבת | npm run flags:check exit 0 (4 flags) | met |
| W10.A11 | דגל בלי מחרוזת עדיין נכשל | flagsCheck.test.ts 2/2 | met |
| W10.A12 | 0 אירועי delete כשהשורש לא נקרא | externalChanges.test.ts 21/21 | met |
| W10.A12 | externalChanges וה-watcher ירוקים ב-shim | externalChanges.test.ts 21/21; src/__tests__/watcher.test.ts named in the task does not exist (the watcher cases live in externalChanges) | partial |
| W10.A13 | הבדיקה ירוקה או מתועדת כ-artefact עם הוכחה | externalChanges.test.ts 21/21 | met |
| W10.A14 | קבלה ירוקה על הרכבת עם 0 אדומים ידועים | train:offline's receipt for a head needs the full install (W10.M1) | Mac-only |
| W10.A14 | קבלה לא נכתבת כשאחד השערים נכשל | scripts/train-offline.mjs; securityAttacksGate.test.ts 5/5 | met |
| W10.A14 | ייבוא שבור בכוונה מכשיל את train:offline תוך ≤ 90 שניות | timed run of train:offline | Mac-only |
| W10.B1 | 0 קוד ״simulate״ בנתיב ההתקנה | src/plugins/registryTrust.ts: the only mention is the doc comment of what was removed; pluginGallery.test.tsx 11/11 | met |
| W10.B1 | תוסף מרוחק לא מותקן בלי חבילה וחתימה | pluginSignedInstall.test.ts 7/8: the refusal cases (no package, bad signature, changed hash) pass; the red one runs the plugin in QuickJS, stubbed in the shim (Mac) | met |
| W10.B1 | git grep "simulate the install" ריק | git grep: 0 in src; only MASTER_PLAN.md and plan/board.html quote the acceptance text | met |
| W10.B1 | e2e ב-Chromium, ב-Firefox וב-WebKit: חבילה ששונתה נכשלת עם הודעה גלויה | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.B2 | 0 תגי ״מאומת״ בלי חתימה תקפה | pluginGallery.test.tsx 11/11; pluginRegistry.test.ts 7/7 | met |
| W10.B2 | e2e: אף רשומה בלי חתימת Ed25519 תקפה לא מציגה ״מאומת״, בשלושה דפדפנים | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.B12 | plan:check: 0 ✅ על משימה שהביקורת סיווגה PARTIAL/NOT DONE/FAKED | plan:check (claimGuard, W10.G8 checkDoneLevel) exit 0 | met |
| W10.B12 | כל שינוי מצטט את שורת הביקורת | plan notes cite the audit lines (status/notes of the 12 tasks) | met |
| W10.B17 | 3.7 עם dod | 3.7 has a dod (node scripts/dod.mjs --list) | met |
| W10.B17 | G3 לא מדולג בשקט | dataSafetyMatrix.test.ts 15/15 | met |
| W10.C12 | 0 קריאות writeWorkspaceFile מסוכנים | writeWorkspaceFile only in agents/staging.ts and mcpInbox.ts (the staged path); agentsUseTools.test.ts 105/105 | met |
| W10.C12 | eval של 5.3: 0 כתיבות לא מאושרות | agentsUseTools.test.ts 105/105 | met |
| W10.C12 | ריצת builder על 5 קבצים: 5/5 ב-AgentReviewPanel | the builder run through AgentReviewPanel needs a model | Mac-only |
| W10.C12 | החזרת קריאה ישירה מפילה את הבדיקה | agentsUseTools.test.ts 105/105 | met |
| W10.C29 | כל נתיב פריסה מריץ את הבדיקה | liveMetaDeploy.test.ts 6/6 | met |
| W10.C30 | 0 מופעים בעץ | git grep for the taken domain: 0 | met |
| W10.C30 | מופע חדש נכשל | takenDomain.test.ts 5/5 | met |
| W10.D2 | 0 קוד צד שלישי שרץ במקור של האפליקציה | blind/blindContentFrameDom.test.ts 5/5 | met |
| W10.D2 | e2e בשלושה דפדפנים (W10.M1): ‏HTML עוין, ‏gist ו-URL ישיר ל-content-frame לא קוראים localStorage או IndexedDB | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.D3 | קבלה לא חתומה לא עוברת | independentReview.test.ts 19/19 | met |
| W10.D3 | humanReview ירוק | humanReview cases in independentReview.test.ts 19/19 | met |
| W10.D3 | מטריצה 8/8: זר, מחבר, ראש ישן, לא חתום, תקין ו-3 זיופים | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.D4 | כל PR מקבל pr:check בלי שמישהו מריץ ידנית | Buildkite/Vercel run pr:check; vercelIgnore.test.ts 12/12, ciLocal.test.ts 17/17 | Mac-only |
| W10.D4 | PR עם בדיקה אדומה מקבל כשלון ב-Vercel | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.D5 | ראש feat/sync-crypto הוא אב של הרכבת | git merge-base --is-ancestor feat/sync-crypto head → train (status #632) | met |
| W10.D5 | כל בדיקות e2ee ירוקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.D6 | security/attacks קיים ורץ בשער | security/attacks/ (15 files) pass; securityAttacksGate.test.ts 5/5 | met |
| W10.D6 | dodMock של W6.4 מוסר | W6.4 still has dodMock: true and its dod points outside the repo ($S/rr7, scripts/crypto/vectors.py) → dod fixed in the plan PR (fix/t8-z3-plan); dodMock stays (W6.4 is owner-reviewed) | partial |
| W10.D7 | כל ממצא קריטי מ-12.11 עם מבחן ירוק בריפו | security/attacks rr12-t1..t8b and rr7-1..5 pass | met |
| W10.D9 | audit-lock אדום על ה-lock הנוכחי וירוק אחרי העדכון | updaterAntiDowngrade.test.ts 4/4; audit-lock on Cargo.lock needs cargo update (W10.M3) | Mac-only |
| W10.D9 | zip ≥ 9.1.0 ב-Cargo.lock (9.0.5 מוסיף בדיקות שכבויות כברירת מחדל) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.D9 | cargo deny check advisories bans ירוק; ‏osv-scanner ‏0 critical בשני קובצי הנעילה (ב-W10.M3) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.D10 | #499 אב של הרכבת | status: #499 folded (#670) | met |
| W10.D10 | 0 ייעוצים high/critical ב-npm lock | npm audit needs the network/full install | Mac-only |
| W10.D14 | כל PR מקבל את 3 הבדיקות ב-Buildkite | securityScanners.test.ts 8/8; runs in Buildkite | Mac-only |
| W10.D15 | ערוץ דיווח שעובד היום | securityChannels.test.ts 5/5 | met |
| W10.E1 | pipeline.ts לא מריץ unified ב-main thread כש-worker זמין | renderWorker.test.ts 1/11 here: remark/rehype are stubbed in the shim; real vitest on the Mac | Mac-only |
| W10.E1 | snapshot זהה בין worker ל-fallback על 40 ה-fixtures | same set as 8.1: 96 ≠ 50 → #954; per-document snapshots on the Mac | partial |
| W10.E2 | 0 קריאות Shiki/KaTeX ב-main thread | renderWorker.test.ts 1/11 here (remark/rehype stubbed); real vitest on the Mac | Mac-only |
| W10.E2 | snapshot זהה | same set as 8.1 → #954; per-document snapshots on the Mac | partial |
| W10.E3 | הבלוק הראשון מצויר לפני סיום הפתק | viewportPreview.test.ts 3/7 here (remark stubbed); real vitest on the Mac | Mac-only |
| W10.E3 | TBT < 300ms — נמדד ב-Mac | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E5 | Modal.tsx קיים ו-13+ דיאלוגים עליו | dialogsModal.test.tsx 28/28; modal.test.tsx 9/9 | met |
| W10.E5 | aria-labelledby חסר = שגיאת טיפוס | a type error: needs tsc -b on the Mac | Mac-only |
| W10.E6 | 13 דיאלוגים עם trap ובדיקה | modalTraps.test.ts 4/4; useFocusTrap.test.tsx 10/10 | met |
| W10.E7 | 13 דיאלוגים עם trap ובדיקה | modalTraps.test.ts 4/4 | met |
| W10.E8 | ה-lint אדום על aria-modal מחוץ לרכיב | eslintModalOnly.test.ts 9/9 | met |
| W10.E8 | 65/65 עוברים ב-Chromium, ‏Firefox ו-WebKit, בעברית ובאנגלית (W10.M1) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E8 | axe: ‏0 serious ו-0 critical | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E9 | 0 ספים רפויים מהתוכנית | perfGate.test.ts 15/15 | met |
| W10.E9 | השער יהיה אדום עד ש-E1–E3 ו-E19 נכנסים — זה המצב הכנה | perf-gate.config.json thresholds per plan; perfGate.test.ts 15/15 | met |
| W10.E9 | 0 בקשות ל-storage.googleapis.com בזמן הריצה | perfGate.test.ts 15/15 | met |
| W10.E9 | PR שמוסיף 150KB לטעינה המיידית נכשל בשער | perfGate.test.ts 15/15 | met |
| W10.E10 | כל PR מקבל מספר Lighthouse | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E10 | 3 ריצות PR רצופות ירוקות | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E12 | ingest על תוצאות לדוגמה מעדכן measured ו-defaults | evalIngest.test.ts 9/9 | met |
| W10.E12 | תוצאה בלי קבלה נדחית | evalIngest.test.ts 9/9 | met |
| W10.E33 | אין תלות ב-.github/workflows | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.E33 | מפתח מטמון = digest | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.E39 | main לא מתקדם בלי קבלה | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.E39 | רסיס < 10 דק׳ | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E68 | ענף השחרור מכיל את ראש feat/sync-crypto | status: release-beta1 r3 on train 6 with the crypto head | met |
| W10.E68 | publish עם placeholder נכשל | releasePublishRefusal.test.ts 3/3 | met |
| W10.E68 | בבנייה: ‏E2EE כבוי כברירת מחדל ומסומן ״לא עבר ביקורת אבטחה חיצונית״ (W11.S1) | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.E68 | latest.json.sig נוצר ומאומת (W11.S3) | updaterManifestSig.test.ts 18/18 | met |
| W10.F1 | 0 commits של verify/train שאינם אבות של רכבת 6, או החלטה כתובה לכל אחד | status #626 et al.; trainMissing.test.ts 7/7 | met |
| W10.F2 | שער ה-preview < 38 דק׳ בחישוב | needs a real browser, build, device, model or the Mac run | Mac-only |
| W10.F3 | הבדיקה קיימת ברכבת | scripts/check-vercel-ignore.mjs exists; vercelIgnore.test.ts 12/12 | met |
| W10.F4 | ראש #235 אב של הרכבת | src/storage/vault/move.ts in the train (status #635) | met |
| W10.F5 | #566 אב של הרכבת | status #626 | met |
| W10.F6 | #265 אב של הרכבת | scripts/dod.mjs in the train; dod.test.ts 15/15 | met |
| W10.F7 | 0 ראשי PR בלי החלטה | trainMissing.test.ts 7/7; plan/train-missing.json | met |
| W10.F14 | origin/verify/train-6 קיים מבסיס train-5 | origin/verify/train-6 exists (git) | met |
| W10.G1 | 13 המשימות עם dod או ⏳ | plan:check (checkDod) exit 0 | met |
| W10.G2 | 13 המשימות עם dod או ⏳ | plan:check (checkDod) exit 0 | met |
| W10.G3 | 13 המשימות עם dod או ⏳ | plan:check (checkDod) exit 0 | met |
| W10.G4 | 13 המשימות עם dod או ⏳ | plan:check (checkDod) exit 0 | met |
| W10.G5 | 0 משימות פטורות | scripts/dod.mjs refuses dodGrandfathered; migrateEvidence.test.ts 6/6 | met |
| W10.G6 | ברירת מחדל קפדנית | --wip-strict is still opt-in (plan:check prints 5 WIP warnings, exit 0); status: on after train 6 — coordinator's switch | partial |
| W10.Z1 | קבלה ירוקה על ראש רכבת 6 | train:offline receipt on the head (W10.M1) | Mac-only |
| W10.Z2 | כיסוי 100% (קבלות ממתינות לחתימה מסומנות) | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W10.Z3 | 0 P0 אדומים מסיבת קוד | this table: the code reds found are fixed in #951–#954 and W6.4's dod in the plan PR (none merged yet); open: 5.5 (3 direct executor calls), W10.A4 (timing bound in a unit test), the VITE_ allow-list entry (owner) | partial |
| W10.M1 | קבלה חתומה reports/mac-<sha>.json | the Mac run | Mac-only |
| W10.M3 | audit-lock ירוק, ‏tauri build מצליח | a Mac task | Mac-only |
| W10.O1 | ה-API מחזיר enabled לשלושת מאפייני האבטחה | an owner task (בעלים) | owner-only |
| W10.O1 | דחיפה של טוקן בדיקה נחסמת; דחיפה ישירה ל-main נדחית | GitHub settings (W10.O1) | owner-only |
| W10.O1 | בדיקת סחיפת ה-ruleset ירוקה | githubRuleset.test.ts 10/10 | met |
| W10.O2 | כיסוי 100% חתום | an owner task (בעלים) | owner-only |
| W10.O3 | הבדיקה ירוקה | Vercel project setting | owner-only |
| W10.O4 | main = רכבת 6 | an owner task (בעלים) | owner-only |
| W10.O5 | עדכון אוטומטי עבד | an owner task (בעלים) | owner-only |
| W10.O5 | הורדת גרסה נדחתה | an owner task (בעלים) | owner-only |
| W10.O5 | spctl -a -vv מאשר ב-macOS; ‏changelog ציבורי בעברית | an owner task (בעלים) | owner-only |
| W11.I1 | 0 seams יתומים שאינם ברשימת ההיתרים | liveSeams.test.ts 7/8: the tree passes (exit 0) | met |
| W11.I1 | seam יתום שנשתל ב-fixture מפיל את הבדיקה | liveSeams.test.ts 7/8: the planted-orphan case passes | met |
| W11.I1 | רשומת היתר שפג תוקפה מפילה את הבדיקה | liveSeams.test.ts 7/8: the expired-entry case passes | met |
| W11.I1 | הבדיקה רצה בפחות מ-5 שניות | liveSeams.test.ts: the < 5 s case took 10.1 s on this machine with 5 test runners in parallel; a quiet machine (the Mac run) | Mac-only |
| W11.S1 | git grep לא מוצא תיאור של הקריפטו כמבוקר | securityPageAudit.test.ts 4/4 | met |
| W11.S1 | התווית מוצגת במסך ההפעלה בשתי השפות (בדיקת רינדור) | e2eeUnaudited.test.tsx 23/23 | met |
| W11.S1 | הגדרות ברירת המחדל: e2ee=false בכל ערוץ | needs a real browser, build, device, model or the Mac run | Mac-only |
| W11.S2 | בדיקת יחידה: manifest עם גרסה ישנה וחתימת בינארי תקינה נדחה | updaterAntiDowngrade.test.ts 4/4 | met |
| W11.S2 | latest.json.sig פגום נדחה | updaterManifestSig.test.ts 18/18 | met |
| W11.S2 | snapshot של capabilities: ‏0 הרשאות updater ב-webview | src-tauri capability snapshot (not touched here); updaterManifestSig.test.ts 18/18 | met |
| W11.S3 | בדיקה: פרסום בלי .sig נכשל | updaterManifestSig.test.ts 18/18 | met |
| W11.S3 | בדיקה: חתימה שמאומתת בצד ה-Rust של W11.S2 | the Rust side compiles with rustc (skipped without it) | Mac-only |
| W11.S4 | בדיקה: ההבדל בין הקובץ לתשובת API לדוגמה מזוהה | githubRuleset.test.ts 10/10 | met |
| W11.S4 | הקובץ עובר JSON schema של rulesets | githubRuleset.test.ts 10/10 | met |
| W11.S4 | ההחלה בשרת — W10.O1 | needs the owner's accounts, keys, settings or time (outside the cloud) | owner-only |
| W11.L1 | launch:gate -- M0 נכשל כשחסרה קבלה | launchGate.test.ts 24/24 | met |
| W11.L1 | בדיקה: קריטריון בלי קבלה לא נחשב עבר | launchGate.test.ts 24/24 | met |
| W11.L4 | launch:gate -- M0 ירוק | an owner task (בעלים) | owner-only |
| W11.L4 | beta.1 מותקן ומתעדכן על ה-Mac | an owner task (בעלים) | owner-only |
