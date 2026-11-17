/**
 * BLAKE2b (RFC 7693) and Argon2id (RFC 9106) in plain JavaScript, for the
 * second, spec-only implementation of the sync test vectors
 * (scripts/sync-protocol/ref-impl.mjs, plan W13.S4). Node 22's node:crypto
 * has no Argon2, and this file must not import Lumen's own primitives
 * (src/sync/e2ee/primitives), so it is written from the two RFCs alone.
 *
 * 64-bit words are pairs of 32-bit halves in Uint32Arrays (lo at 2i, hi at 2i+1).
 */

// ── 64-bit helpers on (lo, hi) pairs in a Uint32Array ──────────────────────

/** v[a] += v[b] (64-bit). */
function add64(v, a, b) {
  const lo = v[a] + v[b];
  const hi = v[a + 1] + v[b + 1] + (lo >= 0x100000000 ? 1 : 0);
  v[a] = lo >>> 0;
  v[a + 1] = hi >>> 0;
}
/** v[a] += lo,hi constant. */
function add64c(v, a, lo0, hi0) {
  const lo = v[a] + lo0;
  const hi = v[a + 1] + hi0 + (lo >= 0x100000000 ? 1 : 0);
  v[a] = lo >>> 0;
  v[a + 1] = hi >>> 0;
}
/** v[a] = rotr64(v[a] ^ v[b], n). */
function xorRot(v, a, b, n) {
  let lo = v[a] ^ v[b];
  let hi = v[a + 1] ^ v[b + 1];
  if (n === 32) {
    v[a] = hi;
    v[a + 1] = lo;
    return;
  }
  if (n > 32) {
    const t = lo;
    lo = hi;
    hi = t;
    n -= 32;
  }
  v[a] = ((lo >>> n) | (hi << (32 - n))) >>> 0;
  v[a + 1] = ((hi >>> n) | (lo << (32 - n))) >>> 0;
}

// ── BLAKE2b (RFC 7693) ─────────────────────────────────────────────────────

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

function compress(h, block, tLo, tHi, last) {
  const v = new Uint32Array(32);
  v.set(h, 0);
  v.set(IV, 16);
  v[24] ^= tLo;
  v[25] ^= tHi;
  if (last) {
    v[28] = ~v[28] >>> 0;
    v[29] = ~v[29] >>> 0;
  }
  const m = new Uint32Array(32);
  for (let i = 0; i < 32; i++) m[i] = block[4 * i] | (block[4 * i + 1] << 8) | (block[4 * i + 2] << 16) | (block[4 * i + 3] << 24);
  const G = (a, b, c, d, x, y) => {
    add64(v, a, b);
    add64c(v, a, m[x], m[x + 1]);
    xorRot(v, d, a, 32);
    add64(v, c, d);
    xorRot(v, b, c, 24);
    add64(v, a, b);
    add64c(v, a, m[y], m[y + 1]);
    xorRot(v, d, a, 16);
    add64(v, c, d);
    xorRot(v, b, c, 63);
  };
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r % 10];
    G(0, 8, 16, 24, 2 * s[0], 2 * s[1]);
    G(2, 10, 18, 26, 2 * s[2], 2 * s[3]);
    G(4, 12, 20, 28, 2 * s[4], 2 * s[5]);
    G(6, 14, 22, 30, 2 * s[6], 2 * s[7]);
    G(0, 10, 20, 30, 2 * s[8], 2 * s[9]);
    G(2, 12, 22, 24, 2 * s[10], 2 * s[11]);
    G(4, 14, 16, 26, 2 * s[12], 2 * s[13]);
    G(6, 8, 18, 28, 2 * s[14], 2 * s[15]);
  }
  for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16];
}

/** BLAKE2b-`outLen` of `data` (no key). */
export function blake2b(data, outLen) {
  const h = new Uint32Array(IV);
  h[0] ^= 0x01010000 ^ outLen;
  const block = new Uint8Array(128);
  let t = 0;
  let off = 0;
  while (data.length - off > 128) {
    block.set(data.subarray(off, off + 128));
    t += 128;
    compress(h, block, t >>> 0, Math.floor(t / 0x100000000), false);
    off += 128;
  }
  block.fill(0);
  block.set(data.subarray(off));
  t += data.length - off;
  compress(h, block, t >>> 0, Math.floor(t / 0x100000000), true);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) out[4 * i + j] = (h[i] >>> (8 * j)) & 0xff;
  return out.slice(0, outLen);
}

const le32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** H' (RFC 9106 §3.3): the variable-length hash. */
function hPrime(x, T) {
  const input = cat(le32(T), x);
  if (T <= 64) return blake2b(input, T);
  const r = Math.ceil(T / 32) - 2;
  const out = new Uint8Array(T);
  let v = blake2b(input, 64);
  out.set(v.subarray(0, 32), 0);
  for (let i = 1; i < r; i++) {
    v = blake2b(v, 64);
    out.set(v.subarray(0, 32), 32 * i);
  }
  v = blake2b(v, T - 32 * r);
  out.set(v, 32 * r);
  return out;
}

// ── Argon2 (RFC 9106) ──────────────────────────────────────────────────────

/** v[a] = v[a] + v[b] + 2 * lo32(v[a]) * lo32(v[b])  (BlaMka). */
function fBlaMka(v, a, b) {
  const x = v[a];
  const y = v[b];
  // 2*x*y as a 64-bit number from 16-bit pieces.
  const xl = x & 0xffff, xh = x >>> 16, yl = y & 0xffff, yh = y >>> 16;
  const ll = xl * yl;
  const lh = xl * yh;
  const hl = xh * yl;
  const hh = xh * yh;
  const mid = lh + hl; // < 2^33
  let lo = ll + (mid % 0x10000) * 0x10000; // < 2^49
  let hi = hh + Math.floor(mid / 0x10000) + Math.floor(lo / 0x100000000);
  lo = lo % 0x100000000;
  // times two
  hi = (hi * 2 + Math.floor((lo * 2) / 0x100000000)) % 0x100000000;
  lo = (lo * 2) % 0x100000000;
  add64(v, a, b);
  add64c(v, a, lo, hi);
}

function GB(v, a, b, c, d) {
  fBlaMka(v, a, b);
  xorRot(v, d, a, 32);
  fBlaMka(v, c, d);
  xorRot(v, b, c, 24);
  fBlaMka(v, a, b);
  xorRot(v, d, a, 16);
  fBlaMka(v, c, d);
  xorRot(v, b, c, 63);
}

/** The permutation P on 16 words at word indexes `idx` (each a 64-bit word index into v). */
function P(v, idx) {
  const w = (i) => 2 * idx[i];
  GB(v, w(0), w(4), w(8), w(12));
  GB(v, w(1), w(5), w(9), w(13));
  GB(v, w(2), w(6), w(10), w(14));
  GB(v, w(3), w(7), w(11), w(15));
  GB(v, w(0), w(5), w(10), w(15));
  GB(v, w(1), w(6), w(11), w(12));
  GB(v, w(2), w(7), w(8), w(13));
  GB(v, w(3), w(4), w(9), w(14));
}

const ROWS = Array.from({ length: 8 }, (_, i) => Array.from({ length: 16 }, (_, j) => 16 * i + j));
const COLS = Array.from({ length: 8 }, (_, i) => Array.from({ length: 16 }, (_, j) => 16 * Math.floor(j / 2) + 2 * i + (j % 2)));

/** out = G(X, Y) [xor out when `xorInto`]: R = X ^ Y, Z = P over rows then columns, out = Z ^ R. */
function G(X, Y, out, xorInto) {
  const R = new Uint32Array(256);
  for (let i = 0; i < 256; i++) R[i] = X[i] ^ Y[i];
  const Z = R.slice();
  for (const r of ROWS) P(Z, r);
  for (const c of COLS) P(Z, c);
  if (xorInto) for (let i = 0; i < 256; i++) out[i] ^= Z[i] ^ R[i];
  else for (let i = 0; i < 256; i++) out[i] = Z[i] ^ R[i];
}

const toBlock = (bytes) => {
  const b = new Uint32Array(256);
  for (let i = 0; i < 256; i++) b[i] = bytes[4 * i] | (bytes[4 * i + 1] << 8) | (bytes[4 * i + 2] << 16) | (bytes[4 * i + 3] << 24);
  return b;
};
const fromBlock = (b) => {
  const out = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) for (let j = 0; j < 4; j++) out[4 * i + j] = (b[i] >>> (8 * j)) & 0xff;
  return out;
};

/** Argon2id (version 0x13), RFC 9106. `password`, `salt`: Uint8Array. */
export function argon2id({ password, salt, memoryKiB, iterations, parallelism, tagLength = 32, secret = new Uint8Array(0), ad = new Uint8Array(0) }) {
  const p = parallelism;
  const type = 2;
  const H0 = blake2b(
    cat(le32(p), le32(tagLength), le32(memoryKiB), le32(iterations), le32(0x13), le32(type), le32(password.length), password, le32(salt.length), salt, le32(secret.length), secret, le32(ad.length), ad),
    64,
  );
  const mPrime = 4 * p * Math.floor(memoryKiB / (4 * p));
  const q = mPrime / p;
  const SL = 4;
  const segment = q / SL;
  const B = Array.from({ length: p }, () => new Array(q));
  for (let i = 0; i < p; i++) {
    B[i][0] = toBlock(hPrime(cat(H0, le32(0), le32(i)), 1024));
    B[i][1] = toBlock(hPrime(cat(H0, le32(1), le32(i)), 1024));
  }
  const zero = new Uint32Array(256);
  for (let pass = 0; pass < iterations; pass++) {
    for (let sl = 0; sl < SL; sl++) {
      for (let lane = 0; lane < p; lane++) {
        // Argon2id: data-independent addressing in the first half of the first pass.
        const indep = pass === 0 && sl < 2;
        let addr = null;
        let input = null;
        if (indep) {
          input = new Uint32Array(256);
          input[0] = pass;
          input[2] = lane;
          input[4] = sl;
          input[6] = mPrime;
          input[8] = iterations;
          input[10] = type;
          input[12] = 0; // counter, bumped before each use
          addr = new Uint32Array(256);
        }
        const start = pass === 0 && sl === 0 ? 2 : 0;
        if (indep && start === 2) {
          input[12]++;
          const tmp = new Uint32Array(256);
          G(zero, input, tmp, false);
          G(zero, tmp, addr, false);
        }
        for (let idx = start; idx < segment; idx++) {
          const j = sl * segment + idx;
          const prev = j === 0 ? q - 1 : j - 1;
          let J1, J2;
          if (indep) {
            if (idx % 128 === 0) {
              input[12]++;
              const tmp = new Uint32Array(256);
              G(zero, input, tmp, false);
              G(zero, tmp, addr, false);
            }
            J1 = addr[2 * (idx % 128)];
            J2 = addr[2 * (idx % 128) + 1];
          } else {
            J1 = B[lane][prev][0];
            J2 = B[lane][prev][1];
          }
          const refLane = pass === 0 && sl === 0 ? lane : J2 % p;
          // The reference area (RFC 9106 §3.4.1.2).
          let area;
          if (pass === 0) area = refLane === lane ? j - 1 : sl * segment - (idx === 0 ? 1 : 0);
          else area = refLane === lane ? q - segment + idx - 1 : q - segment - (idx === 0 ? 1 : 0);
          // 64-bit products: exact with BigInt (a double would round them).
          const x = (BigInt(J1) * BigInt(J1)) >> 32n;
          const y = Number((BigInt(area) * x) >> 32n);
          const zz = area - 1 - y;
          const startPos = pass === 0 || sl === SL - 1 ? 0 : (sl + 1) * segment;
          const refIndex = (startPos + zz) % q;
          const ref = B[refLane][refIndex];
          if (pass === 0) {
            const out = new Uint32Array(256);
            G(B[lane][prev], ref, out, false);
            B[lane][j] = out;
          } else G(B[lane][prev], ref, B[lane][j], true);
        }
      }
    }
  }
  const C = new Uint32Array(256);
  for (let i = 0; i < p; i++) for (let k = 0; k < 256; k++) C[k] ^= B[i][q - 1][k];
  return hPrime(fromBlock(C), tagLength);
}
