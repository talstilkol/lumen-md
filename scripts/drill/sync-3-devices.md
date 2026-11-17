# Drill: real sync between three devices (plan W13.S7)

**Who:** the owner. **Devices:** a Mac (the desktop app or Safari), an
iPhone and an Android phone, all on the same encrypted vault (Settings →
Sync), each in the conflict mode below. **Time:** about 3 hours, mostly
waiting. **Result:** `reports/drill/sync-3-devices.json`, checked by
`npm run drill:data-safety -- --report reports/drill/sync-3-devices.json --real <your counters.json>`.

The same script runs simulated on every build
(`npm run drill:data-safety -- --report …`, src/__tests__/sync3Devices.test.ts);
this run is the one on real hardware, radios and app lifecycles.

## Before

1. On each device: Sync → this device's conflict mode — **Mac: merge**,
   **iPhone: file**, **Android: merge** (W11.S6).
2. Create the folder `drill/` with 20 notes `note-00.md` … `note-19.md`,
   each starting with `# note-NN`. Sync until all three show 20 notes.
3. Keep a counter sheet per device: edits made, times offline.

## During (repeat for about 3 hours)

- **Edits.** Each edit adds one line `- <device> edit <n>` (n counts up on
  that device's sheet; never reuse a number) anywhere in a note. A third of
  the edits go to `note-00.md`, which all three devices edit. Aim for 1,000
  edits in total (about 330 per device).
- **One disconnection per hour.** Each hour, one device (in turn: Mac,
  iPhone, Android) goes offline (airplane mode on the phones, Wi-Fi off on
  the Mac) for 15 minutes and keeps editing, `note-00.md` included. Then it
  comes back and syncs. Mark it on its sheet.
- **Same note, two devices.** At least twice per hour, edit the same note
  on two devices within a minute, before either syncs.
- **Delete and restore.** Once: delete `note-05.md` on the iPhone, sync
  everywhere, then restore it from the Mac's trash (Deleted and renamed
  files → Restore), sync everywhere.

## After

1. Stop editing; sync each device three times, one after the other.
2. Hash each device's vault the same way: on the Mac,
   `node scripts/drill/vault-hash.mjs <vault folder>`; for each phone, export
   the vault (command palette → "Export the whole vault…", a .zip), unzip it on the Mac and run the
   same command on the unzipped folder.
3. Count the lines: every `- <device> edit <n>` from the three sheets must
   be in the vault — in its note, or in a conflict file next to it (the
   iPhone's file mode makes `note-NN.sync-conflict-…md` files).
4. Write `counters.json`:

```json
{
  "drill": "sync-3-devices",
  "devices": [
    { "name": "mac", "conflictMode": "merge", "edits": 0, "offline": 0 },
    { "name": "iphone", "conflictMode": "file", "edits": 0, "offline": 0 },
    { "name": "android", "conflictMode": "merge", "edits": 0, "offline": 0 }
  ],
  "edits": 0,
  "lost": 0,
  "conflicts": 0,
  "hashes": { "mac": "", "iphone": "", "android": "" }
}
```

5. `npm run drill:data-safety -- --report reports/drill/sync-3-devices.json --real counters.json`
   — exit 0 only with 1,000+ edits, 0 lost and the same hash on all three.
6. Any lost line or a differing hash is a release blocker: open an issue
   with the three activity logs.
