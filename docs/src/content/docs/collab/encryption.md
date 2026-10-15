---
title: Room passwords for collab (not yet end-to-end encrypted)
description: What the collab room password does today — and what it does not protect.
---

:::caution[Not end-to-end encrypted]
Setting a room password does **not** currently keep your document
confidential. The plaintext document is still synced to every connected
peer alongside the encrypted copy. Do not rely on it for sensitive content.
A real end-to-end design is tracked as a TODO in `src/collab/yjs.ts`
(`wireEncryption`).
:::

## How collab traffic flows

- **Signaling server** (`sync-server/server.js`, or the public y-webrtc
  servers): helps peers find each other and relays WebRTC connection
  offers. It sees the room name and the connection-setup messages; it does
  not receive the document updates themselves.
- **WebRTC data channels**: carry the Yjs document between peers. They
  are transport-encrypted (DTLS), so a passive network observer cannot read
  them — but every peer in the room receives the full document.
- **Persistent server** (optional, `VITE_YJS_WEBSOCKET_URL`): stores and
  serves the full document state, so its operator can read it.

## What the room password does today

```js
// Either:
localStorage.setItem("lumen.collab.password", "open-sesame-12345");

// Or append to the share link:
//   #room=lumen-bright-river-77&password=open-sesame-12345
```

When a password is set, every **local** edit is additionally encrypted
with **AES-GCM-256** (key derived via PBKDF2-SHA256, fixed application
salt `lumen.collab.v1`, 200 000 iterations, fresh 12-byte IV per update)
and written into a hidden `__crypt__` Y.Map. Receivers with the same
password decrypt those entries and apply them with origin
`remote-decrypted`. The layer's own writes use a dedicated transaction
origin so they are never re-encrypted.

Because the `__crypt__` map lives in the **same** Y.Doc as the visible
text, the plaintext edits are synced too. In practice:

| Who | Can read the document? |
|---|---|
| Peer in the room **with** the password | Yes |
| Peer in the room **without / with a wrong** password | **Yes** — plaintext still syncs |
| Signaling server operator | No — doc updates don't pass through it (independent of the password) |
| Persistent y-websocket server operator | **Yes** |
| Passive network eavesdropper | No — WebRTC DTLS / `wss://` TLS (independent of the password) |

So the password currently adds no confidentiality beyond the transport
encryption that is already there. It also grows the shared doc by one
encrypted entry per local edit.

## Recommendations until E2E ships

- Use an unguessable room name (the generated `lumen-<adj>-<noun>-<n>`
  names are short — share links only with people you trust).
- Don't attach a third-party persistent server to sensitive rooms.
- For at-rest protection of local copies, use a Vault password
  (`⌘K → Encrypt document`).
- Metadata (room name, peer count, awareness presence such as cursors and
  colours) is visible to the signaling server regardless.
