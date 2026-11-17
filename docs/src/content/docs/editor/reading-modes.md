---
title: Reading modes and the reading profile
description: One menu for every reading mode, and a reading profile per note — font, width, niqqud, aids, layout, voice and speed — kept in the note's frontmatter or on this device only.
---

**View → Reading mode…** (or *Reading mode…* in the command palette) opens
one menu for every way of reading a note. Pick a mode, adjust the text and
the aids, and the page changes as you go. Close without saving and the page
goes back to what it was.

## Modes

| Mode | What it does |
|---|---|
| Page | The note as a clean page to read and highlight, alone or beside its translation. |
| One word at a time (RSVP) | Experimental. Each word at a fixed point with rewind built in. |
| Focus | A distraction-free screen for the editor. The line, the sentence or the paragraph you are in stays bright and the rest dims (as in iA Writer), with optional readability highlights. |

## Focus: sentence focus and readability highlights

In focus mode (**⇧⌘F**, or *Open Focus* in the menu) the bar at the top
chooses what **stays bright** — everything, the line, the sentence or the
paragraph at the cursor — and turns on **readability highlights**, in the
manner of Hemingway:

| Highlight | Underline | English | Hebrew |
|---|---|---|---|
| Very hard to read | double | a sentence over 30 words | over 25 words |
| Hard to read | solid | over 20 words | over 16 words |
| Passive voice | dashed | *was written*, *is done* | ״נכתב על ידי״, ״בוצע״, ״הוחלט״ |
| Adverb | dotted | words in *-ly* (not *family*, *early*…) | ״באופן …״, ״בצורה …״ |
| Simpler word exists | wavy | *utilize* → *use*, *in order to* → *to* | ״במסגרת״, ״על מנת ל״ → ״כדי ל״ |

Each kind has its own colour **and** its own underline, so no highlight
depends on colour alone. A legend counts each kind; it sits on the side
where reading starts — the left in English, the right in Hebrew. Hebrew
words carry their prefixes, so the Hebrew sentence limits are lower.

Sentences are found with the browser's Intl.Segmenter (Hebrew and English
rules), extended to end a sentence at the sof pasuq (׃) and not after an
abbreviation (*Dr.*, *e.g.*). Headings, list items, quotes, table rows and
code blocks are their own paragraphs; code, inline code, frontmatter and
link targets are never highlighted.

The highlights are drawn on the screen only: the note is not changed. When
the clarity and style coach is installed, its findings are shown in the same
colours instead of these rules. Sentence focus and highlights work in the
source editor; in the rich-text editor or the preview the bar offers to
switch to it.

## One word at a time (RSVP) — experimental

The note is shown one word at a time at a fixed place, with the letter the
eye should land on (the *recognition point*) in colour under two ticks.
Speed-reading apps like this are popular, but the research found that
**comprehension falls when you cannot look back** (Schotter, Tran & Rayner
2014; Rayner et al. 2016). So this reader has rewind built in:

- **Back a sentence** (button, **Backspace** or **Shift+arrow**) goes to the
  start of the sentence, and again to the one before.
- When paused, the whole sentence is shown under the word, the word
  underlined.
- It stops longer at the end of a sentence and a paragraph, after a comma
  and on long words.

Keys: **Space** plays and pauses; the **arrows** go a word back or forward
along the text — in Hebrew → is back and ← is forward; **↑ ↓** change the
speed (150–600 words per minute).

The recognition point follows Spritz's table: the 1st letter of a 1-letter
word, the 2nd of 2–5 letters, the 3rd of 6–9, the 4th of 10–13, else the
5th. In Hebrew it counts from the right, and from the stem: in words of five
letters or more the prefix letters (ו ה ב כ ל מ ש) are skipped, leaving at
least three — ״וכשהבית״ is read from ״בית״. A word that only looks prefixed
(״מחשבה״) puts the point one letter later. Niqqud stays on its letter.

## Anchor emphasis — experimental, weak evidence

*Anchor emphasis* draws the first 40% of every word a little heavier (at
least one letter), in English and in Hebrew — the idea sold elsewhere as
"bionic reading". Some readers like it, but **the evidence that it speeds
reading or helps comprehension is weak**: the published replications found
no reliable gain. So it is off by default, labelled experimental in the
menu, and measured in our own reading study (below).

It is drawn as a highlight over the text, not by changing it: the note and
the page's text stay exactly as they are, a word is never split, so the
browser shapes it as one piece, and the cut always falls between whole
letters — niqqud and cantillation marks stay on their letters. Code, keys,
math and the editor are never marked. It needs the CSS Custom Highlight API
(Chromium 105+, Safari 17.2+, Firefox 140+); elsewhere it shows nothing.

**The A/B test.** In the owner's reading study (six readers), each reader
reads four comparable passages — two Hebrew, two English — two with anchor
emphasis and two without, the order and the passage–condition pairing
counterbalanced. We record the reading time per passage and three
comprehension questions per passage, and ask which they preferred. The
result will be written here; until then the option stays experimental.
*Result: not yet measured.*

## The reading profile

Every mode reads the same profile: the Hebrew font, text size, line height,
column width, spaced Hebrew, the dyslexia-friendly font for English,
niqqud for display, the dyslexia-friendly layout, line focus, page colour,
the layout, the voice and the read-aloud speed, and each mode's own options.

- **Save for all notes** makes it the profile of every note.
- **Save for this note** keeps only what differs from that, either
  - **in the note's file**, as one line of its frontmatter:

    ```yaml
    ---
    title: Bereshit
    lumen-reading: {mode: focus, width: 60, nikud: show}
    ---
    ```

    The note then reads the same way on every device and in every vault
    that opens it. Only that line is written: the rest of the frontmatter
    and the body stay byte for byte. A frontmatter with a YAML error is
    never written — save on this device instead, or fix it first.
  - or **on this device only**. The file is not changed at all.
- **Back to the settings for all notes** removes the note's own profile from
  both places.

When a setting is in more than one place, the closest one wins, setting by
setting: *this device* over *the note's file* over *all notes*. The menu
marks each setting that comes from the file or from this device.

Niqqud for display is drawn by the on-device model and never written to the
note ([Reading aids](../reading-aids/)).

## Hand-written profiles

`lumen-reading` may also be a block map:

```yaml
lumen-reading:
  mode: focus
  focusUnit: paragraph
```

Unknown keys and values of the wrong type are ignored; numbers out of range
are clamped (a `width: 200` reads as the widest column).

| Key | Values |
|---|---|
| `mode` | `page`, `focus`, `rsvp` |
| `font` | `default`, `heebo`, `frankRuhl`, `notoSans`, `notoSerif`, `assistant`, `davidLibre` |
| `size`, `lineHeight`, `width` | 14–28 px, 1.3–2.4, 40–120 ch |
| `spacedHebrew`, `dyslexiaLatin`, `aids` | `true` / `false` |
| `nikud` | `asWritten`, `show` |
| `lineFocus` | `0`, `1`, `3`, `5` |
| `tint` | `none`, `cream`, `blue`, `green`, `gray` |
| `layout` | `single`, `sideBySide` |
| `voice` | a voice name, or `""` for this device's voice for the note's language |
| `rate` | 0.5–2 |
| `focusUnit` | `line`, `sentence`, `paragraph` (with `mode: focus`) |
| `hemingway` | `true` / `false` |
| `anchor` | `true` / `false` (anchor emphasis, off by default) |
| `wpm` | 150–600 (RSVP) |
