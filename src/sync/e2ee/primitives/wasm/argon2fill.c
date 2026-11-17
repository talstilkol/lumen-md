/*
 * Argon2id's memory fill (RFC 9106 §3.4), the part of the derivation that
 * costs: every block compression of every pass. Compiled to WebAssembly with
 * clang (scripts/crypto/build-argon2-wasm.mjs) and embedded as bytes in
 * ./argon2fillWasm.ts; ../argon2.ts runs H0, H' and the first two blocks of
 * each lane in TypeScript, calls `fill`, and reads the last column back.
 * The TypeScript fill in ../argon2.ts is the same algorithm line by line, and
 * the fallback where WebAssembly is unavailable; both are held to the RFC
 * 9106 §5.3 vector and the protocol vectors.
 *
 * Written for this repository (plan W4.20); no third-party code. 64-bit
 * words are native here, which is the whole gain over the TypeScript fill,
 * where each is a pair of 32-bit halves.
 *
 * Memory layout: the scratch blocks below live in the module's data; the
 * caller places the lanes' blocks at `base` (at or past __heap_base), lane
 * after lane, q blocks each.
 */
typedef unsigned long long u64;
typedef unsigned int u32;

#define BW 128 /* 64-bit words per 1 KiB block */

static u64 ZERO_B[BW];
static u64 INPUT_B[BW];
static u64 ADDR_B[BW];
static u64 TMP_B[BW];

static inline u64 rotr(u64 x, int n) { return (x >> n) | (x << (64 - n)); }
static inline u64 bla(u64 x, u64 y) { return x + y + 2 * ((x & 0xffffffffull) * (y & 0xffffffffull)); }

#define GB(a, b, c, d)          \
  do {                          \
    a = bla(a, b);              \
    d = rotr(d ^ a, 32);        \
    c = bla(c, d);              \
    b = rotr(b ^ c, 24);        \
    a = bla(a, b);              \
    d = rotr(d ^ a, 16);        \
    c = bla(c, d);              \
    b = rotr(b ^ c, 63);        \
  } while (0)

#define PERM(v, i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13, i14, i15) \
  do {                                                                              \
    GB(v[i0], v[i4], v[i8], v[i12]);                                                \
    GB(v[i1], v[i5], v[i9], v[i13]);                                                \
    GB(v[i2], v[i6], v[i10], v[i14]);                                               \
    GB(v[i3], v[i7], v[i11], v[i15]);                                               \
    GB(v[i0], v[i5], v[i10], v[i15]);                                               \
    GB(v[i1], v[i6], v[i11], v[i12]);                                               \
    GB(v[i2], v[i7], v[i8], v[i13]);                                                \
    GB(v[i3], v[i4], v[i9], v[i14]);                                                \
  } while (0)

/* out = G(x, y), or out ^= G(x, y) with `xor`. */
static void compress(u64 *out, const u64 *x, const u64 *y, int xor_) {
  u64 r[BW];
  u64 z[BW];
  for (int k = 0; k < BW; k++) {
    r[k] = x[k] ^ y[k];
    z[k] = r[k];
  }
  for (int i = 0; i < 8; i++) {
    int o = 16 * i;
    PERM(z, o, o + 1, o + 2, o + 3, o + 4, o + 5, o + 6, o + 7, o + 8, o + 9, o + 10, o + 11, o + 12, o + 13, o + 14, o + 15);
  }
  for (int i = 0; i < 8; i++) {
    int o = 2 * i;
    PERM(z, o, o + 1, o + 16, o + 17, o + 32, o + 33, o + 48, o + 49, o + 64, o + 65, o + 80, o + 81, o + 96, o + 97, o + 112, o + 113);
  }
  if (xor_)
    for (int k = 0; k < BW; k++) out[k] ^= r[k] ^ z[k];
  else
    for (int k = 0; k < BW; k++) out[k] = r[k] ^ z[k];
}

static void next_addresses(void) {
  INPUT_B[6]++;
  compress(TMP_B, ZERO_B, INPUT_B, 0);
  compress(ADDR_B, ZERO_B, TMP_B, 0);
}

/*
 * Fill passes 0 … t-1 of Argon2id over p lanes of q = 4 × segment blocks at
 * `base`. The first two blocks of every lane are already there.
 */
void fill(u64 *base, u32 p, u32 segment, u32 t) {
  const u32 q = segment * 4;
  const u32 blocks = q * p;
  for (u32 pass = 0; pass < t; pass++) {
    for (u32 slice = 0; slice < 4; slice++) {
      for (u32 lane = 0; lane < p; lane++) {
        const int independent = pass == 0 && slice < 2;
        if (independent) {
          for (int k = 0; k < BW; k++) INPUT_B[k] = 0;
          INPUT_B[0] = pass;
          INPUT_B[1] = lane;
          INPUT_B[2] = slice;
          INPUT_B[3] = blocks;
          INPUT_B[4] = t;
          INPUT_B[5] = 2; /* Argon2id */
          INPUT_B[6] = 0;
        }
        const u32 start = pass == 0 && slice == 0 ? 2 : 0;
        if (independent && start != 0) next_addresses();
        u64 *lanep = base + (u64)lane * q * BW;
        for (u32 idx = start; idx < segment; idx++) {
          const u32 col = slice * segment + idx;
          const u32 prev = col == 0 ? q - 1 : col - 1;
          u64 pseudo;
          if (independent) {
            if (idx % 128 == 0) next_addresses();
            pseudo = ADDR_B[idx % 128];
          } else {
            pseudo = lanep[(u64)prev * BW];
          }
          const u64 j1 = pseudo & 0xffffffffull;
          const u32 j2 = (u32)(pseudo >> 32);
          const u32 ref_lane = pass == 0 && slice == 0 ? lane : j2 % p;
          const int same = ref_lane == lane;
          u64 area;
          if (pass == 0) area = same ? col - 1 : slice * segment + (idx == 0 ? -1 : 0);
          else area = same ? q - segment + idx - 1 : q - segment + (idx == 0 ? -1 : 0);
          area &= 0xffffffffull;
          const u64 x = (j1 * j1) >> 32;
          const u64 y = (area * x) >> 32;
          const u64 rel = area - 1 - y;
          const u64 start_pos = pass == 0 ? 0 : ((slice + 1) * segment) % q;
          const u32 ref_col = (u32)((start_pos + rel) % q);
          compress(lanep + (u64)col * BW, lanep + (u64)prev * BW, base + ((u64)ref_lane * q + ref_col) * BW, pass > 0);
        }
      }
    }
  }
}
