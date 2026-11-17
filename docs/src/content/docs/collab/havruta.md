---
title: "Havruta: study with a partner"
description: A shared, end-to-end encrypted study room on a Sefaria reference. Your notes travel, the text stays on each device, and the room is deleted when you finish.
type: reference
tasks: ["W12.H2"]
---

A havruta room is a study session for two on one reference, such as a daf, a
chapter or a verse. Each of you sees the text with its translation where its
licence allows, and next to every segment your notes and your partner's.

## Start a session

1. Put the cursor on a reference in a note, for example `Berakhot 2a` or
   `בראשית א:א`, or open the reference's saved source note.
2. In the command palette, choose **Study with a partner (havruta)…**.
3. Send your partner the invite: **Copy invite link**, or **Invite QR code**
   to show on screen. No account is needed.

## What travels and what doesn't

- **The text never leaves your device.** The room holds the reference, your
  notes, highlights (as positions, not words) and where each of you is. Each
  side loads the text itself: from the vault's offline copy first, otherwise
  from Sefaria after you agree, as when you insert a source.
- A note that repeats six or more words of the text in a row is refused.
  Point at the segment instead. This keeps the room clear of texts whose
  licence does not allow sharing.
- A version whose licence does not allow copying is never loaded. It is
  listed with its licence and a link to read it on Sefaria.
- Everything in the room is end-to-end encrypted with the room's password,
  which is only in the invite link's `#` part. The relay sees ciphertext.

## On the study screen

- **↑ / ↓, Home / End** move between segments; **Enter** goes to the note
  box and **Escape** comes back.
- **Follow my partner** scrolls with your partner. Their place and their
  selection show in their colour.
- **Hide niqqud / Show niqqud** changes only what you see. Unpointed text,
  such as Aramaic, can be pointed on the device for reading.

## Offline, and the end of a session

- A session works without a network: your notes are kept on the device and
  merge with your partner's when you both reconnect.
- **Save to vault** writes a note named `חברותא — <reference> — <date>` in
  `Havruta/`, with both partners' notes and a link to the passage.
- **End session** saves that note and deletes the room from the relay. Your
  partner's screen saves its own note too. A room nobody touches for 30 days
  is deleted anyway.
