---
title: Student mode
description: Record a lecture, tap Important at the moments that matter, and get a transcript with a ▶ for every sentence, a summary taken from what was said, and review cards linked to their moments. All on this device.
type: reference
tasks: ["W12.H5", "W5.13"]
---

`⌘K` → **Student mode: record a lecture**:

1. Name the lecture and press **Start recording**.
2. When something matters, press **⭐ Important!** or the space bar. A tap
   marks what was said in the 20 seconds before it and the 5 seconds after
   it, since you hear a point a moment before you tap.
3. Press **Stop and process**. The recording is transcribed on this device
   with the local Whisper model, and the lecture note opens.

## The lecture note

`Lectures/<date> <name>.md`, with the recording in `Lectures/audio/`:

- **Summary:** the marked sentences, then the most central ones, in the
  order they were said. Each sentence is copied word for word from the
  transcript, with a ▶ to its moment.
- **Review cards:** one per marked sentence. Its key word is blanked out
  (`Mitosis splits one cell into two ____ cells. :: identical — ▶ 0:21`).
  The cards use the `question :: answer` lines that **Daily review** picks
  up, and each answer links to its moment in the recording.
- **Transcript:** every sentence with its own ▶ (a link into the recording),
  and the marked ones starred.

## Privacy

The recording, the transcript, the summary and the cards stay in your
vault. Transcription uses local Whisper under every AI policy: a lecture is
never sent to a cloud service. The Whisper model is downloaded once, the
first time it is used, and then comes from the browser's cache.

## Limits

- A 90-minute lecture should be processed in under 20 minutes on a laptop
  with a GPU. That has not been measured yet: transcription speed depends on
  the device and on the Whisper model.
- The summary picks sentences; it does not write new ones. When the local
  summarizer (plan 6.11) is installed, it can choose them instead. Whatever
  it returns must be sentences of the transcript.

## A syllabus by the semester's weeks

`⌘K → Create a syllabus…` makes a note with one heading per teaching week
of the semester, from your institution's academic calendar:

1. Save the academic calendar (`.ics`) in the vault. If there is more than
   one, you pick which.
2. Type the course name. The note is created as `Syllabus/<course>.md`.

The semester is the first one in the calendar that hasn't ended yet. The
weeks run from its first day to its last, by your work week (Sunday to
Thursday in Israel). A week that is all break is skipped and not counted;
a week with a holiday or a break day lists those days as no classes. Write
each week's readings as task items (`- [ ] chapter 3`) and its deadlines as
`- Deadline: 2026-12-20 Exercise 2`. A deadline on Shabbat or a chag gets a
suggested working day; the date you wrote stays. Nothing is fetched: the
calendar is read from the vault.
