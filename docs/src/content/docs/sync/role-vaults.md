---
title: Family and classroom vaults (roles)
description: One encrypted vault shared by a family or a class, with reader, writer and admin roles, and no accounts. The relay accepts a change only with a writer's signature.
---

**Status: not audited, and not in the app yet.** The protocol, the relay rules and the tests exist (plan W12.S4). No screen opens a role vault yet. When one does, it will sit behind the end-to-end encryption flag, which is off by default and marked "not audited".

## Roles are keys

No user names, no email, no accounts. A role is the set of keys a device holds.

| Role | What the device holds | What it can do |
|---|---|---|
| Reader | The vault's read key, sealed to this device's own key | Read the vault. Write only its own personal folder, if it has one. |
| Writer | The read key, plus a signing key listed in the vault's access list | Read and change the vault. |
| Admin | The admin signing key and the vault passphrase | Add and remove devices, re-key, and read every personal folder. |

## How the relay enforces it

- The admin signs the vault's **access list**. It names each device's signing key and role.
- The relay stores a change only if a current writer signed it, for this vault, this object and this exact condition.
- Each signature carries a counter that only goes up, so a captured request can't be sent again.
- A reader's change, a revoked device's change, a replayed request and a forged signature are all refused by the relay. Every device also checks the signatures again when it reads.

The Node relay (`sync-server`) and the Cloudflare Worker relay enforce the same rules.

## Inviting

1. The admin makes a link (or QR code) for one role. Each link is for one device.
2. The new device opens the link and makes its own keys. It leaves a join request, which only the admin can open.
3. The admin's device checks the request against the link's secret and adds the device with the role the link names. The request can't ask for a different role.

## Removing a device

The admin revokes the device. The relay refuses its writes from the next request on. The vault then gets a new read key, sealed to every device except the removed one, so it can't read anything written afterwards. What it already downloaded stays on it.

## Personal folders

Each child or student can have a personal folder. Only they and the admin can read it: it's encrypted to those two keys only, so the vault's read key doesn't open it. Only they and the admin can write it.

## Limits

- Whoever opens the space on the relay is its admin. The admin key can't be changed later. Moving to a new admin means a new vault.
- A new device must confirm, once, that the vault it sees is current, as with any device added without pairing.
- The relay sees which signing key wrote which object and when. It never sees content, file names or keys.
