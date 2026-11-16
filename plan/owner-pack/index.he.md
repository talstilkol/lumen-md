# חבילת הבעלים — אינדקס אחד לכל המסלולים

<div dir="rtl">

נוצר על ידי `node scripts/mac-pack/owner-index.mjs` מתוך plan/owner-pack/L*.json; לא לערוך ידנית. המשפטים בעברית בקובץ הזה נכתבו במכונה וצריכים סקירה של דובר/ת עברית; טקסט ההחלטות הוא של המסלולים (באנגלית).

144 פריטים של מסלולים, 82 פעולות בעלים אחרי איחוד מה שכמה מסלולים מבקשים, מתוך 8 מסלולים.

## לעשות קודם

כל אחת מאלה משחררת שורות אחרות; לעשות לפי הסדר.

### 1. לקדם את main לרכבת (fast-forward) ולבחור את המפתח שחותם על קבלת ה-e2e

- **למה קודם:** כל שחרור, סריקה מחדש ובדיקת ייצור מחכים לכך ש-main יזוז; ‏#1099 כבר הפך את main ל-fast-forward לרכבת 7.
- **פריטי המסלולים:** L1 `L1/W6.1` (W6.1), L3 `L3-W4.1` (W4.1), L4 `W1.1` (W1.1), L4 `W10.O4` (W10.O4)
- **המלצה:** `L1/W6.1` A · `W10.O4` A (train 7 contains train 6)
- **PR טיוטה:** fix/g6-L4-main-into-train7
- **בדיקה:** `git fetch -q origin main && npm run promote:check -- origin/main`
  - `L1/W6.1`: Approve promoting main in steps: train 1, then #356 and #432, each only after the full e2e and the data-safety drill pass on that head.
  - `L3-W4.1`: Promote main to the train head once the Mac's whole-suite e2e receipt is green, and decide which key signs that receipt.
  - `W1.1`: Merge the train stack into main, then keep feature PRs at most 7 days old.
  - `W10.O4`: Promote main to the train: fast-forward, tag, smoke, rollback plan.

### 2. להפעיל את הגדרות האבטחה של GitHub: דיווח פרטי על חולשות, סריקת סודות, push protection, ה-ruleset והתווית human-reviewed

- **למה קודם:** טיוטה #1101 והערוץ הראשון ב-SECURITY.md מחכים לזה, וכך גם התווית של כל PR רגיש.
- **פריטי המסלולים:** L1 `L1/W6.12` (W6.12), L4 `W10.O1` (W10.O1), L7 `L7-W10.D15` (W10.D15)
- **המלצה:** `L1/W6.12` A · `W10.O1` B: reporting and secret scanning today (nothing depends on them); the ruleset right after the fast-forward of W10.O4, so the promote itself is not blocked
- **PR טיוטה:** #1101
- **בדיקה:** `npm run owner:session -- check accounts`
- **בדיקה:** `gh api -X PUT repos/talstilkol/lumen-md/private-vulnerability-reporting && gh api repos/talstilkol/lumen-md/private-vulnerability-reporting`
  - `L1/W6.12`: Turn on private vulnerability reporting, secret scanning, push protection, and create the human-reviewed label.
  - `W10.O1`: Apply the GitHub security settings: private vulnerability reporting, secret scanning + push protection, the ruleset, labels, Discussions.
  - `L7-W10.D15`: Turn on GitHub private vulnerability reporting, then make it the first channel in SECURITY.md.

### 3. להפעיל את Buildkite פעם אחת: ארגון אחד, צינור אחד מ-.buildkite/pipeline.yml, סוכן linux וסוכן ה-Mac

- **למה קודם:** הפעלה אחת עונה בבת אחת על כל פריטי בדיקת ה-PR, הסורקים, Lighthouse ו-ci-doctor של כל המסלולים.
- **פריטי המסלולים:** L2 `L2-O-W10.E10` (W10.E10), L2 `L2-O-W10.E25` (W10.E25), L2 `L2-O-W10.E32` (W10.E32), L6 `L6-W7.21-buildkite` (W7.21), L7 `L7-W10.D4` (W10.D4), L7 `L7-W10.D14` (W10.D14), L8 `L8-O-2.8` (2.8)
- **המלצה:** `L2-O-W10.E10` A · `L6-W7.21-buildkite` A now (owner checklist items 1.42–1.46), B in parallel.
- **בדיקה:** `npm run ci:selftest && npm run ci:pipeline`
- **בדיקה:** `bash scripts/buildkite/agent-bootstrap.sh  (after creating the org and an agent token)`
- **בדיקה:** `npm run owner:session -- check accounts`
  - `L2-O-W10.E10`: Turn Buildkite on once (shared by W10.E10, E24, E25, E32, E33): create the Buildkite organisation and one pipeline that reads .buildkite/pipeline.yml from talstilkol/lumen-md, connect the GitHub app for commit statuses,…
  - `L2-O-W10.E25`: Give Buildkite's `pr-check` job a way to comment, and turn Renovate on: (1) create a fine-grained GitHub token for talstilkol/lumen-md with only 'Pull requests: write', save it in a file on the linux agent and set LUMEN…
  - `L2-O-W10.E32`: Create a read-only Buildkite API token (read_builds, read_build_logs) for ci-doctor and put it where scripts/lib/ci-doctor-sources.mjs reads it (BUILDKITE_API_TOKEN in the Mac's shell profile), after the first real Buil…
  - `L6-W7.21-buildkite`: Open the Buildkite Free organisation and connect the agents (second host + Mac).
  - `L7-W10.D4`: Give PRs an automatic pr:check: create a Buildkite organisation and run one self-hosted agent (the Mac or the second host).
  - `L7-W10.D14`: Same Buildkite decision as W10.D4: gitleaks, audit and semgrep run in the same pipeline once an agent exists.
  - `L8-O-2.8`: Where the PR security scanners (gitleaks, npm audit, cargo audit, semgrep) run on every PR now that GitHub Actions is retired.

### 4. להגדיר בפרויקט Vercel את Ignored Build Step ל-`bash scripts/vercel-ignore.sh`

- **למה קודם:** חמש דקות בלוח הבקרה; זה עוצר בניות מיותרות בכל push.
- **פריטי המסלולים:** L1 `L1/W6.10` (W6.10), L4 `W10.O3` (W10.O3), L4 `W10.F3` (W10.F3)
- **המלצה:** `L1/W6.10` A · `W10.O3` B (one command, and check:vercel-ignore verifies it) · `W10.F3` see W10.O3
- **בדיקה:** `VERCEL_TOKEN=… npm run check:vercel-ignore`
  - `L1/W6.10`: Set the Ignored Build Step in the Vercel project.
  - `W10.O3`: Set the Vercel project's Ignored Build Step to `bash scripts/vercel-ignore.sh`.
  - `W10.F3`: Same setting as W10.O3 (the check is wired; only the project setting is owed).

### 5. למנות מתחזק או סוקר שני, ליצור את מפתחות החתימה של הסוקרים ולחתום על הקבלות שה-PR הרגישים חייבים

- **למה קודם:** בלי זה אי אפשר לומר שה-PR של אבטחה, כספת, סנכרון ותוספים נסקרו.
- **פריטי המסלולים:** L1 `L1/W6.13` (W6.13), L3 `L3-W4.28` (W4.28), L4 `W10.O2` (W10.O2), L7 `L7-W9.4` (W9.4)
- **המלצה:** `L1/W6.13` A · `L3-W4.28` A (B later, before 1.0, for the e2ee code)
- **בדיקה:** `npm run codeowners:check`
- **בדיקה:** `npm run review:coverage`
  - `L1/W6.13`: Find a second maintainer and two human reviewers for sensitive code.
  - `L3-W4.28`: Name a second maintainer (or an external reviewer) for the sensitive paths, and make their review required.
  - `W10.O2`: Create the reviewer signing keys (Ed25519) and a second reviewer, then sign the Z2 receipts.
  - `L7-W9.4`: Review receipts and the human-reviewed label for the sensitive PRs on the merged train head (#932, #936, #937, #939–#943).

### 6. לפרסם את המודלים ב-GitHub Releases של המאגר מאחורי ה-Worker של model-mirror (גרסאות נעוצות, sha256 ב-models/registry.json)

- **למה קודם:** models:day, הניקוד, התרגום וריצות ה-golden ב-Mac קוראים מהמראה.
- **פריטי המסלולים:** L1 `L1/W6.33` (W6.33), L3 `L3-W4.14` (W4.14), L7 `L7-W2.5` (W2.5), L8 `L8-O-6.0` (6.0), L8 `L8-O-6.3` (6.3)
- **המלצה:** `L1/W6.33` A · `L3-W4.14` A, after PR #1078 (owner:models crashed at start-up on train-7)
- **PR טיוטה:** 1078
- **בדיקה:** `npm run models:mirror -- --check --strict`
- **בדיקה:** `python -I scripts/models/export-menaked.py --revision <commit sha from the model card> --out out/dictabert-char-menaked  (needs torch, transformers, onnx, onnxruntime; huggingface.co is blocked in the cloud)`
- **בדיקה:** `npm run owner:models`
- **בדיקה:** `MENAKED_REVISION=<sha> (then the Mac entries L8-6.3-menaked and L8-6.3-golden)`
  - `L1/W6.33`: Pin the 24 models and deploy the mirror from a machine that reaches Hugging Face.
  - `L3-W4.14`: Host every default model outside Hugging Face: GitHub Releases of this repo behind the model-mirror Worker.
  - `L7-W2.5`: Export DictaBERT-large-char-menaked to ONNX at a pinned revision and publish it on the model mirror, so nikud stops falling back to Nakdimon.
  - `L8-O-6.0`: Publish the converted models (Opus-MT en→he, opus-mt-tc-big-he-en, DictaBERT-NER, bert-base-NER, SigLIP multilingual) as GitHub release assets on talstilkol/lumen-md, after the Mac run L8-6.0-convert passes, and record…
  - `L8-O-6.3`: Ship DictaBERT-large-char-menaked as the "high quality" niqqud download (stage 2), at a pinned revision, hosted with the other models.

### 7. ליצור את מפתח השחרור הלא-מקוון ואת מפתח העדכונים, ואז לחתוך ולחתום את 0.2.0-beta.1

- **למה קודם:** דף ההורדות, תרגיל העדכון ושער ההשקה M0 מחכים כולם לשחרור חתום.
- **פריטי המסלולים:** L2 `L2-O-W10.E61` (W10.E61), L4 `W10.O5` (W10.O5), L6 `L6-W11.L4-m0` (W11.L4)
- **המלצה:** `L2-O-W10.E61` A · `W10.O5` A (Windows Authenticode is separate; the Tauri update signature is mandatory and independent of it) · `L6-W11.L4-m0` A. Today launch:gate M0 is 0/5 (no receipts); the order is the four test/run receipts from the Mac run, then the signed build.
- **בדיקה:** `npm run launch:gate -- M0`
  - `L2-O-W10.E61`: Publish the first release so the downloads page has something to list: on the Mac, with the signing keys, `npm run release -- 0.2.0-beta.1 --publish` (beta = a GitHub pre-release, never 'latest'), then `node scripts/rel…
  - `W10.O5`: Make the offline release key and updater pubkey, sign beta.1, run the beta.1→beta.2 drill.
  - `L6-W11.L4-m0`: Cut and sign 0.2.0-beta.1 once launch:gate M0 is green, and publish the Hebrew changelog.

## כל השאר

קודם השורות שעונות על הכי הרבה פריטים.

### 8. לגייס אנשים: סבבי שמישות, הבטא העברית הסגורה, סוקרים

- **פריטי המסלולים:** L1 `L1/W6.30` (W6.30), L1 `L1/W6.31` (W6.31), L1 `L1/W11.O5` (W11.O5), L3 `L3-W4.25` (W4.25), L4 `W1.29` (W1.29), L4 `W10.O8` (W10.O8), L6 `L6-W11.L5-m1` (W11.L5), L7 `L7-W8.5` (W8.5), L7 `L7-W8.12` (W8.12)
- **המלצה:** `L1/W6.30` A · `W1.29` B (5 sessions find most severe problems; the second round measures SUS ≥ 80 after the fixes) · `L6-W11.L5-m1` A + B mixed (25/25), weekly opt-in report only (launch:gate --beta-metrics).
- **בדיקה:** `npm run test:sr`
- **בדיקה:** `node scripts/usability-analyze.mjs`
- **בדיקה:** `true`
- **בדיקה:** `npm run launch:gate -- M1`
  - `L1/W6.30`: Install Guidepup on the Mac and recruit 3 screen-reader users.
  - `L1/W6.31`: Recruit 12 unmoderated testers and the 50-person beta.
  - `L1/W11.O5`: Recruit 3 meeting reviewers and an annotator who did not write the grammar rules.
  - `L3-W4.25`: Run usability round 1 with 12 participants (5 moderated, 7 self-guided) and collect their files.
  - `W1.29`: Hold the Hebrew usability rounds (5–8 sessions per round).
  - `W10.O8`: Recruit people: usability participants, language reviewers, a labelled grammar set, external crypto review, plugin developers, beta audience.
  - `L6-W11.L5-m1`: Recruit the closed Hebrew beta of 50 and run the 12 unmoderated sessions.
  - `L7-W8.5`: Run the 5-user SAS usability test (each compares the 5 emoji correctly in < 20 s).
  - `L7-W8.12`: Recruit 12 participants for the unmoderated usability tests (#487 is clean on the train).

### 9. לספק ייצואים אמיתיים (Notion ושאר המייבאים) בהסכמה

- **פריטי המסלולים:** L1 `L1/W6.38` (W6.38), L1 `L1/W6.46` (W6.46), L4 `W10.O9` (W10.O9), L4 `W12.T7` (W12.T7), L7 `L7-W8.2` (W8.2), L8 `L8-O-W11.P2` (W11.P2)
- **המלצה:** `L1/W6.38` A, with B as the honest report until it happens · `L1/W6.46` A · `W10.O9` A: public-domain text only, so the corpus can be committed · `W12.T7` A (part of W10.O9) · `L7-W8.2` A first (no consent issue), B to reach 20 · `L8-O-W11.P2` A, with B as the fallback for a format the owner has no account in
- **בדיקה:** `ls scripts/real-corpus`
- **בדיקה:** `npm run test && npm run build && npm run budget`
- **בדיקה:** `npm run import:diff -- --lumen <lumen-md import folder> --oracle <Obsidian Importer folder> --json --out reports/import-diff.md`
  - `L1/W6.38`: Approve collecting ≥ 30 real files per format (8 formats) from consenting users.
  - `L1/W6.46`: Provide 20 real Notion exports for the database scenarios.
  - `W10.O9`: Contribute real exports (Word/Docs pastes, Notion, Evernote, Bear, Apple Notes, Keep, OneNote, Obsidian 1.15 + Bases, PDFs, WhatsApp) with consent and licence.
  - `W12.T7`: Provide one real Notion database export for the type import report.
  - `L7-W8.2`: Provide 20 real Notion exports (owner's or volunteers', with consent) to measure 18/20 scenarios after import.
  - `L8-O-W11.P2`: Provide the real exports (W10.O9) and run `npm run import:diff` on each: the same export imported by lumen-md and by Obsidian Importer.

### 10. לפרוס את האתרים הנפרדים: מסגרת התוכן במקור משלה, שרת השיתוף והממסר

- **פריטי המסלולים:** L1 `L1/W6.23` (W6.23), L1 `L1/W6.40` (W6.40), L3 `L3-W4.8` (W4.8), L4 `W10.O6` (W10.O6), L7 `L7-W10.D1` (W10.D1)
- **המלצה:** `L1/W6.23` A · `W10.O6` B: relay first (fixes H1/H2 in 23c997bcfe pushed to #664 after approval), then content frame (lumen-md-frame.pages.dev in the CSP), then share server and mirror
- **בדיקה:** `npm run share:latency && npm run share:scan`
- **בדיקה:** `curl -sI https://lumen-md-frame.pages.dev/ \| grep -i content-security-policy`
- **בדיקה:** `node scripts/content-frame-site.mjs && npx wrangler pages deploy dist-frame --project-name lumen-md-frame && node scripts/headers.mjs --check`
  - `L1/W6.23`: Deploy the share server and the relay on Cloudflare, and measure from Israel.
  - `L1/W6.40`: Deploy the content-frame site on its own origin.
  - `L3-W4.8`: Deploy the public live-share server where it costs $0/month and stores only encrypted updates.
  - `W10.O6`: Deploy the content-frame site, the share server + relay, the mirror Worker; request a rescan.
  - `L7-W10.D1`: Run Google's CSP Evaluator on every route policy and deploy the content frame on its own origin (a second static site).

### 11. לבחור את הקול העברי שהמשקלות ונתוני האימון שלו מתירים הפצה

- **פריטי המסלולים:** L5 `L5.O-W5.6` (W5.6), L6 `L6-W7.10-voice` (W7.10), L7 `L7-W2.6` (W2.6), L8 `L8-O-6.2` (6.2)
- **המלצה:** `L5.O-W5.6` Postpone the claim (option 2) until the W6.31 user programme: the code is done and byte-safe; the speed claim alone waits. · `L6-W7.10-voice` A. Run the Chatterbox CER test on the Mac first (models day, W10.M7); recruit only if it fails. · `L7-W2.6` C now, A as the follow-up task · `L8-O-6.2` B
- **בדיקה:** `npm run tts:voice -- check <voice.onnx.json>`
  - `L5.O-W5.6`: Run the 3-reader dyslexia test (W4.25), and pick a Hebrew neural voice licence (W2.6)?
  - `L6-W7.10-voice`: Decide whether to start our own CC0 Hebrew voice now, or wait for the Chatterbox Multilingual CER test (W11.H9/W11.M2) first.
  - `L7-W2.6`: Choose a Hebrew neural TTS voice whose weights AND training data allow shipping it; #611 is already in verify/train-7.
  - `L8-O-6.2`: Which English neural voice ships for read-aloud: pin Kokoro-82M and choose its English grapheme-to-phoneme step.

### 12. להזמין סקירת קריפטו חיצונית ולאשר את המעבר לספריות שנבדקו

- **פריטי המסלולים:** L1 `L1/W6.4` (W6.4), L1 `L1/W11.O6` (W11.O6), L4 `W1.7` (W1.7), L6 `L6-3.4-crypto` (3.4)
- **המלצה:** `L1/W6.4` A, with C as the state until a report exists · `L1/W11.O6` A · `W1.7` A, plus run cryptoDifferential.test.ts on the Mac (it compares against @noble and typage once installed) · `L6-3.4-crypto` A, and keep E2EE off and labelled "not externally audited" (launch gate M0 e2ee-off-and-labelled) until the differential run is green and the mutation gate for…
- **בדיקה:** `npx vitest run security/attacks && python3 scripts/sync-protocol/check_vectors.py`
- **בדיקה:** `npx playwright test e2e/e2ee-unaudited.spec.ts`
- **בדיקה:** `npx vitest run src/__tests__/cryptoDifferential.test.ts src/__tests__/cryptoPrimitivesDoor.test.ts src/__tests__/e2eeRandom.test.ts src/__tests__/e2eeSync.test.ts src/__tests__/e2eeCrypto.test.ts`
  - `L1/W6.4`: Commission the third independent crypto review, and acknowledge PR #1025's flag before it is lifted.
  - `L1/W11.O6`: Order an external security review of the sync protocol and keyring.
  - `W1.7`: Invite a public review of the sync crypto (spec + vectors + Python decoder), and decide hand-rolled vs hash-wasm/typage.
  - `L6-3.4-crypto`: Accept the switch of the E2EE primitives from the hand-written code to the audited libraries (@noble/ciphers, @noble/hashes, hash-wasm Argon2id, libsodium fallback, age-encryption), and keep E2EE off and labelled until…

### 13. להקים את המארח השני (Cloudflare) לאתר ולמפעל הלילי

- **פריטי המסלולים:** L1 `L1/W6.5` (W6.5), L1 `L1/W6.9` (W6.9), L3 `L3-W4.27` (W4.27), L6 `L6-W7.23-cloudflare` (W7.23)
- **המלצה:** `L1/W6.5` A · `L3-W4.27` A; the written decision: 'Vercel Hobby + Cloudflare Pages Free, $0/month' · `L6-W7.23-cloudflare` A, per scripts/supply-chain/cf-build.sh; compare each main commit with npm run repro:compare.
- **בדיקה:** `npm run owner:session -- check accounts`
- **בדיקה:** `npm run hosts:parity && npm run hosting:gate`
- **בדיקה:** `npm run repro:compare -- https://<worker>/lumen-build.json origin:https://lumen-md.vercel.app`
  - `L1/W6.5`: Create the free second host for the nightly factory.
  - `L1/W6.9`: Pick the second deployment host and when to leave Vercel Hobby.
  - `L3-W4.27`: Put the site on the second host (Cloudflare Pages) at the same commit hash, and write down the monthly cost.
  - `L6-W7.23-cloudflare`: Create the Cloudflare Workers Builds project that rebuilds main and serves only the manifest, then watch 10 commits.

### 14. לפתוח GitHub Sponsors ו-Open Collective, ואז למזג את המתג המוכן

- **פריטי המסלולים:** L1 `L1/W11.O8` (W11.O8), L4 `W10.O7` (W10.O7), L5 `L5.O-W5.25` (W5.25)
- **המלצה:** `L1/W11.O8` A · `L5.O-W5.25` Option 1; the paid relay (Polar, Cloudflare R2) only after the hosting move (owner step 4).
- **PR טיוטה:** 1091, #1084
- **בדיקה:** `npx vitest run src/__tests__/supportFunding.test.ts`
  - `L1/W11.O8`: Open GitHub Sponsors and Open Collective; test the relay payment in sandbox; start pilots; check NetFree.
  - `W10.O7`: Store and service accounts: TestFlight, Play, Codemagic, BrowserStack/Percy, package managers, Sponsors.
  - `L5.O-W5.25`: Open GitHub Sponsors and the Open Collective 'lumen-md', then merge the prepared switch.

### 15. תלויות: לסגור את ה-PR של dependabot, להריץ audit אמיתי, להתקין את Renovate

- **פריטי המסלולים:** L1 `L1/W6.14` (W6.14), L4 `W10.O11` (W10.O11), L7 `L7-W10.D10` (W10.D10)
- **המלצה:** A
- **בדיקה:** `npm audit --audit-level=high && npm run audit:lock && (cd src-tauri && cargo audit && cargo deny check)`
- **בדיקה:** `npm audit --omit=dev --json > reports/npm-audit.json && npm run audit:lock`
  - `L1/W6.14`: Clear the advisories: merge or close the dependabot PRs down to ≤ 5, and run the audits where the registry is reachable.
  - `W10.O11`: Install Renovate, enable OpenSSF Scorecard + badge, request an external review.
  - `L7-W10.D10`: Close the dependabot PRs per docs/security/dependabot.md after one dependency train; run a real `npm audit`.

### 16. לפתוח את תוכנית הקוד הפתוח של BrowserStack ‏(Percy ו-Automate), או להחליט לוותר

- **פריטי המסלולים:** L1 `L1/W6.6` (W6.6), L2 `L2-O-W10.E55` (W10.E55), L6 `L6-W7.25-percy` (W7.25)
- **המלצה:** `L1/W6.6` A · `L2-O-W10.E55` B · `L6-W7.25-percy` A if the OSS application (W4.7) is approved; otherwise B and mark W7.25 dropped.
- **בדיקה:** `node scripts/safari/run.mjs --dry-run`
- **בדיקה:** `PERCY_TOKEN=… npm run visual:percy && PERCY_TOKEN=… npm run visual:percy -- --canary`
  - `L1/W6.6`: Apply for BrowserStack's open-source plan and store the Automate keys on the Mac.
  - `L2-O-W10.E55`: Percy: open a BrowserStack Percy account and give the linux agent PERCY_TOKEN, or decide not to use Percy.
  - `L6-W7.25-percy`: Create the Percy project under the BrowserStack open-source plan and approve the first baseline.

### 17. להפעיל את GitHub Discussions ולפרסם את אתר התיעוד

- **פריטי המסלולים:** L3 `L3-W4.34` (W4.34), L4 `W1.28` (W1.28), L7 `L7-W2.25` (W2.25)
- **המלצה:** A
  - `L3-W4.34`: Turn on GitHub Discussions, and publish the docs site so Hebrew search is checked live; the GIFs are a Mac command.
  - `W1.28`: Open GitHub Discussions; approve the 30 GIFs the Mac makes (W10.M9); confirm Pagefind search on the live docs site.
  - `L7-W2.25`: Recruit the Hebrew beta (≥ 50 active testers) and open Discussions for feedback; settle the 4 comparison claims still unverified (W10.B22).

### 18. להריץ את בדיקות האחסון מול חשבונות אמיתיים (WebDAV, ‏S3/R2/B2, ‏Drive)

- **פריטי המסלולים:** L1 `L1/W6.27` (W6.27), L7 `L7-W10.D8` (W10.D8), L7 `L7-W8.3` (W8.3)
- **המלצה:** A
- **בדיקה:** `docker compose -f scripts/real-servers/docker-compose.yml up -d && node scripts/real-servers/wait.mjs`
  - `L1/W6.27`: Run the CAS conformance against real WebDAV, S3 and Drive accounts.
  - `L7-W10.D8`: Run the Drive provider against a real Google Drive to check the no-CAS fork detection (t8) end to end.
  - `L7-W8.3`: Run the CAS probe against a real R2 or B2 bucket (200/200).

### 19. להגיש בקשה ל-SignPath Foundation לחתימת Windows בחינם

- **פריטי המסלולים:** L1 `L1/W11.O1` (W11.O1), L4 `W11.S15` (W11.S15)
- **המלצה:** A
- **בדיקה:** `grep -n SignPath scripts/release-run.mjs`
  - `L1/W11.O1`: Apply to SignPath Foundation for free Windows code signing.
  - `W11.S15`: Windows signing through SignPath Foundation (free for OSS).

### 20. להחזיק את מפתח המעריך של הסט הסמוי ולחתום את פיצול המבחן

- **פריטי המסלולים:** L1 `L1/W6.17` (W6.17), L3 `L3-7.1` (7.1)
- **המלצה:** A
- **בדיקה:** `npx vitest run src/__tests__/heldout.test.ts`
  - `L1/W6.17`: Generate the held-out recipient key (X25519) and seal the first set.
  - `L3-7.1`: Hold the held-out evaluator key and build the sealed test split (the archived golden-sets.yml with GOLDEN_SEED is replaced by `npm run heldout`).

### 21. לרשום את אפליקציות ה-OAuth לסנכרון (Google Drive, ‏Dropbox)

- **פריטי המסלולים:** L3 `L3-W4.19` (W4.19), L6 `L6-W10.C19-oauth` (W10.C19)
- **המלצה:** `L3-W4.19` A (Dropbox later, if users ask) · `L6-W10.C19-oauth` B until the closed beta (M1), then A: Google's verification for the drive scope takes weeks and needs the privacy page live.
- **בדיקה:** `npx vitest run src/__tests__/syncWizardCloud.test.tsx src/__tests__/syncSetupWizard.test.tsx`
  - `L3-W4.19`: Register the OAuth apps the two-tap sync needs, then time one new user (≤ 6 taps, ≤ 2 min).
  - `L6-W10.C19-oauth`: Register the Google Drive and Dropbox OAuth client IDs (or defer them) for the sync wizard.

### 22. לשלוח את החבילה המשפטית לקליניקה לפרטיות

- **פריטי המסלולים:** L1 `L1/W6.37` (W6.37), L1 `L1/W11.O3` (W11.O3)
- **המלצה:** A
- **PR טיוטה:** 1092
- **בדיקה:** `npm run legal:packet`
- **בדיקה:** `grep -n 'Coordinator:' docs/src/content/docs/editor/accessibility-statement.md`
  - `L1/W6.37`: Send the legal packet to a university privacy clinic.
  - `L1/W11.O3`: Send the legal packet, and choose the accessibility coordinator's contact details for the statement.

### 23. Dependencies: the open overrides and cargo update.

- **פריטי המסלולים:** L4 `12.2` (12.2)
- **המלצה:** A

### 24. Opt-in monitoring: which error tracker, and does the official build carry a DSN?

- **פריטי המסלולים:** L4 `12.4` (12.4)
- **המלצה:** A

### 25. Run the held-out spelling test (15.11).

- **פריטי המסלולים:** L1 `L1/9.2` (9.2)
- **המלצה:** A
- **בדיקה:** `npm run owner:session -- check gpu`

### 26. Open the RTL table DOCX in real Word and confirm the alignment.

- **פריטי המסלולים:** L1 `L1/9.8` (9.8)
- **המלצה:** A
- **בדיקה:** `npx vitest run src/__tests__/exportDocxRtlTables.test.ts`

### 27. Write to Resemble AI about Chatterbox Multilingual's training data.

- **פריטי המסלולים:** L1 `L1/W11.O2` (W11.O2)
- **המלצה:** A
- **בדיקה:** `true`

### 28. Register at MAFAT HSRC and record the NEMO and HebSummaries terms.

- **פריטי המסלולים:** L1 `L1/W11.O4` (W11.O4)
- **המלצה:** A
- **בדיקה:** `grep -n HSRC scripts/golden/defs.mjs`

### 29. Submit the stores' privacy labels and DSA trader status, with Hebrew store pages.

- **פריטי המסלולים:** L1 `L1/W11.O7` (W11.O7)
- **המלצה:** A
- **בדיקה:** `ls store`

### 30. Get licences for the entity-graph data: HeRE, NEMO-Corpus and GLiNER weights.

- **פריטי המסלולים:** L1 `L1/W12.O1` (W12.O1)
- **המלצה:** A, B for any without an answer in 30 days
- **בדיקה:** `ls docs/legal`

### 31. Ask Sefaria for written approval of API use in havruta rooms and the 'Powered by Sefaria' badge.

- **פריטי המסלולים:** L1 `L1/W12.O2` (W12.O2)
- **המלצה:** A
- **בדיקה:** `true`

### 32. Run the havruta pilot: two pairs, one week, observed.

- **פריטי המסלולים:** L1 `L1/W12.O3` (W12.O3)
- **המלצה:** A
- **בדיקה:** `true`

### 33. Open the template gallery's sample vault in Obsidian, and time its load.

- **פריטי המסלולים:** L1 `L1/W3.6` (W3.6)
- **המלצה:** A
- **בדיקה:** `npx playwright test e2e/template-gallery.spec.ts`

### 34. Create the Kaggle account for the free GPU model day.

- **פריטי המסלולים:** L1 `L1/W6.18` (W6.18)
- **המלצה:** A
- **בדיקה:** `npm run models:cloud -- setup`

### 35. After #432 reaches production, ask the search engines to recrawl and check the old foreign domain 14 days later.

- **פריטי המסלולים:** L1 `L1/W6.2` (W6.2)
- **המלצה:** A
- **בדיקה:** `npm run live:meta -- https://lumen-md.vercel.app`

### 36. Run session 1 with `owner:session` and time it.

- **פריטי המסלולים:** L1 `L1/W6.20` (W6.20)
- **המלצה:** A
- **בדיקה:** `npm run owner:session -- status`

### 37. Approve the PR triage table, including category (f) closes.

- **פריטי המסלולים:** L1 `L1/W6.21` (W6.21)
- **המלצה:** A
- **בדיקה:** `test "$(gh api 'repos/talstilkol/lumen-md/pulls?state=open&per_page=100' --paginate --jq '.[].number' \| wc -l)" -le 40`

### 38. Ask a Hebrew speaker to review the Hebrew docs.

- **פריטי המסלולים:** L1 `L1/W6.28` (W6.28)
- **המלצה:** A
- **בדיקה:** `npm run docs:parity`

### 39. Request Hosted Weblate libre hosting and install its GitHub app on this repo only.

- **פריטי המסלולים:** L1 `L1/W6.32` (W6.32)
- **המלצה:** A
- **בדיקה:** `npm run i18n:check && npm run i18n:weblate`

### 40. Decide whether outside plugins come from a separate registry site, and invite 5 developers.

- **פריטי המסלולים:** L1 `L1/W6.35` (W6.35)
- **המלצה:** A
- **בדיקה:** `npx playwright test e2e/plugin-ecosystem.spec.ts --project=chromium --project=firefox --project=webkit`

### 41. Fix the train cadence: one small train a week.

- **פריטי המסלולים:** L1 `L1/W6.42` (W6.42)
- **המלצה:** A
- **בדיקה:** `git log origin/main --since='28 days ago' --first-parent --format=%cs \| sort -u \| wc -l`

### 42. Create a Zotero test key and provide 20 scanned Hebrew PDFs.

- **פריטי המסלולים:** L1 `L1/W6.47` (W6.47)
- **המלצה:** A
- **בדיקה:** `test -n "$ZOTERO_API_KEY"`

### 43. Which store gets the first build for review, and open that developer account.

- **פריטי המסלולים:** L2 `L2-O-13.7` (13.7)
- **המלצה:** A

### 44. Allow knip as a devDependency, so `npm run deadcode` (Buildkite job `deadcode`, ci:local, vercel-build) can run it. One Mac command: `npm i -D knip@latest --save-exact && npm run deadcode`, then commit package.json and package-lock.json.

- **פריטי המסלולים:** L2 `L2-O-W10.E24` (W10.E24)
- **המלצה:** A

### 45. Allow the linux agent to run Docker with the pinned Ollama image and cache models under $LUMEN_CI_CACHE, and pin the digests: on the Mac run `npm run ci:real-model-pins -- pin --write` (new in this wave) and commit models/ci-models.json.

- **פריטי המסלולים:** L2 `L2-O-W10.E33` (W10.E33)
- **המלצה:** A

### 46. Danger.js + size-limit for the PR gate, or the gates that already exist.

- **פריטי המסלולים:** L3 `L3-0.19` (0.19)
- **המלצה:** A, and restate 0.19's acceptance as 'pr:check fails a PR that adds an unregistered fetch; budget fails a size regression'

### 47. Make `npm run lint` a gate of every preview build (plan 0.4: a PR with an unexplained empty catch fails).

- **פריטי המסלולים:** L3 `L3-0.4` (0.4)
- **המלצה:** A
- **PR טיוטה:** 1080

### 48. Supply the twelfth small golden set (meetings), or take it out of 7.10.

- **פריטי המסלולים:** L3 `L3-7.10` (7.10)
- **המלצה:** A

### 49. Restate 'OCR runs on every PR' for a project without Actions, and get the CER numbers measured on the Mac.

- **פריטי המסלולים:** L3 `L3-7.5` (7.5)
- **המלצה:** A

### 50. Product decision 15.16 for the daily digest: what 'since' means.

- **פריטי המסלולים:** L3 `L3-7.7` (7.7)
- **המלצה:** A

### 51. Pick the first language to get a native speaker's review, and where to find reviewers; mark it 'reviewed' when done.

- **פריטי המסלולים:** L3 `L3-W4.18` (W4.18)
- **המלצה:** A

### 52. Cut the 15.x owner list by one more item (18 → 10, −44%; it is 11, −39%, the target is ≥ 40%) and open the free real-Safari account for 15.12.

- **פריטי המסלולים:** L3 `L3-W4.7` (W4.7)
- **המלצה:** A, plus a BrowserStack open-source account for 15.12 (`npm run safari:run -- --seal --tasks 15.12`)

### 53. Open the 5 institution templates in real Word and check them against the written guidelines.

- **פריטי המסלולים:** L5 `L5.O-W5.16` (W5.16)
- **המלצה:** Option 1 (Word is what the universities read).

### 54. Who approves the 40 gold citations (20 legal, 20 academic) against the Uniform Citation Rules (3rd ed., 2021), and is DOCX style retention checked in Word by you?

- **פריטי המסלולים:** L5 `L5.O-W5.2` (W5.2)
- **המלצה:** Option 1: a law student; you do the Word look yourself (5 minutes).

### 55. Record the 200 voice commands (several speakers) for the held-out set.

- **פריטי המסלולים:** L5 `L5.O-W5.20` (W5.20)
- **המלצה:** Option 1 with 3-4 speakers (you plus family), 15 minutes each.

### 56. Allow https://api.zotero.org in the deployed CSP connect-src, and run a real 1,000-item sync?

- **פריטי המסלולים:** L5 `L5.O-W5.23` (W5.23)
- **המלצה:** Option 1: the feature is opt-in, read-only and keyed; the connection is recorded in the privacy ledger (research category).

### 57. Export 10 of your own chats (WhatsApp Android + iPhone in he/en/ar, Telegram Desktop JSON) and import each?

- **פריטי המסלולים:** L5 `L5.O-W5.7` (W5.7)
- **המלצה:** Option 1, on the Mac, after L5.setup: ⌘K -> 'Import a WhatsApp or Telegram chat…' on each; compare the toast's message count with the app's.

### 58. Sign the MIT grant for israelconnect files moved into lumen-md (or decline it), and add an MIT LICENSE to tasker.

- **פריטי המסלולים:** L6 `L6-R12.1-licence` (R12.1)
- **המלצה:** A, but only for files actually listed (the table is empty today: nothing has been copied). Check authorship on a full clone first — LICENSING.md §7 says each c…
- **PR טיוטה:** #1090
- **בדיקה:** `test -f THIRD_PARTY_REUSE.md && ! grep -q '_(none yet' THIRD_PARTY_REUSE.md`

### 59. Run one real production deploy through a path that runs live:meta, and decide what an alert does.

- **פריטי המסלולים:** L6 `L6-W10.C29-livemeta` (W10.C29)
- **המלצה:** A for pages-deploy.sh and release.mjs (they already exit 1), B for Vercel's own git deploys (vercel-build checks the preview URL before the alias).
- **בדיקה:** `npm run live:meta && npm run live:meta -- --self-test`

### 60. Open the Hebrew beta (300–1,000): press, Powered by Sefaria, NetFree whitelisting, TestFlight and Play internal.

- **פריטי המסלולים:** L6 `L6-W11.L6-m2` (W11.L6)
- **המלצה:** B: stores first (W6.24), press after a week without data-loss reports.
- **בדיקה:** `npm run launch:gate -- M2`

### 61. Pick the Show HN date (a US weekday morning) and the Product Hunt date a week later.

- **פריטי המסלולים:** L6 `L6-W11.L7-m3` (W11.L7)
- **המלצה:** A; the comparison page needs 20/20 sourced claims first.
- **בדיקה:** `npm run launch:gate -- M3`

### 62. Set the 1.0 GA date, the pricing page, and publish the external audit report (or keep E2EE off and labelled).

- **פריטי המסלולים:** L6 `L6-W11.L8-ga` (W11.L8)
- **המלצה:** Whichever is true at the date; the GA checklist (24 items) decides, not the calendar.
- **בדיקה:** `npm run launch:gate -- GA`

### 63. Choose the held-out set and allow the image-path measurement with Qwen3-VL-2B through Ollama.

- **פריטי המסלולים:** L6 `L6-W7.11-handwriting` (W7.11)
- **המלצה:** A for the image path now; B only for the ink path, which needs pen strokes the public set does not have.
- **בדיקה:** `npx tsx scripts/eval/handwriting/run.mjs measure <items.jsonl> --engine ollama --model qwen3-vl:2b --json eval/results/handwriting-image.json`

### 64. Confirm the official submission format with the HebOCRBench organisers, then submit once.

- **פריטי המסלולים:** L6 `L6-W7.12-hebocrbench` (W7.12)
- **המלצה:** A, then submit from the second host (the 34,267 images never enter the repo; check-clean proves it).
- **בדיקה:** `node scripts/ocr/hebocrbench.mjs predict <package-dir> <out-dir> && node scripts/ocr/hebocrbench.mjs check-clean <package-dir>`

### 65. Do the manual connection check of our MCP server from Claude Code and Claude Desktop, and record it.

- **פריטי המסלולים:** L6 `L6-W7.17-mcp` (W7.17)
- **המלצה:** A for both clients; it is ten minutes and is the only open acceptance item (31/31 conformance, 0/50 writes already pass).
- **בדיקה:** `cd mcp-server && npm ci && npm run test:stdio`

### 66. Publish one Hebrew RTL note to your own Bluesky/Leaflet account and run Standard.site's verification of the static site.

- **פריטי המסלולים:** L6 `L6-W7.19-standard-site` (W7.19)
- **המלצה:** A with a dedicated test handle; screenshot Leaflet and Bluesky, then revoke the App Password.
- **בדיקה:** `curl -fsS https://<your-site>/.well-known/site.standard.publication`

### 67. Approve the public-domain dump as the library's only source, then run the real download once and record its check.

- **פריטי המסלולים:** L6 `L6-W7.7-benyehuda` (W7.7)
- **המלצה:** B, then A's flow: re-pin once now, run the real download and the public-domain check, and send the attribution question in parallel (the feature stays behind i…
- **בדיקה:** `node scripts/sources/live-check.mjs benyehuda`

### 68. Type the real 5787 (2026/27) dates for at least five institutions from their official calendars, or approve a named volunteer to do it, and mark each file verified only after the golden check.

- **פריטי המסלולים:** L6 `L6-W7.8-academic` (W7.8)
- **המלצה:** A for Haifa, Tel Aviv, Bar-Ilan, Hebrew University and Ben-Gurion (the four files present are empty with verified:false; add huji and bgu), then B for the rest.
- **בדיקה:** `for i in haifa tau biu huji bgu; do node scripts/academic/check-calendar.mjs data/academic/$i/5787.json data/academic/$i/5787.golden.json \|\| exit 1; done`

### 69. Accept that '0 open Codex threads' and 'CI green' are replaced by: every thread answered in code + a ci:local receipt (Actions are retired).

- **פריטי המסלולים:** L7 `L7-1.1` (1.1)
- **המלצה:** A

### 70. Schedule the daily issue triage (no Actions): add it to the nightly scheduler on the owner's host.

- **פריטי המסלולים:** L7 `L7-14.3` (14.3)
- **המלצה:** A
- **בדיקה:** `npm run nightly:install -- --print`

### 71. Create the beta channel deploy (a beta Vercel alias and the desktop pre-release) and ship one feature to beta before stable.

- **פריטי המסלולים:** L7 `L7-14.4` (14.4)
- **המלצה:** A
- **בדיקה:** `npm run flags:check`

### 72. Verify or remove the 4 comparison-page claims still shown as 'not stated'.

- **פריטי המסלולים:** L7 `L7-W10.B22` (W10.B22)
- **המלצה:** A where a vendor page exists, else B

### 73. Get 200 Hebrew Wikipedia sentences tagged by someone who did not write the grammar rules, for precision with a CI (rules vs rules + ranker).

- **פריטי המסלולים:** L7 `L7-W10.B9` (W10.B9)
- **המלצה:** B if two are available, else A

### 74. Pin the two diarization networks (pyannote segmentation-3.0 and a speaker-embedding model) and record 5 golden meetings for DER ≤ 20%.

- **פריטי המסלולים:** L7 `L7-W2.7` (W2.7)
- **המלצה:** A for segmentation; B for the embedding if its ONNX input matches `feats` (Kaldi fbank), else A's WeSpeaker
- **בדיקה:** `node scripts/meetings/diarization-pin.mjs --model segmentation --repo onnx-community/pyannote-segmentation-3.0 --revision <40-hex> --file onnx/model.onnx --bytes <n> --sha256 <64-hex> --license MIT`

### 75. Live Zotero write: notes come back identical, 0 duplicates on re-send; #600 is already in the train.

- **פריטי המסלולים:** L7 `L7-W8.4` (W8.4)
- **המלצה:** A

### 76. Publish a 50-note site to a GitHub Pages repository of the owner's from the app (Publish site → GitHub Pages), then check it in a browser.

- **פריטי המסלולים:** L8 `L8-O-4.18` (4.18)
- **המלצה:** A
- **בדיקה:** `SITE=https://<user>.github.io/lumen-publish-test/; test "$(curl -fsS "$SITE" \| grep -oE 'href="[^"]+\.html"' \| sort -u \| wc -l)" -ge 50 && test "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/no-such-page")" = 404`

### 77. Rate the local captioner's descriptions of the 50 images (30 Crossmodal-3600 + 20 Commons) 1–5 against the references (owner item 15.15).

- **פריטי המסלולים:** L8 `L8-O-6.6` (6.6)
- **המלצה:** A

### 78. Measure D30 in the beta: run the opt-in beta for ≥ 30 days with the retention loops on by default (each can be turned off) and read the funnel.

- **פריטי המסלולים:** L8 `L8-O-W11.P15` (W11.P15)
- **המלצה:** A
- **בדיקה:** `npm run beta:funnel -- --github`

### 79. Keep or drop the Vercel CI (Beta) trial for lint and unit tests.

- **פריטי המסלולים:** L8 `L8-O-W11.Q12` (W11.Q12)
- **המלצה:** A
- **PR טיוטה:** #1107

### 80. Should PR branches get a Vercel preview build (and so a failure status)?

- **פריטי המסלולים:** L4 `W1.35` (W1.35)
- **המלצה:** A

### 81. Write down the licence decisions (15.10, Hebrew speaker consent, DictaLM 12B/24B, embeddings, academic calendars, HebOCRBench, Zotero).

- **פריטי המסלולים:** L4 `W10.O10` (W10.O10)
- **המלצה:** A

### 82. Fix the WER target after the M7 model day.

- **פריטי המסלולים:** L4 `W10.O12` (W10.O12)
- **המלצה:** A (the acceptance already names it); the number is decided only from M7's measurement

## החבילות של המסלולים

- L1: [L1.he.md](L1.he.md), [L1.json](L1.json)
- L2: [L2.he.md](L2.he.md), [L2.json](L2.json)
- L3: [L3.he.md](L3.he.md), [L3.json](L3.json)
- L4: [L4.he.md](L4.he.md), [L4.json](L4.json)
- L5: [L5.he.md](L5.he.md), [L5.json](L5.json)
- L6: [L6.he.md](L6.he.md), [L6.json](L6.json)
- L7: [L7.he.md](L7.he.md), [L7.json](L7.json)
- L8: [L8.he.md](L8.he.md), [L8.json](L8.json)

</div>
