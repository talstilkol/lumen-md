---
title: Real-time WebRTC collaboration
description: Multi-cursor editing over a peer-to-peer mesh — no server account, no central log of your doc.
---

Lumen ships a real-time collab mode powered by [Yjs](https://yjs.dev)
over WebRTC. Open a doc, share the room link, and every keystroke
syncs to every peer in <30 ms.

## Start a session

`⌘K → Start collaboration`. A toast confirms the room name + copies
the share link to your clipboard:

```
https://lumen.app/#room=lumen-bright-river-77
```

Anyone with the link enters the same Y.Doc. Their cursor + selection
appears in your editor, coloured by their auto-assigned chip.

## Awareness UI

Each peer publishes:

- **Display name** — random adjective+noun combo, e.g. "Marble".
- **Colour** — auto-picked HSL hue.
- **Cursor + selection** — re-published on every selection change.

The editor renders peer cursors with a small floating name tag above
the caret. A peer's selection highlights with a translucent version of
their colour. The list of active peers shows in the status bar.

## Room passwords (not yet end-to-end encrypted)

Setting `localStorage["lumen.collab.password"]` (or appending
`&password=…` to the share link) mirrors each local Yjs update,
AES-GCM-256 encrypted, into the shared doc — but the plaintext doc is
still synced to every peer, including peers without the password. It is
**not** end-to-end encryption today. See
[Room passwords](/collab/encryption/) for exactly what is and isn't
protected.

## Rooms evaporate when the last peer leaves

WebRTC is peer-to-peer — there's no server holding the doc. The doc
state lives in each peer's Y.Doc, replicated over the mesh. Once
everyone leaves, the state is only in the OPFS workspace of whoever
saved it. To get persistent rooms (the Notion / Google Docs feel),
enable [persistent collab](/collab/persistent/).

## Comments / annotations

Inline comments anchor to text ranges via Yjs `RelativePosition`, so a
comment on "neural networks" stays attached to those words even when
collaborators insert paragraphs above. Open the comments panel from
`⌘K → View comments panel`.

## Performance budget

- Room cap: 20 simultaneous peers (raise via the WebRTC provider's
  `maxConns`).
- Per-update overhead: ≈ 60 bytes encryption + base64 + Y.Map key.
- Initial join: full Y.Doc snapshot synced via the signaling channel
  (≈ 1 KB per 1k characters of doc).

For documents larger than ~50k characters or sessions with >20 peers,
move to [persistent collab](/collab/persistent/) which uses
`y-websocket` + a server-side store.
