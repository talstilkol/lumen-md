---
title: Automations (when… then…)
description: Simple rules that file, tag and log your notes on this device — with a dry run that changes nothing, a log of every run, and undo.
---

An automation is a rule: **when** something happens to a note, **then**
Lumen does something. Rules run on this device only; nothing is sent
anywhere.

| When… | Then… |
|---|---|
| a note is created (anywhere, or in a folder) | move it to a folder |
| a tag is added (in the frontmatter or as `#tag`) | add a tag |
| a property changes (to any value, or to one value) | apply a template (its text, and frontmatter keys the note does not have) |
| every day (once a day) | add a line to today's daily note (`{{link}}`, `{{title}}`, `{{date}}`) |
| | add a task: a `- [ ] …` line in `Tasks.md`, or in a note you name |
| | run an agent on the note |

**Run an agent** doesn't change anything by itself. The agent's changes, or
its answer added to the note, wait in the review panel until you approve
them, as any agent's changes do. The dry run lists the agent it would start,
and undo has nothing of its own to take back for it.

## Make a rule

Command palette → **Automations: new rule (when… then…)…**: pick the
trigger, then the action, and answer one question for each (the folder,
the tag, the property…). The rules are kept in `.lumen/automations.json`
in the vault, which you can also edit by hand.

### When a row of a base changes

Pick **a row of a base view changes**, then give the base (for example
`Projects/Tasks.base`), the view (empty: the first) and, if you want, one
property to watch. The rule runs when a note that is in that view (by the
view's own filters, after the change) has a property changed, or when a new
note joins the view. A change to the text only doesn't count. Changes made
through the table, the property panel or a plugin's `bases.update` all
count. The filters see the note alone, so a filter that looks at other notes
(backlinks, a linked note's property) can't match here.

### When an object of a type is created, or its field changes

**An object of a type is created** fires when a note gets a type: a new
note with `type: person` in its frontmatter, or an existing note that is
given the type. A note that already had the type and is only edited does
not count. **A field of a type changes** fires when a field of an object of
that type changes: one field, one field to a given value, or any field.
The type is matched by its id or name in `type:`, which can be one value or
a list.

### Not on Shabbat or a holiday

Every new rule asks what to do on Shabbat and holidays. With **wait: not on
Shabbat or a holiday**, the rule does not run on Shabbat or on a yom tov:
Rosh Hashana, Yom Kippur, the first and last days of Sukkot and Pesach, and
Shavuot. Outside Israel, the second days count too, following the daily-notes
setting.

Shabbat and yom tov begin on the evening before, so the wait does too:

- **With a city** (calendar settings, *City for Shabbat and holiday times*),
  the wait starts at candle lighting on the eve, by your candle-lighting
  minutes or the city's custom, and ends when Shabbat or the yom tov ends
  there (the sun 8.5° below the horizon). A rule can run again on Saturday
  night once Shabbat is out.
- **Without a city** the app does not know when sunset is, so it waits from
  12:00 noon (device time) on Friday and on the eve of every yom tov, and all
  of Shabbat and the yom tov itself, until midnight. This is earlier than
  candle lighting anywhere, on purpose: it may wait a few hours too long, but
  never runs after Shabbat has begun. Pick a city for exact times.

- A daily rule that falls on such a day runs on the next weekday.
- A rule that a change would set off keeps the change and runs it on the
  next weekday.

The dry run lists every rule that waits, with the day it will run (`⏸ rule:
today is Shabbat; it runs on 2026-11-15`). The log, undo and the loop guard
work as for any rule.

## Dry run

**Automations: dry run on this note** shows what the rules would do to the
open note as if it had just been created — which rules, which files —
without writing anything.

## Undo

Every run is logged in `.lumen/automations-log.json` with the text of each
file before and after. **Automations: undo the last run** puts every file
back byte for byte, and moves moved notes back. When a file was edited by
hand after the run, undo stops and says which file, instead of overwriting
your edit.

## No loops

A rule's own changes can trigger other rules (tag → move → the move's
"created in Done" → tag), but a rule runs at most once per note in one
chain, and a chain stops after three steps. Two rules that would bounce a
note between folders forever stop after one round. A line added to the
daily note, or a task added to the tasks note, triggers nothing.

## How it was checked

`src/__tests__/automations.test.ts`: 20 golden rules, each run on a small
vault: the dry run writes nothing, the run gives exactly the expected
files, and undo gives back every byte; plus the loop guard, undo refusing
over a later edit, tags, the rules file and once-a-day.
