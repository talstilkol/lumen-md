---
title: Entity graph
description: People, places, organisations, events, laws, sources and concepts found in your notes, each relation backed by an exact quote from a paragraph, reviewed by you before anything is written.
type: how-to
tasks: ["W12.X3", "W12.E7", "W12.V2", "R12.8", "W12.E10", "W13.G4", "W13.G9", "R12.6", "R12.7"]
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
- Command palette (⌘K) → **Entity graph** opens the graph view over the
  workspace: the approved entities and relations and the citations
  (below), together. Double-click an entity in the table to open its note;
  Esc closes the view.
- The entity graph view filters by type, relation, source folder or tag,
  and confidence. It has a time slider (right to left in Hebrew) with
  play, a 1–3 step neighbourhood, and a table that shows exactly what the
  graph shows. In the table, ↑/↓ move between rows, ←/→ step to
  neighbours, and Enter centres the view.
- Export to JSON-LD (schema.org), GraphML, RDF/Turtle with PROV-O, or
  Neo4j `neo4j-admin import` CSV. Every relation keeps its source.

## How do two entities connect? Paths and saved views

- **Path finder** (a mode of the entity graph view): pick **From** and
  **To**, and Lumen finds the shortest chains of relations between them —
  several paths, with how many links each has. Limit the relation types
  and the longest chain. Each step names its relation (a reversed one
  says so) and opens the paragraph it came from, so a path reads as a
  chain of citations.
- **Saved views**: a colour and a size for each kind of entity (fixed, or
  by number of links), the kinds shown, and whether linked notes outside
  them are included. Save a view under a name, update it, or delete it
  (with undo). A Base or a query can open as a graph of its rows, and as
  a table again.

## Timeline

An entity or a case has a timeline: its claims in time order, laid out
right to left in Hebrew (the earliest at the right). Each claim shows how
certain its date is, in words, and links to its source paragraph. Claims
without a date are listed apart and never placed on the line.

- Dates are read from the text: Gregorian and Hebrew dates, with Hebrew
  prefixes, the run-together forms PDFs produce, and "yesterday" or "today"
  counted from the note's own date.
- The time checker asks about gaps: an impossible date, roles that overlap,
  an order that contradicts itself.
- **What did I know on date X** shows only what had been recorded by that
  day.
- On the keyboard the line is a list of buttons: the arrows move in reading
  order, Home and End jump to the ends, Enter opens the source.

## Reviewing and finding entities

- The graph's proposals appear at the top of the review panel (⌘K
  "Entity graph: proposals to review"), above the changes agents proposed.
- Each entity type is a type of its own: ⌘K "All People", "All Laws",
  "All Sources", … open its table, with its Base and its fields.

## Linking to Wikidata (optional)

Open an entity note and choose ⌘K "Entity: link to Wikidata…". Nothing is
sent until you choose "Search this once" or "Always on this device". Then
only the entity's name goes to www.wikidata.org, in Hebrew and in English,
and the request is listed in the privacy ledger. "Always on this device" is
an app setting: it is not kept in the vault, so a vault you open, clone or
import never brings it, and a settings file you import never turns it on.
Under the `local-only` AI policy nothing is sent, whatever you agreed: the
dialog says so. The item you pick is
saved as the note's `wikidata` property. Wikidata's data is CC0 (public
domain). In airplane mode the command is not shown.
## Sankey, matrix, claims and "why"

The view's **View** menu adds three ways to look at the same filtered
relations:

- **Relations between types (Sankey)**: how many relations run from each
  entity type to each other type. A `.base` chart view does the same for
  two properties: `chart: sankey` with `x:` (from) and `series:` (to).
- **Flows, one band per relation**: every relation is one band of the same
  width, so nothing is added up or compared by size; an amount is shown
  only as the note states it ("no amount stated" otherwise). "Up to the
  year" keeps the dated flows up to that year; flows with no date are
  always shown as their own group.
- **Adjacency matrix**: a table with a row and a column per entity and the
  number of relations in each cell, in community order (Leiden by default,
  or Louvain, or by name), so groups sit together along the diagonal. Up
  to 200 entities; a bigger graph shows its most connected 200.

In Hebrew the Sankey's sources are on the right. Each Sankey has a table of
its bands with an "Open" button, and on the picture the arrow keys move from
band to band and **Enter** opens one.

**Ego graph by default.** A graph of more than 50 entities opens around one
entity (the most connected, or the one you opened from), two steps out and
trimmed to 50, and says "50 of 1,234"; "Show the whole graph" is one click.

**The claim card.** "Why is this here?" on a relation (or Open on a band)
shows two separate grades, the NATO/Admiralty way: **A–F**, how reliable the
source note is (its `reliability:` if you set one, else its `source-class:`
— court/official A, primary/academic B, media/archive C, other D — else F,
cannot be judged), and **1–6**, how credible the information is (how many
notes state it and whether any rejects it). Under them: the quote with its
note and paragraph, and the chain note → paragraph → quote → line, with
the tool that proposed it and whether you confirmed it. A claim with no
quote is marked and can't be copied out.
## Citations

Sources ([reading list](/workspace/reading-list/)) cite each other, and the
graph shows that as **cites** relations:

- a `[@key]` citation in a source note's text (pandoc syntax; the source's
  own key is its `citekey:`);
- a link from one source note to another (`[[Other source]]`);
- `references:` of an item in your citation library (CSL-JSON, by cite key or
  DOI);
- `references:` of a source note (by cite key or DOI), for example the ones
  filled from OpenAlex. Such a relation names the note and its `references`
  property. A source note with the same cite key or DOI as a library item is
  that item, and a pair the library already gives is shown once.

Plain notes that cite are not sources, so they draw no edge. Each relation
keeps where it was seen: the note and paragraph, or the library file.
**Citations only** in the toolbar shows just these relations between
sources and laws; press it again to show everything. The table lists who
cites whom.

Looking up references in OpenAlex (by DOI) is optional and off by default.
The switch is **Settings → Privacy → Look up the references of a DOI in
OpenAlex**. While it is off, nothing is sent and nothing is asked. While it
is on, each lookup still asks you first, and then only the DOI goes to
api.openalex.org, which the privacy ledger lists. A settings file you import
never turns it on.

To look one up, open a source note (`type: source`) that has a `doi:` (or a
doi.org `url:`) and run **Citations: fill references from OpenAlex…** in ⌘K,
or press **Fill references from OpenAlex** in its properties panel. Save the
note first. The DOIs OpenAlex returns wait in **Property proposals** as a
`references:` change, before → after; nothing is written until you approve
it, and a rejected proposal writes nothing. References the note already has
are kept and not added twice. Once approved, each reference to a source in
your vault is a **cites** relation in the graph; the others are listed as
unresolved.
