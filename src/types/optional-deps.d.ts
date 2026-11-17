// The audited crypto libraries under src/sync/e2ee/primitives/lib (W10.D13,
// research R3.5). They are not in package-lock.json yet: the Mac run (10.M,
// docs/security/crypto-libs.md) installs the pinned versions. The app does not
// import that directory (only cryptoDifferential.test.ts does, and it skips
// with its reason when they are missing), but the test's import puts it in
// the root program, so `tsc -b` needs their types.
//
// These are fallbacks: TypeScript resolves an installed package's own types
// first and only falls back to an ambient declaration when nothing resolves,
// so on the Mac the packages' real types are the ones checked. Each block
// states exactly the API lib/ uses, as those versions publish it. Delete this
// file when 10.M adds the packages to the lockfile.

declare module "age-encryption" {
  export class Encrypter {
    setPassphrase(passphrase: string): void;
    setScryptWorkFactor(logN: number): void;
    addRecipient(recipient: string): void;
    encrypt(file: Uint8Array | string): Promise<Uint8Array>;
  }
  export class Decrypter {
    addPassphrase(passphrase: string): void;
    addIdentity(identity: string): void;
    decrypt(file: Uint8Array, outputFormat: "uint8array"): Promise<Uint8Array>;
    decrypt(file: Uint8Array, outputFormat: "text"): Promise<string>;
  }
}

declare module "hash-wasm" {
  type IDataType = string | Uint8Array;
  export function argon2id(options: {
    password: IDataType;
    salt: IDataType;
    secret?: IDataType;
    iterations: number;
    parallelism: number;
    memorySize: number;
    hashLength: number;
    outputType: "binary";
  }): Promise<Uint8Array>;
}

declare module "libsodium-wrappers-sumo" {
  interface Sodium {
    ready: Promise<void>;
    crypto_pwhash_SALTBYTES: number;
    crypto_pwhash_ALG_ARGON2ID13: number;
    crypto_pwhash(keyLength: number, password: string | Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Uint8Array;
  }
  const sodium: Sodium;
  export default sodium;
}

declare module "@noble/ciphers/chacha.js" {
  export function chacha20poly1305(key: Uint8Array, nonce: Uint8Array, AAD?: Uint8Array): {
    encrypt(plaintext: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array): Uint8Array;
  };
}

declare module "@noble/hashes/blake2.js" {
  export function blake2b(msg: Uint8Array, opts?: { dkLen?: number; key?: Uint8Array; salt?: Uint8Array; personalization?: Uint8Array }): Uint8Array;
}

declare module "@noble/hashes/scrypt.js" {
  export function scryptAsync(password: Uint8Array | string, salt: Uint8Array | string, opts: { N: number; r: number; p: number; dkLen?: number; maxmem?: number }): Promise<Uint8Array>;
}
