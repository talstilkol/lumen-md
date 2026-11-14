# Data protection impact assessment: the share server (W11.S11)

**Not legal advice.** This file is part of the legal review packet (W6.37).
It is short on purpose. It updates the assessment in `PRIVACY.he.md` (W4.8)
to what the code does now, in the shape GDPR Art. 35(7) asks for.

**Scope:** `sync-server/collab-server.mjs` (the persistent Hocuspocus server),
`sync-server/server.js` (WebRTC signalling) and `edge-workers/collab/`.
**Status:** the code is ready, but no public server runs. This assessment
comes before one does.

## (a) What is processed, and why

The server relays and keeps shared rooms so people can edit together and
join when no one else is online. See [ropa.md §2](ropa.md) for the data:

- the room state, encrypted in every new room;
- room names (128 random bits);
- times and sizes;
- IP addresses in the signalling log, unless `SIGNAL_QUIET`;
- random display names, live only.

There are no accounts, no tracking and no analytics.

## (b) Necessity and proportionality

- **Minimal:** the server holds what a room needs to be joinable later, and
  no more. Display names are random and never stored.
- **Limited in time:** rooms not changed for 90 days are deleted
  (`COLLAB_RETENTION_DAYS`), and 24 hourly backups are kept.
- **Content unreadable to the operator:** in every new room it is encrypted
  end to end, with the key in the invite link.

## (c) Risks to the people in a room

| Risk | Likelihood / severity before measures | Measure | Remaining |
|---|---|---|---|
| The operator or an intruder reads notes | possible / high | End-to-end encryption in every new room | **Rooms from before encryption are plain text.** Decision below. |
| Metadata shows who works together and when | likely / low | Random room names, no accounts | The IP address and times, while `SIGNAL_QUIET` is unset |
| Data kept forever | certain / medium | 90-day sweep, 24 backups | Backups trail deletion by up to 24 hours |
| Someone joins a room uninvited | possible / medium | HMAC room tokens (one room, 10 min), `COLLAB_ACCESS_KEY` | Without an access key, the room name is the permission |

## (d) Measures still required before a public server runs

1. `SIGNAL_QUIET=1`, or a log with no IP address.
2. **Refuse rooms without encryption on a public server.** This is a decision
   for the owner. It is recorded here as "required", not as done.
3. `COLLAB_ACCESS_KEY` set on any server open to the internet.
4. The breach runbook ([breach-runbook.he.md](breach-runbook.he.md)) known
   to whoever operates it.

**Conclusion:** the risk to the content is low once (d) is done, and the
remaining risk is metadata. A lawyer's opinion (W6.37, question 3) is
still owed.
