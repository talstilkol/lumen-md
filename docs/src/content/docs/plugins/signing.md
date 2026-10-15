---
title: Plugin signing keys
description: Decide which publishers' plugins Lumen trusts.
---

Registry plugins can be signed with an **Ed25519** key. Before installing,
Lumen verifies the signature against the keys you trust, so a compromised
CDN cannot ship modified code.

## Manage trusted keys

Command palette → **Trusted plugin signing keys…**

- **Built-in** keys come from the deployment (`VITE_PLUGIN_TRUSTED_KEYS`)
  and cannot be removed from the UI.
- **Your keys** are stored in this browser. Paste the publisher's public key
  and press **Trust key**.

Each key is identified by its **fingerprint** — the SHA-256 of the public
key, in hex. Compare it with the fingerprint the publisher lists on their
website before trusting it.

## Accepted formats

- Base64 SPKI (44 bytes for Ed25519, starts with `MCow`).
- PEM: `-----BEGIN PUBLIC KEY----- … -----END PUBLIC KEY-----`.

Generate a key pair with OpenSSL:

```bash
openssl genpkey -algorithm ed25519 -out plugin-signing.pem
openssl pkey -in plugin-signing.pem -pubout
```

## Errors

- **Not an Ed25519 public key** — the pasted text is not a 44-byte SPKI
  Ed25519 key (RSA and ECDSA keys are not accepted).
- **Untrusted signer** — the plugin is correctly signed, but by a key you
  have not trusted. Verify the fingerprint, then add the key.
