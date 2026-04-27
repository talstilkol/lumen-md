---
title: End-to-end encryption for collab
description: Add a room password and the signaling server can't read your doc.
---

Lumen's WebRTC mesh is unencrypted by default — clients negotiate a
direct peer connection but the signaling server (and anyone on a shared
network) sees the document state. For Pro / privacy-conscious users we
ship an opt-in **AES-GCM-256** layer that encrypts every Yjs update with
a key derived from a shared room password.

## Turn it on

```js
// Either:
localStorage.setItem("lumen.collab.password", "open-sesame-12345");

// Or append to the share link:
//   #room=lumen-bright-river-77&password=open-sesame-12345
```

Every peer in the room must use the same password — wrong-password peers
can connect over signaling but receive only undecryptable ciphertext, so
the editor stays out of sync until they fix it (no plaintext leaks).

## How it works

1. **Key derivation** — PBKDF2-SHA256 with a fixed application salt
   (`lumen.collab.v1`) and 200 000 iterations. The same password produces
   the same 256-bit AES key on every peer.
2. **Wire format** — every Yjs update is encrypted with a fresh random
   12-byte IV. The IV is prepended to the ciphertext; the auth tag is the
   final 16 bytes (standard AES-GCM).
3. **In-doc transport** — encrypted payloads ride a hidden `__crypt__`
   Y.Map keyed by `<timestamp>-<random>`. Receivers decrypt and
   `Y.applyUpdate` into the visible doc with origin tag
   `remote-decrypted`, so the local update observer doesn't re-encrypt
   them in a loop.

## What it does protect

- Eavesdroppers on the WebRTC signaling channel.
- Compromised public Yjs signaling servers.
- Peers that joined the room via the share link without the password.

## What it doesn't protect

- A peer with the password — they're in the trust circle by design.
- Offline forensics on a peer's IndexedDB / OPFS storage. Use a Vault
  password (`⌘K → Encrypt document`) for at-rest encryption.
- Metadata: room name, peer count, awareness presence (cursors / colours)
  remain visible to the signaling server. The document **content** is
  protected, not the fact that a session exists.

## Rotating

Pick a new password and clear the old one:

```js
localStorage.setItem("lumen.collab.password", "new-stronger-passphrase");
```

Then leave + rejoin the room. Peers using the old password lose sync
until they update.

## Trade-offs

- A misplaced password locks everyone out. Treat it like any shared
  secret — share via a side-channel (Signal, 1Password, etc.).
- The 200 000-iteration PBKDF2 derivation runs once per password change;
  it's fast on modern devices (≈ 100 ms) but noticeable on old phones.
