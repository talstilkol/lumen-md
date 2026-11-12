---
title: Airplane mode and the network monitor
description: One switch that stops every network request Lumen can make, a live list of every attempt with where in the code it came from, and a certificate of the time it was on.
---

**Airplane mode (no network)** in the command palette stops every request Lumen could
send over the network, from the moment you turn it on. **Network monitor** lists every
attempt live, whether it was allowed, blocked, local or served from the cache, and shows
where in the code it came from. A badge in the corner shows that the mode is on.

## What it stops

| Path out | While airplane mode is on |
|---|---|
| `fetch` to another site | refused before it runs |
| `fetch` to Lumen's own server | GET only, and only from a cache (`only-if-cached`): never the network |
| `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, WebRTC peers | refused. Live-collaboration sockets that were open are closed |
| Workers (model downloads) | the worker asks the page and refuses the request itself |
| Images, fonts, media, frames, stylesheets from other sites | refused by the browser itself: a Content-Security-Policy is added to the page |
| Cloud dictation (the browser's speech service) | not started |

These stay allowed, because they don't leave the computer: `localhost` / `127.0.0.1`
(a local model such as Ollama on this machine), `blob:` and `data:`.

A browser can't lift a Content-Security-Policy from a page that is already open. So
turning airplane mode **off reloads the page**. Save your work first. The mode stays on
across reloads until you turn it off, and the policy is in place before the app starts.

## The monitor and the certificate

Each row shows the time, the kind of request, the decision, the destination (address
and path only, never the query) and where it came from in the code. The code location
is the calling function and file, as the browser reports it. **Try a request** sends a
test request to `example.com`, so you can watch it appear as blocked.

While the mode is on, **Download certificate** saves a file that states the time span
and lists every attempt in it, with a count of how many reached the network (the claim
is 0). The file is canonical JSON with its SHA-256. It is not signed yet: signing with
this device's key comes with the signed privacy report.

## Limits

- Lumen's own script files that the offline cache doesn't hold load from Lumen's server,
  like any page resource; they are not `fetch` requests. The monitor sees them through
  the browser's Resource Timing, and the certificate counts any that transferred bytes
  as having reached the network.
- The plan's full check is the owner's to run: 22 commands under `mitmproxy`, with 0
  requests while the mode is on. `e2e/airplane-mode.spec.ts` checks the same promise
  against fake hosts.
