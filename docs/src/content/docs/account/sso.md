---
title: Single sign-on (SSO)
description: Sign in with your company's identity provider through WorkOS.
---

Lumen supports SAML and OIDC single sign-on through
[WorkOS](https://workos.com). Your organization's admin connects the
identity provider once; members then sign in with their work e-mail domain.

## Signing in

1. Open **Sign in** in the toolbar.
2. Enter your organization's e-mail domain (for example `acme.com`).
3. Complete the sign-in at your identity provider. You are returned to
   Lumen and signed in.

## Error reasons

When SSO fails, Lumen returns with `?sso=error&reason=…`:

| Reason | Fix |
|---|---|
| `no_sso_connection` | No organization is set up for that domain. Ask your admin to add the domain in WorkOS. |
| `state_mismatch` | The sign-in was started in a different browser or took longer than 10 minutes. Start again. |
| `access_denied` | Your identity provider refused the sign-in — ask your IT admin to assign you to the Lumen app. |
| `code_exchange_failed` | The SSO worker could not verify the sign-in. Usually a wrong `WORKOS_API_KEY` / `WORKOS_CLIENT_ID`. |

## Self-hosting

Deploy `edge-workers/auth/` (see `DEPLOY.md` §5b) and set
`VITE_WORKOS_ENDPOINT` to the worker URL.
