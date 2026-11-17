---
title: Data-safety drill
description: Every way Lumen saves a note to a folder, driven through kill -9, a full disk, lost permissions and another program editing at the same time, with a report per release.
type: reference
---

The drill checks the claim that a note is never half-saved. It drives
**each way Lumen writes a note to a folder** through four kinds of trouble,
on a real disk with real processes:

| Trouble | What happens |
|---|---|
| **kill -9** | A process saves notes as fast as it can and is killed with `SIGKILL` at a random moment, 1,000 times |
| **Full disk** | A note grows until a save no longer fits on a small file system (`ENOSPC`) |
| **Lost permission** | The folder and its notes become read-only in the middle of saving |
| **Another program** | An editor or a sync client saves the same notes (temporary file, then rename) while Lumen saves |

Each saved version carries a SHA-256 of its own text. After every round each
note must be **one whole version**, no older than before, and still there.
A save that fails must fail loudly, so the app keeps the text and tries
again.

Every save path it drives is the shipped code, never a copy of it:

- the phone folder (`src/storage/vault/mobile.ts`);
- the OPFS backend that Safari before 26 uses (`opfs.ts` → `opfsSyncWrite.ts`, its worker source as written). Only OPFS and `Worker` are stood in for, at the API level, over a real folder (`scripts/drill/opfs.mjs`);
- the desktop app's `Vault::write` (`src-tauri/vault/src/lib.rs`), in a small binary built with `cargo` (`scripts/drill/tauri-writer`);
- the atomic save of plan W1.5.

The browser's File System Access path is atomic by design and is covered by
the e2e matrix (`e2e/data-safety.spec.ts`).

A combined round runs everything at once on one vault: two app windows saving
the same notes, a sync client writing them, and the app's own git pull
(`src/sync/gitPull.ts`). Then every process gets SIGKILL, the app recovers the
folder, and every note must be whole. `--combined N` sets the number of rounds
(default 20).

## Run it

```sh
npm run drill:data-safety -- --kills 1000 --full-disk /mnt/small
```

`--full-disk` takes a small file system you mounted for the test (on Linux:
`sudo mount -t tmpfs -o size=256k tmpfs /mnt/small`); without it the full-disk
part is skipped. Run as root, the saving process drops to an unprivileged
user so the permission test means something.

The report goes to `reports/drill-<commit>.md` and `.json`, one
per release. The exit code is 0 only when no note was damaged or lost.
