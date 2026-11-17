# Audit funding: drafts for the owner (plan W13.S5)

Two applications, ready to paste, that pay for the external audit W11.O6
orders. Both cite the audit pack (`node scripts/sync-protocol/audit-pack.mjs`,
plan W13.S4): build it, attach `lumen-sync-audit-pack.tar` and its SHA-256.

| Route | What it funds | Draft | Owner step |
|---|---|---|---|
| NLnet NGI Zero (Commons Fund) | a project grant (the call text gives the cap) that can include an independent security audit | [nlnet-ngi-zero.md](nlnet-ngi-zero.md) | submit at nlnet.nl/propose in the next call; ask NLnet first about the European dimension for an applicant in Israel |
| OSTIF | a security audit of an open-source project, run with an audit firm | [ostif.md](ostif.md) | send the request through ostif.org |

The submissions themselves, with their dates and confirmation e-mails, go
to `reports/owner/` (kept out of git) and the signed receipt to
`npm run owner:session` — never by an agent. Placeholders in `<…>` are the
owner's to fill; no agent writes the owner's name or contact details.
