---
title: Organization settings
description: Name your organization, restrict e-mail domains, check SSO and members.
---

Open the command palette (`⌘K` / `Ctrl+K`) and run **Organization settings…**.

## What you can set

- **Organization name** — shown in the admin panel.
- **Allowed e-mail domains** — the domains your members sign in with
  (`acme.com`, `acme.co.uk`). Used as the default domain for SSO sign-in.
- **SSO status** — whether an SSO worker is configured and whether you are
  currently signed in through it.
- **Members** — listed once SSO is connected. Without SSO the panel shows a
  "Connect SSO" prompt.
- **Audit log** — available on the Team plan (or always, when self-hosted
  without billing).

## Offline and self-hosted

Without a backend, the name and domains are stored only in this browser
(local-only mode). Nothing is sent to a server.
