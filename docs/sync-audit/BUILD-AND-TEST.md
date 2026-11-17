# Build and test the encrypted sync

## One command

```sh
node scripts/sync-protocol/audit-pack.mjs --check
```

It builds this pack twice (the archive's SHA-256 must not change), runs
every test vector through the second implementation (`impl/ref-impl.mjs`,
node:crypto, no project code), and checks that a vector with one flipped byte
is refused. Node 22 or newer; nothing to install.

## The rest

```sh
python3 scripts/sync-protocol/check_vectors.py     # first independent reader (pip install cryptography>=44)
npm ci && npx vitest run src/__tests__/e2ee        # the app's own tests (engine, keyring, pairing, vectors)
node scripts/sync-protocol/audit-pack.mjs          # writes dist/sync-audit-pack/ and its .tar + .sha256
npx tsx scripts/sync-protocol/make-vectors.mts     # remakes the vectors from the app's code (changes the hashes)
```

## What each check proves

| Check | Proves |
|---|---|
| `ref-impl.mjs` 100% | the spec alone is enough to read every object the app writes, in a second crypto library |
| `check_vectors.py` 100% | the same, in Python (a third reader counting the app) |
| tampered vector refused | the checks can fail: a pass is not vacuous |
| stable archive hash | what the auditor received is exactly what this commit holds |
| `vitest src/__tests__/e2ee*` | the app's engine: rollback, freeze, re-key, pairing, mutants |
