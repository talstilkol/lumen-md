# Wycheproof test vectors (test-only)

`chacha20_poly1305_test.json` is copied unchanged from
[C2SP/wycheproof](https://github.com/C2SP/wycheproof), `testvectors_v1/`, at
commit `65ca494727a52944c204441c860b039e6786b99b`.

- sha256: `fe61d25f90e1bde4461d00eafe61049e5f29bd999f36b766df9cda90906ad53d`
  (checked by `src/__tests__/wycheproofChacha.test.ts`)
- Licence: Apache-2.0 (Copyright the Wycheproof authors). The file is used by
  the tests only and is not part of the app or of any build.

To update: copy the new file, then update the commit and the sha256 here and
in the test.
