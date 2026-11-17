---
title: Monitoring and web vitals
description: Error reports are off by default and sent only with your consent; web vitals never leave your device.
type: how-to
---

Lumen measures how fast it is on your device, and can send crash reports
to an error tracker, but only after you turn them on. Both work the same
way in every build.

## Web vitals: measured here, never sent

Lumen measures five page-speed metrics with the browser's
`PerformanceObserver`:

| Metric | What it is | Good |
|---|---|---|
| LCP | Largest Contentful Paint: when the largest visible element appears | ≤ 2.5 s |
| FCP | First Contentful Paint: when the first content appears | ≤ 1.8 s |
| TTFB | Time to First Byte: when the server's first response byte arrives | ≤ 800 ms |
| INP | Interaction to Next Paint: the slowest interaction this session | ≤ 200 ms |
| CLS | Cumulative Layout Shift: how much the layout jumps without your input | ≤ 0.1 |

The values stay in memory on your device. Open them with **Runtime
metrics** in the status bar, or from the command palette. The values are
never sent, even when error reports are on. A sample stores no page address.

**Performance reports (plan W11.S19)** are a separate switch, off by default
(Settings → Security → **Send performance reports**). With it on and an
error tracker set, Lumen sends one report per session, when the page is
hidden. The report holds only counts: for each metric, how many page loads
were good, needs improvement or poor. No timing, no page address.

## Error reports: off by default

Lumen sends error reports only when **both** of these are true:

1. **You turned them on.** Click the **Telemetry** pill in the status bar.
   It is off in a fresh install. Click it again to turn reports off.
   Turning them off takes effect at once, even for an error that is
   already being reported.
2. **The build names an error tracker** in `VITE_SENTRY_DSN`. This can be
   Sentry or a self-hosted GlitchTip, which speaks the same protocol.

If either one is missing, the Sentry SDK is never downloaded and no
request is made. The default build has no DSN, so it makes no monitoring
requests at all. An e2e test (`e2e/monitoring.spec.ts`) checks this, with
either switch on and with both.

**Settings → Security (plan W11.S19)** has both switches:

- **Send error reports** is the same consent as the Telemetry pill.
- **Send performance reports** is separate.

**Your own error tracker:** Settings → Security also takes a DSN of your own,
for example your GlitchTip. Reports then go there instead of to the build's
tracker. The site's security policy (`connect-src`) must allow that host. In
the hosted app it allows only the build's own tracker, so a DSN of your own
works in a self-hosted or desktop build.

**What survives:** after the allowlist below, every string in the report
goes through a redactor that removes the following:

- secret shapes: API keys, GitHub, AWS, Slack and Google tokens, JWTs, long
  hex or base64;
- personal details: email, phone, Israeli ID, card, IBAN, and any run of 9
  or more digits.

Class names must be plain CamelCase. A fuzz test plants secrets in every
field of 1,000 events, and none survive.

### What a report contains

Each report is rebuilt from a short allowlist before it leaves the browser:

- the error's class name, such as `TypeError`;
- the script file names, functions and line numbers of the stack trace;
- the app's release and environment, and the SDK's name and version.

The error **message is never sent**. A message can contain a title or a
line of a note without quotes ("Failed to save Quarterly plan"), and no
filter can reliably tell that apart from the app's own words. The stack
trace shows where the error happened, and that is enough to find it.

A report never includes:

- the error message, or any text logged with it;
- the page address;
- breadcrumbs, such as clicks, console lines and requests;
- user or IP data (`infer_ip: never`);
- tags, extra data or contexts.

There is no session replay, no performance tracing and no session
tracking.

### Every report is in the privacy ledger

Error reports go through the privacy ledger (command palette → **Privacy
ledger**) like every other request that leaves the device. Each one is listed under its own
category: "Error report — only with your consent, content removed". The
ledger shows where the report went, its size and its status. Under the
**local-only** AI policy, reports are refused before they leave, and each
refusal is listed as blocked.

## For operators: setting the DSN

Set the DSN at build time:

```bash
VITE_SENTRY_DSN=https://<public-key>@o123.ingest.sentry.io/4567 npm run build
# Docker: docker build --build-arg VITE_SENTRY_DSN=… .
```

**A DSN is not a secret.** Sentry designs it to be public: it ships in
every page that uses Sentry, and it only lets a client *submit* events
to one project. It can't read data. So a build-time `VITE_*` variable is
the right place for it, and secret scanners may ignore it.

The DSN's host is added to the CSP `connect-src` **automatically at build
time**, through the same mechanism as the other deployment endpoints
(`src/build/cspEndpoints.ts`). That covers the `index.html` meta tag,
`dist/_headers` and the nginx image. On **Vercel**, `vercel.ts` adds the
same origin to the header it serves, from the project's `VITE_SENTRY_DSN`
environment variable. No error-tracker host or wildcard is in the
checked-in policies.
