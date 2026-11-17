---
title: AI-written text
description: Text the AI wrote is shown lighter until you edit it — in the editor, saved per note, and optionally in the export.
type: how-to
tasks: ["5.9", "W10.E37"]
---

Whatever an AI command puts into your note — a draft from **Write**, a
**Rewrite** of a selection, an accepted completion, a template, an answer
you insert — is shown **lighter** in the source editor. The moment you edit
a word of it, that word is yours and looks like the rest of your text.

## How it works

- Every AI command runs through the agent runtime, which keeps the recent
  answers (for 15 minutes) on this device.
- When text lands in the note **without you typing it** — at the cursor,
  over a selection, or as an update of the whole note — Lumen checks it
  against those answers and marks the parts that came from one. An answer
  that was reformatted on the way (quoted, put in a list) is still found,
  line by line.
- What you type, paste or drop is never marked. Typing inside a mark cuts
  that part out of it; deleting shrinks it.
- The marks are saved per note on this device. A mark comes back only if
  its text is still exactly the same, so a note edited elsewhere never
  shows a stale mark.

## Show or hide

Command palette → **AI text marks: show / hide**. The choice is remembered.

## In the export

Command palette → **Export Markdown with AI marks** downloads the note with
one HTML comment at the end:

```markdown
<!-- lumen-ai-authorship v1: 120-340 512-640 -->
```

Each pair is a range of the text before the comment (start and end, in
UTF-16 code units, end not included). Markdown renderers show nothing for
the comment. The ordinary exports and **Save** leave it out.

## Limits

- The marks show in the source, split and WYSIWYG views. Text the AI inserts
  in WYSIWYG is marked as it is inserted. A mark whose place can't be found
  exactly in the WYSIWYG document (one inside a link's address, say) is left
  out there rather than guessed; the source view still shows it.
- An answer older than 15 minutes, or text you copy from an answer and
  paste, is not marked.
