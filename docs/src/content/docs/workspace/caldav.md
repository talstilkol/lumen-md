---
title: Calendar sync (CalDAV and ICS)
description: Keep the vault's dated tasks in sync with a CalDAV calendar (Fastmail, Nextcloud, iCloud), and see subscribed calendars' events in the daily note.
type: how-to
tasks: ["W7.20", "W10.C4", "W10.C5", "W10.C6"]
---

## Connect an account

**Settings → Calendar.** Lumen sends nothing to a server until you set it
up there.

1. Under **CalDAV account (tasks)**, enter the calendar home address, your
   user name and an app password, then **Find my calendars** and choose one.
   Only `https` addresses are accepted.
2. **Test the connection** says how many tasks the calendar has, or why it
   failed (a refused password, no calendar at that address, a server that
   doesn't allow this app).
3. Pick the note that receives tasks made on the server, then **Save**. The
   password goes into the secret store, not into settings.
4. **Sync tasks now** reports what was sent, received and left in conflict.
   **Forget the account** removes the account and its password from this
   device.

Under **Subscriptions (read only)**, add a name and an ICS address for each
calendar whose events should appear in the daily note.

When a task changed in both places, the conflict dialog shows the version
**In Lumen** and the one **On the calendar server**, and offers **Keep
mine**, **Keep theirs**, **Keep both** or **Decide later**.

## Tasks, both ways

Tasks with a date (`📅` due or `⏳` scheduled) sync with one CalDAV task
calendar as VTODOs. An edit on either side reaches the other: create, edit
the text or the date, mark done, delete. Tasks made on the server (on an
iPhone, in Thunderbird, in Nextcloud) are added to the inbox note,
`Tasks/Calendar.md` by default.

Each synced task carries a hidden id at the end of its line:

```markdown
- [ ] Send the report 📅 2026-11-20 <!-- lumen-caldav:lumen-7f3a -->
```

Other Markdown readers don't show it. Don't remove it: without it the task is
new to the calendar.

### When both sides changed

Each sync compares both sides with what they agreed on last time. If only one
side changed, its version wins. If both changed the same task, or one side
deleted a task the other edited, Lumen shows both versions and you choose
(in the conflict dialog):
keep this device's, keep the server's, or keep both. Nothing is overwritten
without asking.

## Subscriptions in the daily note

Add a calendar's ICS address (a "secret address" or a `webcal://` link) and
that day's events appear in each daily note, in a block between
`<!-- lumen-calendar:start -->` and `<!-- lumen-calendar:end -->`. The block
is read-only and is replaced on refresh. The rest of the note is never
touched. Recurring events, multi-day events and moved instances are handled.

## Privacy

- The password and the subscription addresses are kept only in the secret
  store, never in settings, files or logs. A private ICS address is itself a
  key.
- Every request appears in the privacy ledger as "CalDAV task sync" or
  "Calendar subscription".

## Desktop and web

In the web app, the server must allow this app's origin (CORS). If it
doesn't, Lumen says so instead of failing silently. The desktop app will send the
requests itself, so CORS won't apply there.

## Tested

200 random changes on both sides against a local Radicale server, with
conflicts answered at random, lost 0 tasks and duplicated 0. Create, done and
delete each reached the other side in one sync, in under half a second.
