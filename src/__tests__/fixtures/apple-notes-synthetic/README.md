# Apple Notes fixture: SYNTHETIC

Nothing here comes from a real Notes library. `scripts/fixtures/apple-notes-fixture.mjs` builds it with `node:sqlite`:

```bash
node scripts/fixtures/apple-notes-fixture.mjs src/__tests__/fixtures/apple-notes-synthetic
```

- The tables and columns are named as in macOS's `NoteStore.sqlite`: `Z_PRIMARYKEY`, `ZICCLOUDSYNCINGOBJECT` and `ZICNOTEDATA`.
- The note bodies are gzip'd `NoteStoreProto` messages, encoded with the field numbers of apple_cloud_notes_parser's `notestore.proto`.
- `Photo.PNG` is 11 bytes: a PNG signature and a marker, not an image.

A real library from a Mac is owed (plan W10.E48). The test reads it the same way.
