---
title: Signing in
description: What each sign-in status means and how to fix the common errors.
---

Signing in is optional — Lumen works fully offline without an account.
An account unlocks persistent collab rooms, cloud sync and Smart search.

## Status messages

| Status | Meaning | What to do |
|---|---|---|
| **Signed in** | A session is active. | Nothing. |
| **Signed out** | Cloud sign-in is available but you are not signed in. | Open **Sign in** in the toolbar. |
| **Sign-in not configured** | This build has no auth provider (local-only mode). | Self-hosters: see [Enable accounts](#enable-accounts). Everyone else: keep working locally. |
| **Sign-in error** | The provider could not be reached or rejected the request. | See [Troubleshooting](#troubleshooting). |

## Enable accounts

Set these in `.env.local` and rebuild:

- **Email / OAuth (Supabase)** — `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, then `npm install @supabase/supabase-js`.
- **Enterprise SSO (WorkOS)** — `VITE_WORKOS_ENDPOINT`; see
  [Single sign-on](/account/sso/).

## Troubleshooting

- **Network error / provider unreachable** — check your connection, VPN or
  corporate proxy, then retry. Lumen keeps working locally meanwhile.
- **Invalid email or password** — reset the password from the provider's
  e-mail, or use the OAuth buttons.
- **Session expired** — sign in again; your local documents are untouched.
