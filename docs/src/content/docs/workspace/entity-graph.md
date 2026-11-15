---
title: Entity graph
description: People, places, organisations, events, laws, sources and concepts found in your notes, each relation backed by an exact quote from a paragraph, reviewed by you before anything is written.
---

## What it is

The entity graph collects the people, places, organisations, events and
dates, laws, sources and verses, and concepts that your notes mention, and
the relations between them ("born in", "member of", "cites", …).

- **Every relation has a source.** Each one stores the note, the
  paragraph's `^id`, the exact words that state it, a hash of the
  paragraph, what found it (rules or which local model) and when. If the
  paragraph changes later, the relation is marked **Source changed**.
- **Nothing is written without you.** Extraction only makes proposals.
  They wait in **Graph proposals**, where you approve, reject, merge or
  split them. Each action can be undone in one step.
- **Plain notes.** An approved entity is an ordinary note under
  `ישויות/<type>/`, with `aliases` and its relations as properties, so
  Obsidian, Bases and Dataview read it too.

## How entities are found

- **Rules, always:** Hebrew-calendar and Gregorian dates, law titles with
  their Hebrew year (`חוק …, התשמ״ד-1984`), and verse and Talmud
  references.
- **A local model, when it is on this device:** DictaBERT-NER for Hebrew.
  Without it the panel says **Rules only**. Nothing is downloaded on its own.
- **Hebrew prefixes:** "לירושלים", "בירושלים" and "שבירושלים" are one
  entity. A prefix is removed only when what remains is an entity you
  already have, so "משה" stays "משה".
- **Relations** need a local model (Ollama, WebLLM, Transformers.js or
  LM Studio). There is no cloud path. The paragraph is treated as
  untrusted text, the extractor has no tools, and a relation whose quote
  is not word for word in the paragraph is dropped.

## Pages, views and export

- Each entity has a page: its relations grouped by type, each linking to
  the paragraph it came from, and every mention with its context.
- Each type has a Bases file (`ישויות/אנשים.base`, …).
- The entity graph view filters by type, relation, source folder or tag,
  and confidence. It has a time slider (right to left in Hebrew) with
  play, a 1–3 step neighbourhood, and a table that shows exactly what the
  graph shows. In the table, ↑/↓ move between rows, ←/→ step to
  neighbours, and Enter centres the view.
- Export to JSON-LD (schema.org), GraphML, RDF/Turtle with PROV-O, or
  Neo4j `neo4j-admin import` CSV. Every relation keeps its source.
