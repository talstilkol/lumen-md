---
title: Meeting transcripts with speakers
description: Transcribe a meeting recording on this device with who said what, name each speaker once, and get the meeting notes on top.
type: how-to
tasks: ["W10.B7", "W2.7"]
---

`⌘K → "🎙 Transcribe a meeting recording (who said what)…"` takes an audio
or video file of a meeting and inserts, at the cursor:

1. the [meeting notes](/ai/meeting-notes/) (decisions, tasks, open questions),
2. the transcript, one sentence per line, each with its speaker and a time
   that plays the recording from there,
3. a small `lumen-speaker-turns` block: who spoke when, used for renaming
   and for measuring accuracy.

```markdown
**Dana:** [▶ 0:07](<attachments/2026-11-10-weekly.m4a#t=7,10>) Hi everyone.
**Avi:** [▶ 0:10](<attachments/2026-11-10-weekly.m4a#t=10,14>) Let's start with the quarter's budget.
```

## How it works

Everything runs **on this device**:

- **Words**: the same Hebrew Whisper as
  [file transcription](/ai/whisper-desktop/) (ivrit.ai's model in
  whisper.cpp on the desktop app, or Whisper in the browser).
- **Speakers**: the two networks of pyannote speaker-diarization 3.1, run
  with ONNX Runtime. The segmentation network finds who is speaking in each
  10-second window (up to three people at once, overlaps included). A voice
  embedding is taken for each person in each window, and the embeddings are
  clustered into the meeting's speakers (S1, S2, …). Each sentence then
  gets the speaker who talks most during it.
- **Names**: for each speaker you're asked once for a name, with their
  longest sentence as a reminder. Leave it empty to keep `S1`.

The diarization models are downloaded only after you agree (the size is
shown first), from a pinned revision with its size and checksum checked,
and they're kept on the device. Until the owner has pinned them, the
transcript is inserted without speakers and a notice says so.

## Rename a speaker later

`⌘K → "Rename a speaker in this note…"` picks a speaker and renames them
everywhere in the note at once: every `**Name:**` label and the turns
block. Other text (for example a task that mentions `S1`) is left alone.

## Accuracy

**The DER has not been measured yet.** The unit tests run the pipeline on
stand-in networks, so they show that the post-processing works, not how
accurate the speakers are. `node scripts/eval/der.mjs --audio clip.wav --ref
clip.rttm` runs pyannote 3.1 on a public clip with a human RTTM (VoxConverse
or AMI, both CC BY 4.0) and scores it. It needs Python, pyannote.audio and a
Hugging Face token, and without them it says "NOT measured".

The target is a diarization error rate (DER) of at most 20% on five Hebrew
golden recordings, and an hour of meeting processed in under 15 minutes on
a Mac M1. The DER is scored with
`node scripts/meetings/der.mjs --golden <dir>` against hand-checked RTTM
files; only numbers are printed.
