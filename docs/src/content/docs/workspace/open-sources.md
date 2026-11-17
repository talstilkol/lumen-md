---
title: Open sources
description: One search over Sefaria, the Knesset, data.gov.il and the CBS, and the Ben-Yehuda library, with the rights of every result and the right way to quote it.
type: reference
tasks: ["W7.24", "W11.H16"]
---

Every open Hebrew source comes with its own terms. The **Open sources**
dialog searches them together and quotes each one the way its terms allow,
so you don't have to know what section 6 or the CBS licence say.

Open it with **⌥⌘S** (Ctrl+Alt+S on Windows and Linux) or **Open sources…**
in the command palette. (Ctrl+Shift+S stays Save as.)

## Search

- Type a verse (`בראשית א:א`), a law (`חוק הגנת הפרטיות`), a poem
  (`ביאליק בריכה`) or a statistic (`מדד המחירים לצרכן`).
- Results from this device appear as you type: references, laws you saved,
  and the Ben-Yehuda works you downloaded. Nothing is sent.
- **Search online** (Alt+O) asks first, then sends only your words, and
  only to the sources you turned on. Each request is in the privacy ledger.
- Filter by kind: Jewish sources, laws, literature, datasets or statistics.

## Rights

Every result has a badge:

| Badge | What Lumen puts in the note |
| --- | --- |
| Public domain, CC0 | the text, with credit |
| CC BY, CC BY-SA | the text, with the credit the licence asks for |
| §6: laws and Knesset records | the citation; a saved law may hold its full text |
| CBS licence | the data, with the CBS attribution wording |
| Government open data | the data, with data.gov.il's credit |
| Link only | a link and the credit, never the text |

A Sefaria verse shows "Link only" until its text is fetched. Then each
translation's own licence decides what is copied.

## Turn sources on and off

The switches at the bottom of the dialog turn each source on or off. A
source that is off gets nothing at all. Sefaria starts on; the Knesset,
government data and the Ben-Yehuda library start off.

## The Open Book of Laws, on this device

**Open Book of Laws (offline)** searches Israeli laws as Hebrew Wikisource
edits them (the dataset `gkour/israeli_law`, CC BY-SA 4.0). Lumen does not
download it: download the dataset yourself as JSON lines (a JSON array or a
datasets-server page also works), turn the source on, and choose
**Import a file…** under its switch. The file is read on this device and
kept in the vault, in `.lumen/openlaw/`; nothing is sent, before or after.

- Type a law or a section the way you write it: `סעיף 12 לחוק החוזים (חלק
  כללי)`, `חוק המכר, סעיף 11`, `ס' 2 לחוק הגנת הפרטיות`, a Basic Law.
- A section goes into the note as a quote with its citation, the CC BY-SA
  licence, Wikisource's credit and a link to the page. A whole law goes in
  as a citation link with the same credit.
- It is **not an official source**: every insertion says so. For the
  official text, cite the law from the Knesset.
- A Supreme Court reference (`בג"ץ 6821/93 …`) is a ruling: a title and a
  link only, until the rulings' licence is clear.
- **Replace with another file…** imports a newer copy; the old one stays
  in use until the new one is complete, and **Cancel import** keeps it.

## Keyboard

↑ and ↓ choose a result, Enter inserts it, Alt+O searches online, Esc
closes, and Tab reaches the filters and the switches.
