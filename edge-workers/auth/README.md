# Lumen SSO edge worker (`lumen-auth`)

Cloudflare Worker that backs `src/auth/workosProvider.ts` with the
[WorkOS SSO](https://workos.com/docs/reference/sso) REST API. No SDK —
plain `fetch`, so it runs on any Workers-compatible runtime.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/sso/authorize?domain=acme.com` | Looks up the WorkOS organization for the domain, returns `{ redirect }` (WorkOS authorization URL) and sets a short-lived `lumen_sso_state` nonce cookie. |
| `GET` | `/api/sso/callback?code=…&state=…` | IdP lands here. Verifies the HMAC-signed `state` **and** the nonce cookie, exchanges the code at `POST /sso/token`, sets the `lumen_session` cookie (HS256 JWT) and 302s to `<origin>/?sso=ok` — or `/?sso=error&reason=<code>`. |
| `GET` | `/api/sso/session` | `{ user }` for a valid session, `401` otherwise. |
| `POST` | `/api/sso/signout` | Clears the session cookie (`204`). |
| `GET` | `/api/sso/token` | `{ token, expiresAt }` — a ≤5-minute HS256 bearer token (`iss: lumen-sso`, `aud: lumen-billing`, `sub`, `org`) signed with `BILLING_TOKEN_SECRET`, used by the client's `getAccessToken()` so the billing worker's `/entitlements` can identify SSO users (the session cookie itself is HttpOnly). Origin-checked; `501` when `BILLING_TOKEN_SECRET` isn't set. |
| `GET` | `/health` | `{ ok, configured }`. |

`user` matches the client's `User` type: `{ id, email?, name?, provider: "workos", orgId? }`.

Error responses are JSON: `{ error: "<code>", message: "<human text>" }`
(`invalid_domain` 400, `origin_not_allowed` 403, `no_sso_connection` 404,
`workos_error` / `workos_unreachable` 502, `not_configured` 503).

## Security model

- **CSRF on the login flow** — `state` = `base64url(payload).HMAC`; the payload
  carries a random nonce, the starting origin and a 10-minute expiry. The
  nonce must also match the `HttpOnly` `lumen_sso_state` cookie set during
  `/authorize`, so a callback started in another browser is rejected
  (`reason=state_mismatch`).
- **Open redirects** — the callback only redirects to the origin recorded in
  the signed state, and only if it is still in `ALLOWED_ORIGINS`.
- **CORS** — the `Origin` header is echoed only when listed in
  `ALLOWED_ORIGINS` (credentialed CORS cannot use `*`). `/authorize` and
  `/signout` reject unknown origins with `403`.
- **Cookies** — `HttpOnly; Secure; SameSite=None` (the app and the worker
  are usually different sites). The session JWT signature is compared in
  constant time; expired tokens and any `alg` other than `HS256` are rejected.

## Deploy

```bash
cd edge-workers/auth
wrangler secret put WORKOS_API_KEY
wrangler secret put WORKOS_CLIENT_ID
wrangler secret put SESSION_SECRET      # openssl rand -base64 48
# optional — only if the billing worker is deployed:
wrangler secret put BILLING_TOKEN_SECRET  # same value as billing's SSO_TOKEN_SECRET
# edit ALLOWED_ORIGINS in wrangler.toml, then:
wrangler deploy
```

In the WorkOS dashboard add `https://<worker host>/api/sso/callback` as a
redirect URI, create an Organization with your email domain and attach an
SSO connection to it. Then set `VITE_WORKOS_ENDPOINT=https://<worker host>`
in the app's `.env`.

The worker host must be on the **same site** as the app (a sibling
subdomain such as `auth.example.org`, or a route on the app's own host).
On another registrable domain — including `*.workers.dev` — its cookies
are third-party, which Safari blocks: sign-in fails with `state_mismatch`
and the session isn't kept. The app logs a console warning in that case.

## Tests

`src/__tests__/ssoWorker.test.ts` drives every route with a mocked `fetch`:

```bash
npx vitest run src/__tests__/ssoWorker.test.ts
```
