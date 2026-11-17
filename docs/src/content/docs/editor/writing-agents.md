---
title: Writing agents and their suggestions
description: Local writing checks and rewrites that only propose — every change is shown as a diff and goes into the note only when you accept it, in the editor or in the review panel.
type: how-to
tasks: ["W13.W1"]
---

The writing agents (clarity and style, tone, concision, consistency across
the vault, structure, argument, repetition, loan words, readability, the
abstract and "explain the change") read your text on this device and
**propose** changes. None of them writes to a note. A model, when an agent
uses one, runs on this computer only: an Ollama or LM Studio server on
another machine — even on your own network — is refused for these agents,
whatever the AI policy says.

## The suggestions panel

Running an agent from the command palette opens the suggestions panel next
to the editor. Each card shows what the agent found, why, how sure it is,
and the change as a word diff.

- **Accept** applies the card; **Reject** drops it; **Edit** lets you write
  the replacement yourself (your text is not marked as AI text).
- A card that changes several separate words has a tick per change: accept
  only the ones you want.
- **Accept all** applies every card as one edit: one Undo takes them all
  back.
- Keys: ↓ / ↑ move between cards, Enter accepts, Delete rejects, E edits,
  Esc closes. After an accept or a reject the focus moves to the next card.

Every agent hands its findings over in one shape: the span of text, the
kind of change, a short reason, how sure it is, and the change itself as
a diff. That is why every agent's suggestions are marked the same way in
both editors and are accepted or rejected the same way, one at a time.

## Two review paths

There are two ways a writing suggestion reaches a note, and both wait for
you:

1. **In the editor** (the suggestions panel above): for the note you are
   editing. The change is applied in the editor, so Undo takes it back.
2. **In the review panel** (the checks dialog, the vault consistency check,
   the abstract): for changes to notes that may not be open, or a report of
   findings with no replacement. Each change waits in the review panel with
   its diff; a suggestion that changes several separate words waits as one
   change per word group, so here too you can take some and leave others.
   A change whose text moved since is found again by its context or
   refused — never applied in the wrong place. Findings with nothing to
   replace (a fact that disagrees with another note, a weak argument) are
   gathered in one report note, which is itself a change you approve.

## Limits

- Scores and defaults are measured on synthetic sets for now ("dev"
  cards); measuring on real models is a Mac step (plan W13.W17).
- The readability scale for Hebrew (1–5, by intended reader) and the
  English Flesch–Kincaid grade are different scales: each is labelled.
