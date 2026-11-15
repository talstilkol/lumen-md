---
title: Audio and video with a transcript
description: Embed a recording, read its WebVTT or SRT transcript beside the player, and click a line to jump there.
---

Write `![[rec.m4a]]` (or `.mp3`, `.wav`, `.ogg`, `.webm`, `.mp4`, `.mov`…)
in a note to embed a recording from your vault.

- **The transcript beside the player.** If a transcript file with the same
  name sits next to the recording (`rec.vtt`, in
  [WebVTT](https://www.w3.org/TR/webvtt1/), or `rec.srt`), its lines appear
  under the player with their times and speakers.
- **Click a line** to play from that moment. The line being spoken is
  marked as it plays.
- **Video:** the same track is used as captions.

## Where transcripts come from

**Transcribe a meeting** already writes the timed transcript into the
note. It now also saves it as `rec.vtt` and `rec.srt` next to the audio, so
the embed, a video player or a subtitle editor can use it. Nothing is
transcribed again, and the dictation code is unchanged. A `.vtt` or `.srt`
from another app works the same way.

The files are standard WebVTT and SubRip:
- WebVTT starts with `WEBVTT`.
- Each cue has a `start --> end` timing in order.
- Speakers are `<v Name>` voice spans.
- `&`, `<` and `>` are escaped.
