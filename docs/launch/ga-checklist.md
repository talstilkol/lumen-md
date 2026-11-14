<!-- Built from docs/launch/milestones.json by `npm run launch:gate -- --checklist`. Do not edit by hand: `--check` fails when this file differs. -->

# Launch checklist: M1–M4 and 1.0 GA / רשימת השקה

Each item is a criterion in `docs/launch/milestones.json`. It names the plan acceptance it maps to and the receipt that proves it (`docs/launch/receipts/<milestone>/<criterion>.json`). `npm run launch:gate -- <milestone>` prints every open item. A box is ticked only by a valid receipt, never by hand.

כל פריט הוא קריטריון ב-`docs/launch/milestones.json`, עם קבלת התוכנית שהוא ממופה אליה והקבלה שמוכיחה אותו. `npm run launch:gate -- <אבן דרך>` מדפיס כל פריט פתוח.

## M0: Honest beta.1 / בטא כנה: beta.1

Target: 2026-12-07.

- [ ] **no-simulated-plugin-install**: 0 fake trust UI: installing a remote plugin without a signed package adds nothing and shows no success.
  - ‏0 ממשק אמון מזויף: התקנת תוסף מרוחק בלי חבילה חתומה לא מוסיפה כלום ולא מציגה הצלחה.
  - Source: W10.B1: תוסף מרוחק לא מותקן בלי חבילה וחתימה; 0 קוד ״simulate״ בנתיב ההתקנה
  - Proof: test: `src/__tests__/pluginGallery.test.tsx`
- [ ] **no-unearned-verified-badge**: 0 fake trust UI: no "Verified" badge without a valid signature against the pinned key.
  - ‏0 ממשק אמון מזויף: אין תג ״מאומת״ בלי חתימה תקפה מול המפתח המוצמד.
  - Source: W10.B2: 0 תגי ״מאומת״ בלי חתימה תקפה
  - Proof: test: `src/__tests__/pluginGallery.test.tsx`
- [ ] **e2ee-off-and-labelled**: E2EE is off by default in every channel and labelled "experimental, not externally audited" in Hebrew and English; nothing calls the crypto audited.
  - ‏E2EE כבוי כברירת מחדל בכל ערוץ ומסומן ״ניסיוני — לא עבר ביקורת אבטחה חיצונית״ בעברית ובאנגלית; שום מקום לא מתאר את הקריפטו כמבוקר.
  - Source: W11.S1: הגדרות ברירת המחדל: e2ee=false בכל ערוץ; התווית מוצגת במסך ההפעלה בשתי השפות; git grep לא מוצא תיאור של הקריפטו כמבוקר
  - Proof: test: `src/__tests__/e2eeUnaudited.test.ts`
- [ ] **ttfv-e2e-three-browsers**: The TTFV e2e is green on a production build without network in Chromium, Firefox and WebKit: TTFV-1 ≤ 2 s p75 and the first note ≤ 4 s.
  - בדיקת ה-e2e של TTFV ירוקה על build ייצור בלי רשת ב-Chromium, ב-Firefox וב-WebKit: ‏TTFV-1 ≤ 2 ש׳ p75 ופתק ראשון ≤ 4 ש׳.
  - Source: W11.P5: TTFV-1 ≤ 2 ש׳ p75 ופתק ראשון ≤ 4 ש׳ ב-3 דפדפנים (ב-W11.M7)
  - Proof: run: `ttfv-chromium`, `ttfv-firefox`, `ttfv-webkit`
- [ ] **beta1-signed-and-updates**: 0.2.0-beta.1 is signed, its signature verifies, it installs on the Mac and auto-updates to the next beta.
  - ‏0.2.0-beta.1 חתום, החתימה מאומתת, הוא מותקן על ה-Mac ומתעדכן אוטומטית לבטא הבאה.
  - Source: W10.O5: עדכון אוטומטי עבד
  - Proof: owner facts: `version`, `releaseVerify`, `installedOn`, `autoUpdatedTo`

## M1: Private Hebrew beta (50) / בטא עברית סגורה (50)

Target: 2027-01-15. Opens after M0 passes.

- [ ] **activation-and-d7**: Activation ≥ 50% and D7 ≥ 30%, from the weekly opt-in beta reports.
  - הפעלה ≥ 50% ו-D7 ≥ 30%, מהדוחות השבועיים של הבטא בהסכמה.
  - Source: W11.L5: הפעלה ≥ 50%, ‏D7 ≥ 30%
  - Proof: metric (beta-reports): `activationRate` ≥ 0.5; `d7` ≥ 0.3
- [ ] **fifty-testers-a-week-in**: 50 beta testers who have been in the beta at least a week sent a report.
  - ‏50 בודקי בטא שנמצאים בבטא לפחות שבוע שלחו דוח.
  - Source: W6.31: 50 בודקי בטא פעילים 7 ימים
  - Proof: metric (beta-reports): `testersWeek1` ≥ 50
- [ ] **zero-data-loss-reports**: 0 data-loss reports from the beta.
  - ‏0 דיווחי אובדן נתונים מהבטא.
  - Source: W11.L5: 0 דיווחי אובדן נתונים
  - Proof: metric (owner): `dataLossReports` ≤ 0
- [ ] **unmoderated-ten-of-twelve**: At least 10 of 12 unmoderated tests finish the first run and an import without help.
  - לפחות 10 מתוך 12 בדיקות לא מונחות מסיימות ריצה ראשונה וייבוא בלי עזרה.
  - Source: W11.L5: ≥ 10/12 מסיימים ריצה ראשונה וייבוא בלי עזרה
  - Proof: metric (owner): `unmoderatedTests` ≥ 12; `finishedWithoutHelp` ≥ 10

## M2: Public Hebrew beta (300–1,000) / בטא עברית פתוחה (300–1,000)

Target: 2027-02-28. Opens after M1 passes.

- [ ] **three-hundred-and-d30**: At least 300 opt-in users, and D30 ≥ 15%.
  - לפחות 300 משתמשים בהסכמה, ו-D30 ≥ 15%.
  - Source: W11.L6: ≥ 300 משתמשים בהסכמה; ‏D30 ≥ 15%
  - Proof: metric (beta-reports): `optInUsers` ≥ 300; `d30` ≥ 0.15
- [ ] **real-exports-eighteen**: 18/18 real exports pass npm run import:diff.
  - ‏18/18 ייצואים אמיתיים עוברים את npm run import:diff.
  - Source: W11.L6: 18/18 ייצואים אמיתיים עוברים את import:diff
  - Proof: metric (owner): `exportsPassed` ≥ 18; `exportsFailed` ≤ 0
- [ ] **mobile-capture-three-seconds**: Phone capture, Lock Screen to saved, ≤ 3 s p95 over at least 20 tries.
  - לכידה בטלפון, ממסך הנעילה לשמירה, ≤ 3 ש׳ p95 בלפחות 20 ניסיונות.
  - Source: W11.M10: ממסך הנעילה לשמירה ≤ 3 ש׳ p95 ב-20 ניסיונות
  - Proof: metric (owner): `captureTries` ≥ 20; `captureP95Ms` ≤ 3000

## M3: Global launch / השקה גלובלית

Target: 2027-03-31. Opens after M2 passes.

- [ ] **comparison-twenty-of-twenty**: The comparison page has 20/20 claims with a source, or fewer claims.
  - לדף ההשוואה 20/20 טענות עם מקור, או פחות טענות.
  - Source: W10.B22: 20/20 עם מקור, או פחות טענות
  - Proof: metric (owner): `claimsWithoutSource` ≤ 0
- [ ] **external-audit-commissioned**: An external security audit of the sync protocol and the keyring is commissioned.
  - ביקורת אבטחה חיצונית לפרוטוקול הסנכרון ול-keyring הוזמנה.
  - Source: W11.O6: הביקורת הוזמנה לפני M3
  - Proof: owner facts: `auditor`, `commissionedOn`, `scope`
- [ ] **store-privacy-labels-submitted**: The store privacy labels are submitted (App Store and Google Play).
  - תוויות הפרטיות הוגשו לחנויות (App Store ו-Google Play).
  - Source: W11.O7: התוויות הוגשו ואושרו
  - Proof: owner facts: `appStoreLabelSubmitted`, `playDataSafetySubmitted`

## M4: Full launch (1.0 GA) / השקה מלאה (1.0 GA)

Target: 2027-05-31. Opens after M3 passes.

- [ ] **stores-in-production**: iOS is on the App Store and Android on Google Play production, not only TestFlight or internal tracks.
  - ‏iOS ב-App Store ו-Android ב-Google Play בייצור, לא רק TestFlight או מסלול פנימי.
  - Source: W10.O7: הגשות נשלחו
  - Proof: owner facts: `appStoreVersion`, `playProductionVersion`
- [ ] **pricing-page-live**: The pricing page is live: free and MIT forever, payment buttons off until a provider exists, gates on hosted services only.
  - דף התמחור באוויר: חינם ו-MIT לתמיד, כפתורי התשלום כבויים עד שיש ספק, שערים רק על שירותים מתארחים.
  - Source: W11.P12: בדיקה: אין כפתור תשלום פעיל בלי ספק מוגדר
  - Proof: test: `src/__tests__/pricingPage.test.ts`, `src/__tests__/billingGatesHostedOnly.test.ts`
- [ ] **audit-report-or-unaudited-label**: Until an external audit report is published in full, E2EE stays off and labelled unaudited.
  - עד שדוח ביקורת חיצונית מתפרסם במלואו, ‏E2EE כבוי ומסומן כלא מבוקר.
  - Source: W11.O6: עד שהדוח מתפרסם — E2EE כבוי ומסומן (W11.S1)
  - Proof: test: `src/__tests__/e2eeUnaudited.test.ts`

## GA: 1.0 GA exit checklist / רשימת היציאה של 1.0 GA

Opens after M4 passes.

**Product**

- [ ] **desktop-signed-update-rollback**: Desktop builds are signed (macOS notarized, Windows, Linux), and auto-update is drilled, rollback included.
  - בניות שולחן העבודה חתומות (macOS עם notarization, ‏Windows, ‏Linux), ותרגיל העדכון האוטומטי עבר, כולל חזרה לאחור.
  - Source: W6.43 (R6 §5): התרגיל beta.1 → beta.2 עובר ב-macOS וב-Windows
  - Proof: owner facts: `macNotarized`, `windowsSigned`, `linuxSigned`, `updateDrill`, `rollbackDrill`
- [ ] **stores-and-pwa-live**: iOS on the App Store and Android on Google Play production; the PWA is live on lumen-md.vercel.app.
  - ‏iOS ב-App Store ו-Android ב-Google Play בייצור; ה-PWA באוויר ב-lumen-md.vercel.app.
  - Source: W10.O7 (R6 §5): הגשות נשלחו
  - Proof: owner facts: `appStoreVersion`, `playProductionVersion`, `pwaLive`
- [ ] **ttfv1-cold-p75**: TTFV-1 ≤ 2 s p75 cold, on a production build with no network, in Chromium, Firefox and WebKit.
  - ‏TTFV-1 ≤ 2 ש׳ p75 בפתיחה קרה, על build ייצור בלי רשת, ב-Chromium, ב-Firefox וב-WebKit.
  - Source: W11.P5 (R6 §5): TTFV-1 ≤ 2 ש׳ p75 ופתק ראשון ≤ 4 ש׳ ב-3 דפדפנים (ב-W11.M7)
  - Proof: run: `ttfv-chromium`, `ttfv-firefox`, `ttfv-webkit`
- [ ] **unmoderated-first-note-sixty-seconds**: In 12 unmoderated tests the median time to the user's own first note is ≤ 60 s, and the median SUS is ≥ 75.
  - ב-12 בדיקות לא מונחות הזמן החציוני עד הפתק הראשון של המשתמש ≤ 60 ש׳, ו-SUS החציוני ≥ 75.
  - Source: W6.31 (R6 §5): 12 בדיקות הושלמו; ‏SUS חציוני ≥ 75
  - Proof: metric (owner): `unmoderatedTests` ≥ 12; `medianFirstOwnNoteSeconds` ≤ 60; `susMedian` ≥ 75
- [ ] **hebrew-first-run-no-english**: A he-IL first run shows 0 English strings.
  - הפעלה ראשונה ב-he-IL מציגה 0 מחרוזות באנגלית.
  - Source: W4.35 (R6 §5): 0 מחרוזות אנגליות בהפעלה הראשונה בעברית
  - Proof: test: `src/__tests__/hebrewFirstLoad.test.ts`
- [ ] **importers-real-exports**: Notion, Evernote, Obsidian, Apple Notes, Google Keep and OneNote pass 18/18 real exports: 100% notes and files, ≥ 99% links, each within 1% of Obsidian Importer.
  - ‏Notion, ‏Evernote, ‏Obsidian, ‏Apple Notes, ‏Google Keep ו-OneNote עוברים 18/18 ייצואים אמיתיים: ‏100% פתקים וקבצים, ‏≥ 99% קישורים, כל אחד בטווח 1% מ-Obsidian Importer.
  - Source: W11.M12 (R6 §5): 18/18: ‏100% פתקים וקבצים, ‏≥ 99% קישורים, ‏0 ג׳יבריש
  - Proof: metric (owner): `exportsPassed` ≥ 18; `exportsFailed` ≤ 0; `linkRate` ≥ 0.99; `maxDiffVsOracle` ≤ 0.01
- [ ] **mobile-capture-shares-kills**: Mobile capture ≤ 3 s p95; 100/100 shares land with their source; 0 captures lost when the app is killed.
  - לכידה בטלפון ≤ 3 ש׳ p95; ‏100/100 שיתופים מגיעים עם המקור; ‏0 לכידות אבודות בהריגת האפליקציה.
  - Source: W11.M10 (R6 §5): 100/100 שיתופים עם המקור; ‏0 לכידות אבודות בהריגה
  - Proof: metric (owner): `captureP95Ms` ≤ 3000; `sharesLanded` ≥ 100; `capturesLostOnKill` ≤ 0
- [ ] **data-safety-drills**: 0 open data-loss bugs; the data-safety and sync-conflict drills pass; export to plain Markdown round-trips.
  - ‏0 באגים פתוחים של אובדן נתונים; תרגילי בטיחות הנתונים והתנגשות הסנכרון עוברים; ייצוא ל-Markdown פשוט חוזר זהה.
  - Source: W4.33 (R6 §5): 0 אובדן נתונים בכל התרחישים
  - Proof: test: `src/__tests__/dataSafetyMatrix.test.ts`, `src/__tests__/mdRoundTrip.test.ts`
- [ ] **zero-open-data-loss-bugs**: 0 open data-loss bugs in the tracker.
  - ‏0 באגים פתוחים של אובדן נתונים במעקב.
  - Source: W4.33 (R6 §5): 0 אובדן נתונים בכל התרחישים
  - Proof: metric (owner): `openDataLossBugs` ≤ 0
- [ ] **vault-10k-and-crash-free**: A 10,000-note vault opens in ≤ 3 s on the Mac, and crash-free sessions are ≥ 99.5% in the beta.
  - כספת של 10,000 פתקים נפתחת ב-≤ 3 ש׳ על ה-Mac, ושיעור ההפעלות בלי קריסה בבטא ≥ 99.5%.
  - Source: W11.L8 (R6 §5): launch:gate -- GA ירוק בכל הפריטים
  - Proof: metric (owner): `vault10kOpenMs` ≤ 3000; `crashFreeSessions` ≥ 0.995
**Trust**

- [ ] **e2ee-audit-or-unaudited**: An external audit is published in full with open findings listed, or E2EE ships off and labelled unaudited; no "audited" claim without a report.
  - ביקורת חיצונית מתפרסמת במלואה עם הממצאים הפתוחים, או ש-E2EE יוצא כבוי ומסומן כלא מבוקר; אין טענת ״מבוקר״ בלי דוח.
  - Source: W11.S1 (R6 §5): git grep לא מוצא תיאור של הקריפטו כמבוקר
  - Proof: test: `src/__tests__/e2eeUnaudited.test.ts`
- [ ] **crypto-vectors-pass**: Crypto primitives come from audited libraries, and the test vectors pass 100%.
  - הפרימיטיבים הקריפטוגרפיים מספריות מבוקרות, ווקטורי הבדיקה עוברים ב-100%.
  - Source: W1.7 (R6 §5): 100% מוקטורי הבדיקה מפוענחים זהה במימוש הבדיקה העצמאי
  - Proof: test: `src/__tests__/e2eeVectors.test.ts`
- [ ] **store-labels-no-data-collected**: App Store label "Data Not Collected"; Play Data safety: no data collected or shared; both approved.
  - תווית App Store ״Data Not Collected״; ‏Play Data safety: אין איסוף ואין שיתוף; שתיהן אושרו.
  - Source: W11.O7 (R6 §5): התוויות הוגשו ואושרו
  - Proof: owner facts: `appStoreDataNotCollected`, `playNoDataCollectedOrShared`
- [ ] **network-calls-mapped**: 100% of network calls are mapped in the privacy log; the gate fails on an unmapped call.
  - ‏100% מקריאות הרשת ממופות ביומן הפרטיות; השער נכשל על קריאה שלא ממופה.
  - Source: W11.S13 (R6 §5): השער נכשל על קריאת רשת שלא ממופה
  - Proof: run: `privacy-network-map`
- [ ] **relay-transparency-and-disclosure**: Relay transparency report v1 is published, and SECURITY.md has a disclosure process.
  - דוח השקיפות v1 של הממסר פורסם, ו-SECURITY.md כולל תהליך דיווח.
  - Source: W11.S13 (R6 §5): הטיוטות נבנות; ההגשה — W11.O7
  - Proof: owner facts: `transparencyReportUrl`, `securityMdDisclosure`
- [ ] **slsa-provenance**: Releases carry SLSA provenance and signatures, and witness verify passes on a clean machine without network.
  - השחרורים נושאים SLSA provenance וחתימות, ו-witness verify עובר במכונה נקייה בלי רשת.
  - Source: W7.22 (R6 §5): beta.1 (W4.5) מתפרסם עם attestation לכל קובץ, ו-`witness verify` עובר במכונה נקייה בלי רשת
  - Proof: run: `witness-verify`
- [ ] **plugin-directory-reviewed**: Every plugin and theme version is auto-reviewed, permissions are shown before install, scorecards are public, and there are 0 unsigned "Verified" badges.
  - כל גרסה של תוסף וערכת נושא עוברת ביקורת אוטומטית, ההרשאות מוצגות לפני ההתקנה, כרטיסי הניקוד ציבוריים, ו-0 תגי ״מאומת״ בלי חתימה.
  - Source: W11.S14 (R6 §5): 100% דחייה של דוגמאות רעות: קוד מוסתר, eval, קריאת רשת לא מוצהרת, url() לזליגה ב-CSS
  - Proof: test: `src/__tests__/pluginReview.test.ts`, `src/__tests__/PluginGalleryRender.test.tsx`
**Community and business**

- [ ] **beta-300-activation-retention**: The beta reached ≥ 300 opt-in users with activation ≥ 50%, D7 ≥ 30% and D30 ≥ 15%.
  - הבטא הגיעה ל-≥ 300 משתמשים בהסכמה עם הפעלה ≥ 50%, ‏D7 ≥ 30% ו-D30 ≥ 15%.
  - Source: W11.L6 (R6 §5): ≥ 300 משתמשים בהסכמה; ‏D30 ≥ 15%
  - Proof: metric (beta-reports): `optInUsers` ≥ 300; `activationRate` ≥ 0.5; `d7` ≥ 0.3; `d30` ≥ 0.15
- [ ] **docs-complete-both-languages**: Docs are complete in Hebrew and English: every feature has a page, docs-sync is green.
  - התיעוד שלם בעברית ובאנגלית: לכל פיצ׳ר עמוד, ‏docs-sync ירוק.
  - Source: 13.1 (R6 §5): כל פיצ'ר עם עמוד; docs-sync ירוק
  - Proof: test: `src/__tests__/docsSync.test.ts`
- [ ] **community-channels-response**: GitHub Discussions and a chat channel are open with a code of conduct; the median first response is ≤ 24 h over the last 30 days.
  - ‏GitHub Discussions וערוץ צ׳אט פתוחים עם קוד התנהגות; זמן התגובה הראשונה החציוני ≤ 24 שעות ב-30 הימים האחרונים.
  - Source: W11.L8 (R6 §5): launch:gate -- GA ירוק בכל הפריטים
  - Proof: metric (owner): `medianFirstResponseHours` ≤ 24
- [ ] **pricing-page-promise**: The pricing page is live: free and MIT forever, an optional relay, an education discount, the free tier never shrinks.
  - דף התמחור באוויר: חינם ו-MIT לתמיד, ממסר אופציונלי, הנחה לחינוך, השכבה החינמית אף פעם לא מצטמצמת.
  - Source: W11.P12 (R6 §5): הדף נבנה בשתי השפות
  - Proof: test: `src/__tests__/pricingPage.test.ts`, `src/__tests__/billingGatesHostedOnly.test.ts`
- [ ] **launch-assets-ready**: Launch assets are ready: the Product Hunt page, a Show HN text, a press kit in Hebrew and English, a 60-second demo video and the "Leaving Evernote or Notion?" page; every claim links a source or a receipt.
  - ערכת ההשקה מוכנה: דף Product Hunt, טקסט Show HN, ערכת עיתונות בעברית ובאנגלית, סרטון הדגמה של 60 שניות ודף ״עוזבים את Evernote או Notion?״; כל טענה מקושרת למקור או לקבלה.
  - Source: W11.L3 (R6 §5): כל טענה בערכה מקושרת למקור או לקבלה
  - Proof: run: `launch-kit-claims`
- [ ] **comparison-and-a11y-statement**: The comparison page has 20/20 claims sourced, and an accessibility statement is published one click from the app and the site.
  - לדף ההשוואה 20/20 טענות עם מקור, והצהרת נגישות מפורסמת במרחק לחיצה מהאפליקציה ומהאתר.
  - Source: W11.Q7 (R6 §5): שני המסמכים במרחק לחיצה אחת מהאפליקציה ומהאתר
  - Proof: test: `src/__tests__/a11yStatement.test.ts`
- [ ] **release-and-final-review**: The independent release review (13.5) and the final review against §14 (13.6) are done.
  - ביקורת השחרור העצמאית (13.5) והביקורת הסופית מול §14 (13.6) נעשו.
  - Source: 13.5 (R6 §5): כל ה-P0 ירוקים
  - Proof: owner facts: `releaseReview`, `finalReview`
