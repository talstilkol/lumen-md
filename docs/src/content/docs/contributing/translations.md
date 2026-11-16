---
title: Languages in beta, and how to help
description: English and Hebrew are Lumen's full languages; the other six were translated by machine and are marked Beta (machine translation, awaiting native review). How to report a translation issue from inside the app.
---

Lumen ships two **full** languages: **English**, the source, and **Hebrew**, written by
native speakers. The interface is also available in six more languages, but they were
translated by machine (plan 9.1) and no native speaker has reviewed them yet. Lumen marks
each of them **Beta (machine translation, awaiting native review)**, and you should expect
wrong or awkward wording in them:

A new Hebrew string can start as a machine draft too. Until a native speaker approves it
(`npm run i18n:draft -- --approve=he`), it is listed under `he` in
`i18n/needs-review/`. Today that is 7 strings, all from the academic export dialog:
`academic.chosen`, `academic.chosenUnverified`, `academic.exported`, `academic.noChoice`,
`academic.none`, `academic.pick` and `academic.unverified`.

| Language | Status |
|---|---|
| English | full (source) |
| עברית (Hebrew) | full (native) |
| العربية (Arabic) | beta |
| Русский (Russian) | beta |
| Français (French) | beta |
| Deutsch (German) | beta |
| 日本語 (Japanese) | beta |
| 简体中文 (Simplified Chinese) | beta |

Where you pick a language, a beta language says so, in the language you are using:

- **Command palette** (Language: …) and **Settings → General → Language**: "Русский — Beta
  (machine translation, awaiting native review)".
- **First-run setup**: each beta language carries the same marker under its name.

Under the language setting and on the first-run language step, a link opens this page at
[Report a translation issue](#report-a-translation-issue). When the interface is in a beta
language, Settings also says the translation is waiting for a native speaker's review and
links to the suggestion form.

The list of which languages are full and which are beta lives in one place,
`src/i18n/review.ts`; the picker, the first run, Settings and this table all follow it (a
test checks this table against it).

## Report a translation issue

Found a string that reads wrong, is cut off, or is still in English? Use **Suggest a better
translation** below; it is the quickest way and needs nothing but a GitHub account. If you
would rather not use GitHub, use **Copy the text** in the same form and send it to the
project any other way. Say which language, what you saw and, if you
can, what it should say.

## Suggest a better translation

Command palette → **Suggest a better translation** (also linked under the language setting).

1. Type the words you saw on screen. Lumen finds the strings that contain them, in your
   language or in English.
2. Pick the string and write it the way a native speaker would. Keep every `{placeholder}`
   as it is.
3. **Open on GitHub** opens the project's new-issue form in a new tab, with the title
   (`[i18n:ru] toolbar.save`), the labels `i18n` and `locale:ru`, the English source, the
   current translation and yours. You post it with your own GitHub account. **Copy the
   text** gives you the same text to send any other way.

Nothing is sent from Lumen itself: there is no server and no account in the app. The issue
exists only once you post it.

## Review a whole language

The easiest way is in the browser, on [Weblate](/contributing/weblate/): every fix comes back as a pull request.

If you are a native speaker and want to review a whole language, the strings are in
`src/i18n/locales/<lang>/*.json`, one file per area. Open a pull request with your fixes.
New strings drafted by a model are listed in `i18n/needs-review/` until a person approves
them ([Translation drafts](/contributing/translation-drafts/)). When a language has been
reviewed, its status in `src/i18n/review.ts` changes from `beta` to `reviewed`, and the beta
mark goes away.

Arabic is Israel's second right-to-left language, so its review also covers the RTL checks
(the RTL matrix, plan 9.5, runs in Arabic too).
