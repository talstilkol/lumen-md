# OSTIF audit request (draft)

*Fill the `<…>` fields and send through ostif.org (contact form or the
address the site gives).*

**Project:** Lumen (lumen-md) — open-source Markdown editor with end-to-end
encrypted sync
**Repository:** the public repository · **Licence:** see LICENSE
**Maintainer contact:** `<name>`, `<e-mail>`

**What we ask:** an independent security audit of the encrypted sync:
the client (`src/sync/e2ee/`), the relay (`sync-server/vault-relay*.js`,
`edge-workers/vault-relay/`) and the protocol's cryptography.

**Why it matters:** notes are among the most private data people keep; the
sync is meant for families and classrooms sharing one vault. The provider is
untrusted by design, so the protocol must hold without it.

**Readiness:** a one-command audit pack (`node
scripts/sync-protocol/audit-pack.mjs --check`): the spec, a threat model, a
scope questionnaire laid out like the published Obsidian Sync audits (client
API, server, cryptography), the known findings, test vectors, and two
independent implementations of the format that read 100% of them.

**Size:** see the pack's `scope/files.tsv` (about 120 files).

**Funding:** `<co-funding available, e.g. an NLnet grant (W13.S5), or none>`

**Publication:** the project will publish the final report and fixes.
