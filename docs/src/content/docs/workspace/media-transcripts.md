---
title: Audio and video with a transcript
description: Embed a recording, read its WebVTT or SRT transcript beside the player, and click a line to jump there.
type: how-to
tasks: ["W2.7"]
---

Write `![[rec.m4a]]` (or `.mp3`, `.wav`, `.ogg`, `.webm`, `.mp4`, `.mov`…)
in a note to embed a recording from your vault.

- **The transcript beside the player.** If a transcript file sits next to
  the recording under its full name (`rec.m4a.vtt`, in
  [WebVTT](https://www.w3.org/TR/webvtt1/), or `rec.m4a.srt`) or under its
  name without the extension (`rec.vtt`, `rec.srt`), its lines appear under
  the player with their times and speakers. The full name is tried first.
- **Click a line** to play from that moment. The line being spoken is
  marked as it plays.
- **Video:** the same track is used as captions.

## Where transcripts come from

**Transcribe a meeting** already writes the timed transcript into the
note. It also proposes it as `rec.m4a.vtt` and `rec.m4a.srt` next to the
audio, so the embed, a video player or a subtitle editor can use it. The
two files wait in the review panel, like every change an AI feature makes,
and are written only when you approve them; a track that is already there
(one you corrected by hand, say) is shown there as the file being changed,
and is kept if you changed it again in the meantime. The names keep the
recording's extension, so `meeting.m4a` and `meeting.wav` never share a
track, and a second recording with the same name on the same day is kept as
`…-2.m4a` rather than over the first. Nothing is transcribed again. A `.vtt`
or `.srt` from another app works the same way.

The files are standard WebVTT and SubRip:
- WebVTT starts with `WEBVTT`.
- Each cue has a `start --> end` timing in order.
- Speakers are `<v Name>` voice spans.
- `&`, `<` and `>` are escaped.
