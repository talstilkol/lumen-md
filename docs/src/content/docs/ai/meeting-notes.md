---
title: Meeting notes on this device
description: Record a meeting, transcribe it on this device, and get its decisions, tasks with owner and date, and open questions — tasks in the task panel, dates in a calendar file.
type: how-to
tasks: ["W11.I19"]
---

`⌘K → "🎙 Meeting notes (record on this device)"`, or **Meeting** in the
capture box, opens the meeting recorder. It records, shows the live
transcript while people speak (the Hebrew dictation model, when it is on
this device), and when you stop it writes a meeting note in `Meetings/`. For
a transcript you already have, use `⌘K → "AI: Meeting Notes from a
Transcript"` on the note (or a selection).

## The meeting recorder

- **On this device only.** The transcript comes from the live dictation
  model, then from a Whisper model already in the browser (a final pass with
  word times); with neither, the recorder says **unavailable** and records
  nothing. It never downloads a model by itself: get one under *Settings →
  Models* first.
- **A time at least every minute.** Every transcript line starts with
  `[▶ 3:12]`, which plays the recording from there; no line covers more than
  60 seconds.
- **Checked against the transcript.** The summary is the checked summary of
  student mode: every sentence copied from the transcript by a local model,
  or the most central sentences when there is no local model. Decisions,
  tasks and open questions come from the `meeting-writer` agent on local
  models only, and each one must share most of its words with a sentence of
  the transcript; one that doesn't is left out, and the note says how many.
  (This is a word check, not a meaning check.)
- **Tasks with their moment.** Each task line links to the moment it was
  said and carries `⏳` the meeting's day when no due date was said, so it is
  in *Today* in the task panel. The note's frontmatter has `type: meeting`,
  so the *Team meeting* Base lists it.
- **You approve the save.** What a transcript produces is outside content,
  so the recorder asks before it writes the note; if you decline, nothing is
  written and the note is shown to copy.
- **Speakers only for real.** Speaker labels appear only when the pinned
  speaker-identification models ran (see [meeting speakers](/ai/meeting-speakers/));
  without them the recorder says so and no line has a label.
- On a phone, recording with the screen off needs the native app.

## What you get

```markdown
## Meeting · 2026-11-09 · 🛡 local

### Decisions
- Ship on Tuesday

### Tasks
- [ ] Send the budget (@Avi) 📅 2026-11-18
- [ ] Find out who pays for the venue

### Open questions
- Who pays for the venue?
```

- **Tasks** are checkbox lines in the [tasks format](/workspace/tasks/)
  (`📅` for the due date), so they appear in the task panel's *Today* /
  *Upcoming* and in `tasks` blocks once the note is saved. The owner is kept
  in the text as `@name`.
- **Dates** the meeting mentions ("next Wednesday") are worked out from the
  meeting's day; a date that isn't a real `YYYY-MM-DD` date is sent back to
  the model once, and an owner or date nobody said is never added.
- **Calendar.** When tasks have dates, Lumen offers to save them as an
  `.ics` file (one to-do per task, due on its date) for any calendar app.
- The transcript stays below the notes, folded.

The agent runs through the agent runtime: under the *local only* policy on
a local model (Ollama or the in-browser model).

## Measuring it

`npm run eval:meetings` reads the owner's golden meetings (plan 7.10
`meetings`, 15.11 — never committed) from `LUMEN_EVAL_MEETINGS_DIR` and
reports the share of each meeting's reference action items the notes found
(target: ≥ 90 %).

The meeting recorder's tasks are measured on a public recording: 30 minutes
of a Knesset committee from `ivrit-ai/knesset-committees`
(`eval/public/meeting-knesset-committees.json`), reviewed by three people. A
task counts when two of the three wrote it; `npm run eval:meeting-tasks --
--note <the meeting note> --review <review.json>` prints the share of the
note's tasks that are in that list (precision) and the share of the list it
found (recall). The recording is not pinned and the review is not written
yet, so there is no number yet.
