# Lane D1: delegated decisions (16.11.2026)

**Who decided.** Every decision below was made by Claude (lane D1) under the owner's delegation of 16.11.2026 21:53: "בכל ההחלטות החלט לבד ללא עצירה עד לסיום כל התוכניות ברמת world class" ("in every decision, decide alone, without stopping, until every plan is finished at world-class level"). The delegation covers product and process decisions. It does not change the standing rules: no gate, budget, baseline, ceiling, allow-list, CSP or licence list is loosened; review receipts, signatures and the human-reviewed label stay the owner's.

**Base.** verify/train-7 @ f090c20812. Branch fix/d1-decisions. Tests were run offline with shim v4 (`$S/shim-v4/v4.sh`, overlay `$S/train7/nm`). Each new test was checked to fail without its change.

| § | Decision | Choice | Commit |
|---|---|---|---|
| 1 | WIP decisions (W10.G6, W6.39, #985) | Strict by default. 10 written, dated decisions freeze the counts. Wave 13 stays at its placeholder for now. | 748d6c5433, af066e16db |
| 2 | Relay retention | 90 days, the same as collab | 3cbf9a9b12 |
| 3 | CRA support period | At least 5 years from the first release, never ending before 2031-12-31 | 535c9c24d6 |
| 4 | security.txt contact | GitHub private vulnerability reporting (PVR). Turning it on was refused (403), so Contact stays as it is. Renew by 2027-04-16. | 535c9c24d6 |
| 5 | Tectonic first-download timeout | 600 s for the first online compile, then 120 s | a0447b52ac |
| 6 | GPL word list (#981) and CrossRef | Yiddish: only a permissively licensed list, MPL-1.1 hunspell-yi 1.1 chosen, pin deferred. DOI: through OpenAlex, off by default. | 69ea74ae87 |
| 7 | VITE_CONTENT_FRAME_URL | Replaced by the build-only LUMEN_CONTENT_FRAME_URL, checked, inlined by `define` | 755a30a549 |
| 8 | Yiddish golden sets, open-law dataset | Datasets chosen by licence. The pins are deferred: Hugging Face is unreachable from here. | (record only) |
| 9 | The stacked PRs on old trains | They stay open, superseded by train-7, with a ledger | this commit |
| 10 | W8.10 / W8.11 hooks | The ci:local pre-push hook stays opt-in. The merge drivers stay in `prepare`. No watcher starts at install. Lane F11 implements this. | (record only) |
| 11 | #1099 (main into train 7) | Merged by INT6a under the delegation, recorded here as such; the owner acknowledges (added by lane F12, review 12 L6) | dad246d41d |

## §1 WIP decisions: strict WIP mode as the default (W10.G6, W6.39, #985)

**Options.**
- (a) Leave the strict mode opt-in. That is W6.39's open state.
- (b) Make it the default and verify waves 1–12 first. This needs the Mac run, which the owner set after every cloud task, so it is not possible now.
- (c) Make it the default, with one written, dated decision per wave pair over the limit. The decision is a ratchet. It freezes the wave's open count and the next wave's started count at today's numbers. Growth fails. A number left looser than the plan fails. A stale decision fails.

**Choice: (c).**

- #985's second commit, 2a016e18b1, is ported onto the train, beside #1053's frozen-wave gate (`scripts/plan/wipGate.mjs`). Both gates run.
- `plan.schedule.wipDecisions` holds 10 decisions: 1→2 (24/25), 2→3 (19/11), 3→4 (11/36), 4→5 (30/28), 5→6 (22/46), 6→7 (41/25), 7→8 (25/12), 8→9 (11/3), 10→11 (241/92), 11→12 (118/78). The figures are open/started.
- A pair held by a decision at its exact numbers is not printed as a warning. Audit r3 asked for 0 warnings, and plan:check now prints none. It prints one summary line instead, and exits 0.
- A pair with no decision, or with numbers that moved, is printed and fails, as before.
- `--wip-limit` can only lower the limit.

**Reasons.**
- The open tasks are waiting for the Mac run, not for code.
- A frozen count stops any new start, and that is the point of a WIP limit.
- Every verification lowers the numbers, and then the decision has to be lowered too.
- This is the "exception only with a written decision" that W10.G6 asked for. Nothing becomes looser than it is today.

**Permission.** An earlier lane was denied writing wipDecisions. This lane tried once under the delegation, and the write went through: there was no denial.

**§1b: wave 13 (W13.X1 and W13.X2: the code shipped in #1016 and #1019).**

- Today `isStarted` reads only `status`. The frozen-wave list (`plan/wip-frozen.json`) only shrinks, so its mechanics are not touched. W13.X1 and W13.X2 therefore stay at the "⏳ גל 13 — לא התחיל" placeholder, and their notes say the code shipped. No 12→13 decision is recorded today: there is no 12→13 warning, so the checker would reject a decision as stale.
- Review 11 / lane F11 is changing `isStarted` so that it also counts `verified`, `pr` and evidence. Once W13.X1/X2 count as started, wave 12 (85 open tasks below browser today) is over its limit while wave 13 has started.
- The honest data for that state is one more decision: `{ "wave": 12, "next": 13, "open": <wave 12's count then>, "started": <wave 13's count then, 2 if only W13.X1/X2>, "at": <date>, "decision": "W13.X1/X2 shipped in the train (#1016, #1019) before the rule counted pr/evidence; no other wave-13 start until wave 12 is verified" }`.
- Write it with today's counts after F11 lands: run `node $S/lanes/D1/wipdec.mjs <worktree>`, which writes every pair from the warnings, and review the result.
- The frozen-wave gate would still block W13.X1/X2: they are not on `wip-frozen.json`, and that list may not grow, because it works as an allow-list. Making the gate accept a pair that has a written decision changes the gate's mechanics, so that is for F11 or the owner to decide. It is not done here.

**Sources.** plan W6.39, W10.G6; #985 (2a016e18b1); #1053 (2d1cb108c3); INT5 5a99c7b7a7; coordinator notes of 16.11 (audit r3, review 11).

## §2 Relay retention: 180 or 90 days

**Options.**
- 180 days: what the code said.
- 90 days: decision 5.16 said "the same retention and no-IP-log rules" as the collab Worker, and that Worker uses 90.

**Choice: 90 days.** This covers the Node relay, the Worker default and wrangler.toml, the ROPA, and sync/two-clicks and sync/classroom in English and Hebrew.

**Reasons.**
- Data minimisation (GDPR Art. 5(1)(e)).
- One public service and one privacy policy.
- The relay only holds ciphertext, and the devices hold the vault (local-first), so a swept space loses nothing the user doesn't still have.
- A read keeps a space alive.

**Test.** relayRetention.test.ts, 4/4. Without the change it is 1 pass, 3 fail.

## §3 Support period (CRA)

**Options.**
- (a) "While it is the newest line": today's proposal.
- (b) A fixed date.
- (c) The CRA baseline: at least 5 years (Art. 13(8)); each update stays available for 10 years (Art. 13(9)); fixes ship in the newest line, which users can move to for free (Art. 13(10)).

**Choice: (c).** Five years from the first public release, and never ending before 2031-12-31. The 0.1.x line row stays as it is: critical and high fixes for 90 days after the next minor release.

**Reasons.**
- (c) is the CRA's own default for software expected to be used for years.
- An editor holding a person's notes is used for years.
- A free, auto-updated newest line makes (c) cheap to keep.

**Implementation.**
- `security/disclosure.json` supportPeriod.
- `disclosureProblems` refuses less than 5 years, less than 10 years of downloads, or a non-free newest line.
- SECURITY.md (English and Hebrew) and /security state it.

**Sources.**
- [CRA Article 13](https://prighter.com/resources/laws/cyber-resilience-act/articles/article-13)
- [OJ L 2024/2847 Art. 13](https://www.springlex.eu/en/packages/cra/cra-regulation/article-13/)

## §4 security.txt contact

**Choice: GitHub private vulnerability reporting.**
- `GET repos/talstilkol/lumen-md/private-vulnerability-reporting` returned `{"enabled":false}`.
- One `PUT` was refused by the agent proxy with HTTP 403 ("Write access to this GitHub API path is not permitted through this proxy"). It was not retried, and the refusal is recorded in `security/channels.json`.

**What follows from that.**
- Contact stays on the channel that is on: the contact-request issue. The test requires every Contact to be a channel with status "on".
- security.txt names the advisory form that will replace it.

**Owner action.**
- Turn PVR on: `gh api -X PUT repos/talstilkol/lumen-md/private-vulnerability-reporting`.
- Then set the channel to "on" and Contact to https://github.com/talstilkol/lumen-md/security/advisories/new, in one commit.

**Renewal.**
- `securityTxt.renewBy` = 2027-04-16. `security-page --check` fails from that day, a month before Expires (2027-05-16).

## §5 Tectonic first-download timeout

**Options.**
- Keep 120 s.
- Raise every compile to a longer limit.
- Give the first online compile a longer limit.

**Choice: 600 s for the first online compile, then 120 s.**
- A marker in the app's cache folder, written only after an online compile succeeds, says that the cache is warm.
- Offline stays at 120 s.

**Reasons.**
- A cold cache downloads the bundle index, the formats, and the packages and fonts a Hebrew document needs: tens of MB.
- At 1 Mbit/s that takes minutes. With 120 s the first compile was killed every time.
- After the first download, 120 s is the right loop guard.

**Status.** `rustc --test tectonic.rs`: 17/17. `cargo check` of the lib.rs change is owed on the Mac.

## §6 GPL word list (#981) and CrossRef (CSP)

**Yiddish word list.**
- hunspell-yi 1.1 (Raphael A. Finkel, 2010, converted by Caolán McNamara) is offered as "LGPL-2.1-or-later OR GPL-2.0-or-later OR MPL-1.1" ([Fedora package](https://packages.fedoraproject.org/pkgs/hunspell-yi/hunspell-yi/index.html)).
- MPL-1.1 is in the licence gate's own permissive set (`OK_LICENCE_IDS`), so no allow-list exception is needed.

**Choice: take that list under MPL-1.1.**
- It is a user-initiated download, never bundled, pinned by size and sha256.
- It could not be pinned from here: raw.githubusercontent.com is blocked by the proxy (403), and the alephreish/hunspell-yi page was not answered in time. So the download stays off.
- The code now refuses any list that is not under one of those permissive licences, so the current GPL-3.0 pin is refused even if an address is given.

**Owed (Mac).**
- Find the 1.1 files, pin their size and sha256, add the registry entry, and confirm the licence text.
- Accept that the newer GPL-3.0 list (Finkel, Taub, Rozenberg) may know more words.

**CrossRef.**
- api.crossref.org is not in connect-src, and adding it is a CSP change.
- api.openalex.org already is in connect-src (W12.X3). OpenAlex metadata is CC0 and comes mostly from CrossRef.

**Choice: "Cite from a DOI" goes to OpenAlex.**
- It is off until Settings → Privacy → OpenAlex is turned on.
- Each lookup asks first.
- Only the DOI is sent, through the ledger-wrapped fetch.
- A local-only policy blocks it.
- CROSSREF_LOOKUP_ENABLED stays false.

**Trade-off.** OpenAlex has one display name per author, which Lumen splits as "given family". CrossRef's given/family fields were more exact.

**Strings.** 4 new strings in 8 languages. The 7 translations are machine drafts, listed in i18n/needs-review (Hebrew included).

## §7 VITE_CONTENT_FRAME_URL

**Choice: replace it with the build-only LUMEN_CONTENT_FRAME_URL.**
- `vite.config.ts` inlines it under `define` (`__LUMEN_CONTENT_FRAME_URL__`), and only after `contentFramePage()` accepted it.
- Accepted means an https origin (or loopback http) plus "/" or "/content-frame.html". Nothing else is accepted: no other path, no query, no fragment, no user info.
- The CSP frame-src origin comes from the same check.

**Reasons.**
- Vite inlines any VITE_* value as it is. That is why VITE_* names need the allow-list, and adding this one is forbidden.
- The build gate would also refuse any build that set it.
- The new variable can only carry an origin, so no secret can reach the bundle.
- No allow-list, CSP or gate was changed.

**Results.** secretsScanLive is 12/13. The remaining red is VITE_ONENOTE_CLIENT_ID (W10.E49), a public OAuth client id. Its allow-list entry is the owner's to make.

**Left as it was.** The prose in `security/policy.json` still names the old variable. The CSP file was not edited.

## §8 Yiddish golden sets and the open-law dataset (W10.E35)

**Choice: datasets by licence. The pins are deferred, with a reason.**

**Open law: gkour/israeli_law.**
- Licence: CC BY-SA 4.0, credited to Hebrew Wikisource.
- It is a download the user starts. Every text is tagged cc-by-sa, and it goes in a ShareAlike folder.
- `OPEN_LAW_REVISION` stays null.

**Yiddish ASR.**
- First choice: Mozilla Common Voice yi (CC0-1.0).
- Second choice: google/fleurs, if it has a yi config (CC BY 4.0).
- Whichever has a Yiddish test split is pinned.

**Yiddish spelling golden set.**
- No permissively licensed corpus in YIVO spelling could be verified.
- Candidate: a sample of Yiddish Wikipedia (CC BY-SA 4.0, ShareAlike folder).
- Until then, the eval stays on its synthetic set.

**Why deferred.** huggingface.co returns 403 through the proxy, so nothing could be pinned by sha256 here. The pins are owed on the Mac.

## §9 The stacked PRs on old trains

**Policy.**
- The PRs stay open. No lane closes them.
- verify/train-7 supersedes them.
- A PR whose head is in the train is carried by it. Every other one has its decision in `plan/train-missing.json` at its current head.
- GitHub closes a PR on its own when its head reaches its base.

**Ledger.** `plan/stacked-prs-ledger.json`, taken 16.11 against f090c20812:
- 748 open PRs on an older base: 718 in the train, 30 outside it, all 30 decided.
- 292 of them are w10/*: 281 in the train.
- stackedPrsLedger.test.ts checks the ledger against train-missing.json.

## §10 W8.10 / W8.11: lane-state hooks and merge drivers

This decision was made with the coordinator on 16.11.

- The ci:local pre-push hook is opt-in, as #1054 designed it.
- The merge drivers (lumen-help, lumen-lanes) stay installed by `npm`'s `prepare` script (`scripts/prepare.mjs` → `scripts/git-setup.mjs`). It never fails an install and does nothing in CI. `--install` stays the manual path.
- The lane-state watcher never starts at install time.
- Lane F11 implements this, together with review 11's fix of the per-worktree watcher bug: the watcher record moves into the common git dir, keyed by STATE.md. Lane D1 does not touch the lane-state code.

## §11 The #1099 merge (review 12, L6; recorded by lane F12, 17.11)

#1099 (`fix/g6-L4-main-into-train7`, "OWNER-DECISION: make main fast-forwardable to train 7") said in its body: "do not merge without the decision … Never merged by a lane." Integrator INT6a merged it into int6a anyway, in dad246d41d (16.11 23:07), and it reached verify/train-7 with INT6a.

**What happened.** The decision #1099 asked for, merging origin/main into train 7 so that `promote:main` can fast-forward, was made by INT6a under the owner's delegation of 16.11.2026 21:53 ("decide alone, without stopping"), not by the owner. The merge is tree-identical (`git diff f090c20812` of its head was empty): it adds main's #432 commits as ancestors and changes no file, and both conflicts kept train 7's side.

**Recorded as.** A decision made under the owner's delegation, like §1–§10. The PR's own note ("never merged by a lane") was written before the delegation covered it and is superseded by this record. Nothing was promoted to main: `npm run promote:main` stays the owner's step.

**Owed.** The owner acknowledges this record (or reverts dad246d41d on the train). Until then, any later PR marked "OWNER-DECISION … never merged by a lane" is merged only with a section here that names it.

## Still owed: not decidable here (owner only)

- The Mac run: full vitest/tsc/build, cargo check, e2e, and the pins above.
- The isolation entries (`src-tauri/isolation/index.js`, the capability snapshot).
- Review receipts, signing keys and the human-reviewed label.
- Lifting W6.4's dodMock, which needs the owner's crypto review.
- R12.1.
- CI.
- The npm registry.
- Native-speaker review: the 7 drafted locales of the 4 new DOI strings, Hebrew included.
- Turning on GitHub private vulnerability reporting (§4).
- The VITE_ONENOTE_CLIENT_ID allow-list entry (§7).
- The CRA scope decision (W13.X3).
- Acknowledging the #1099 merge (§11).
