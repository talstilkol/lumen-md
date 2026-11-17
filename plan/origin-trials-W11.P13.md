# Origin trials for Chrome 148 (W11.P13): what is needed

Lumen's install button (src/pwa/install.ts) uses two Chrome features that
are still in origin trials. The `<install>` element (`HTMLInstallElement`)
comes first; `navigator.install()`, the Web Install API, comes second.
Both are detected at run time. Without them the app falls back to
`beforeinstallprompt`, and then to a per-browser guide. The code is done
(#808). What is missing is the tokens and one look in a real Chrome 148.

## 1. Register (owner, once per trial)

- At developer.chrome.com/origintrials, sign in and register both trials
  for the origin `https://lumen-md.vercel.app`: the *install element*
  trial and the *Web Install API* trial. Take the exact names, end dates
  and Chrome versions from each trial's page; this plan does not restate
  them because they change.
- One origin per token. Preview deployments (`*.vercel.app`) get no token:
  `vercel.app` is a public suffix, so "match all subdomains" cannot cover
  them. Previews keep the fallbacks, which the e2e covers.
- First-party tokens only (not "third-party matching"): Lumen serves its
  own pages.

## 2. Deliver the tokens

- Tokens are public: every visitor's browser receives them. They are not
  secrets and do not go in the secret store.
- Preferred: one `Origin-Trial: <token>` response header per trial on the
  app's HTML document. Add them to the document headers in
  `security/policy.json`, then render with `npm run headers`. This is a
  header next to the CSP, and the CSP does not change. No rebuild of the
  bundle is needed, and no `VITE_*` variable (none may be added).
- Fallback: a `<meta http-equiv="origin-trial" content="…">` in
  `index.html`. This is less good, because a token change then needs a
  build.
- Check every token before it ships, and again each month:
  `node scripts/pwa/origin-trial-token.mjs --origin https://lumen-md.vercel.app <token>…`.
  It exits 1 for a wrong origin, a third-party token, an expired token,
  or one that expires within 30 days.

## 3. Verify (Mac run)

- `FC2-W11.P13-origin-trials`, then `L8-W11.P13-chrome`: `e2e/pwa-install.spec.ts`
  in Google Chrome 148+ against production. The unfaked case records which
  path Chrome offers (`element` or `api`).
- Locally, without a token: enable the two features on `chrome://flags`
  (the flag names are on each trial's page) and run the same spec.

## 4. When a trial ends

- Chrome stops exposing the feature on the end date. install.ts falls back
  by itself and nothing breaks.
- Remove the expired header (the token check above fails 30 days before
  the end). If the feature ships for real, delete the header. If the trial
  is extended, register again for a new token.

## Owner actions

1. Register both trials for `https://lumen-md.vercel.app`.
2. Put the two tokens in the document headers (`security/policy.json`,
   `npm run headers`) and deploy.
3. Run the token check, then `L8-W11.P13-chrome` in Chrome 148+.
