---
title: Vault + recovery phrase
description: Encrypt your secrets at rest, recover without losing access.
---

Lumen's **Vault** stores the secrets the app needs (OpenAI key, Git
token, Dropbox / Google Drive refresh tokens, signing keys) encrypted
with a single user-chosen password. The encrypted blob lives in
IndexedDB; only the in-memory decrypted copy is ever visible to the
running session.

## First run

When you create the vault Lumen shows you a **12-word recovery phrase**
generated from BIP-39 wordlist. Two things to know:

1. Lumen never stores the phrase itself — only its hash. You're the only
   one who can present the phrase later.
2. **Write it down somewhere off-device.** Lose both the password AND
   the phrase and the encrypted secrets are unrecoverable.

## Daily use

- The first action of a session that needs a secret prompts for your
  password. The decrypted secret stays in memory until the tab is closed.
- `⌘K → Lock vault` clears the in-memory copy without closing the tab.

## Forgot password?

`⌘K → Vault: Recover with phrase` flow:

1. Type your 12-word recovery phrase.
2. Lumen verifies the hash matches.
3. Set a new password.
4. Existing secrets are re-wrapped under the new key — no data lost.

## What's NOT in the vault

- Your notes themselves (they live in OPFS as plain markdown).
- Per-document encryption (`⌘K → Encrypt document` is a separate flow:
  AES-GCM-256 with a per-document password, output as a fenced block at
  the top of the file).

## Rotation

Rotate the password monthly:

1. `⌘K → Vault: Change password`.
2. Type old → new.
3. The recovery phrase stays the same (it's the source of truth).

Rotating the recovery phrase is irreversible — make sure you have the
new phrase written down before confirming.
