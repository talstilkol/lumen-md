//! Staged rollout on the device (plan W13.T1): the desktop shell's copy of
//! src/update/stagedRollout.ts. The signed manifest (verified before it is
//! read, W11.S2/S3) may carry `"rollout": {"percent": 5, "salt": "v1.5.0"}`
//! and `"halt": true`. This device is in when
//!
//!   first 4 bytes (big-endian) of SHA-256(salt ":" install_id) mod 10000
//!     < round(percent × 100)
//!
//! The install id is 128 random bits made on this device, kept in the app
//! data folder and never sent: the release host cannot tell who is in. A
//! malformed rollout holds the update (it never widens who gets it).
//! Checked against the same vectors as the TypeScript rule.
//!
//! Std only, so `rustc --test src/rollout.rs` runs it on its own.

pub const BUCKETS: u32 = 10_000;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Verdict {
    Admit,
    /// `"halt": true`: nobody else is offered this release.
    Halted,
    /// Not this device's turn yet.
    Staged,
    /// The rollout fields are malformed: held.
    Invalid,
}

impl Verdict {
    pub fn name(self) -> &'static str {
        match self {
            Verdict::Admit => "admit",
            Verdict::Halted => "halted",
            Verdict::Staged => "staged",
            Verdict::Invalid => "invalid",
        }
    }
}

/// The rollout fields as read from the verified manifest: `percent` and
/// `salt` of `rollout` (None when there is no `rollout`), and `halt`.
/// `rollout_present` is true when the manifest has a non-null `rollout`, so
/// a present but unreadable one is held.
pub struct Fields<'a> {
    pub rollout_present: bool,
    pub percent: Option<f64>,
    pub salt: Option<&'a str>,
    /// None: no `halt`; Some(Err) when it is not a boolean.
    pub halt: Option<Result<bool, ()>>,
}

pub fn threshold(percent: f64) -> u32 {
    (percent.clamp(0.0, 100.0) * 100.0).round() as u32
}

pub fn bucket(install_id: &str, salt: &str) -> u32 {
    let mut data = Vec::with_capacity(salt.len() + 1 + install_id.len());
    data.extend_from_slice(salt.as_bytes());
    data.push(b':');
    data.extend_from_slice(install_id.as_bytes());
    let h = sha256(&data);
    u32::from_be_bytes([h[0], h[1], h[2], h[3]]) % BUCKETS
}

pub fn admit(f: &Fields, install_id: &str) -> Verdict {
    match f.halt {
        Some(Err(())) => return Verdict::Invalid,
        Some(Ok(true)) => return Verdict::Halted,
        _ => {}
    }
    if !f.rollout_present {
        return Verdict::Admit;
    }
    let (Some(p), Some(salt)) = (f.percent, f.salt) else { return Verdict::Invalid };
    if !p.is_finite() || !(0.0..=100.0).contains(&p) || salt.trim().is_empty() || salt.chars().count() > 64 {
        return Verdict::Invalid;
    }
    let t = threshold(p);
    if t >= BUCKETS || bucket(install_id, salt) < t {
        Verdict::Admit
    } else {
        Verdict::Staged
    }
}

/// An install id from 16 random bytes: lowercase hex.
pub fn install_id_from(bytes: [u8; 16]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A kept install id is 32 lowercase hex digits; anything else is replaced.
pub fn valid_install_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// 16 random bytes without a crate: the OS's randomness where std reaches it
/// (/dev/urandom), else std's randomly keyed hasher (seeded by the OS) mixed
/// with the clock. Only needs to be unpredictable enough to spread devices.
pub fn random_bytes() -> [u8; 16] {
    let mut out = [0u8; 16];
    #[cfg(unix)]
    {
        use std::io::Read;
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            if f.read_exact(&mut out).is_ok() {
                return out;
            }
        }
    }
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(now);
        h.write_usize(i);
        h.write_u32(std::process::id());
        chunk.copy_from_slice(&h.finish().to_be_bytes()[..chunk.len()]);
    }
    out
}

/// SHA-256 (FIPS 180-4), std only.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for block in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[4 * i], block[4 * i + 1], block[4 * i + 2], block[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    let mut out = [0u8; 32];
    for (i, x) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn sha256_known_answers() {
        assert_eq!(hex(&sha256(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(hex(&sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(hex(&sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        assert_eq!(hex(&sha256(&[b'a'; 1000])), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    }

    /// The vectors the TypeScript rule and the release script are checked against.
    #[test]
    fn same_buckets_as_the_typescript_rule() {
        let text = include_str!("../../src/update/rolloutVectors.json");
        let mut n = 0;
        for chunk in text.split('{').skip(2) {
            let field = |k: &str| -> Option<String> {
                let i = chunk.find(&format!("\"{k}\":"))? + k.len() + 3;
                let rest = chunk[i..].trim_start();
                if let Some(r) = rest.strip_prefix('"') {
                    Some(r[..r.find('"')?].to_string())
                } else {
                    Some(rest.split(|c: char| !c.is_ascii_digit()).next()?.to_string())
                }
            };
            let (Some(salt), Some(id), Some(b)) = (field("salt"), field("installId"), field("bucket")) else { continue };
            assert_eq!(bucket(&id, &salt), b.parse::<u32>().unwrap(), "{salt} {id}");
            n += 1;
        }
        assert_eq!(n, 15, "every vector was read");
    }

    fn fields(percent: Option<f64>, salt: Option<&str>, halt: Option<Result<bool, ()>>) -> Fields<'_> {
        Fields { rollout_present: percent.is_some() || salt.is_some(), percent, salt, halt }
    }

    #[test]
    fn five_percent_of_ten_thousand_ids() {
        let mut state = 0x9e3779b97f4a7c15u64;
        let mut admitted = 0;
        for _ in 0..10_000 {
            let mut b = [0u8; 16];
            for x in b.iter_mut() {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                *x = state as u8;
            }
            if admit(&fields(Some(5.0), Some("v1.5.0"), None), &install_id_from(b)) == Verdict::Admit {
                admitted += 1;
            }
        }
        assert!((400..=600).contains(&admitted), "5% ±1%: {admitted}");
    }

    #[test]
    fn halt_full_staged_and_invalid() {
        let id = "5f2b8c1e9a4d47c3b0e16a7d2c9f8e01";
        assert_eq!(admit(&fields(None, None, None), id), Verdict::Admit);
        assert_eq!(admit(&fields(None, None, Some(Ok(true))), id), Verdict::Halted);
        assert_eq!(admit(&fields(Some(100.0), Some("s"), Some(Ok(true))), id), Verdict::Halted);
        assert_eq!(admit(&fields(Some(100.0), Some("s"), None), id), Verdict::Admit);
        assert_eq!(admit(&fields(Some(0.0), Some("s"), None), id), Verdict::Staged);
        assert_eq!(admit(&fields(Some(101.0), Some("s"), None), id), Verdict::Invalid);
        assert_eq!(admit(&fields(Some(f64::NAN), Some("s"), None), id), Verdict::Invalid);
        assert_eq!(admit(&fields(Some(5.0), None, None), id), Verdict::Invalid);
        assert_eq!(admit(&fields(Some(5.0), Some("  "), None), id), Verdict::Invalid);
        assert_eq!(admit(&fields(None, None, Some(Err(()))), id), Verdict::Invalid);
        // Raising the percent keeps every device that was in.
        let b = bucket(id, "v1.5.0");
        let p = (b + 1) as f64 / 100.0;
        assert_eq!(admit(&fields(Some(p), Some("v1.5.0"), None), id), Verdict::Admit);
        assert_eq!(admit(&fields(Some(p + 20.0), Some("v1.5.0"), None), id), Verdict::Admit);
    }

    #[test]
    fn install_ids() {
        let id = install_id_from(random_bytes());
        assert!(valid_install_id(&id), "{id}");
        assert_ne!(id, install_id_from(random_bytes()));
        assert!(!valid_install_id("5F2B8C1E9A4D47C3B0E16A7D2C9F8E01"));
        assert!(!valid_install_id("short"));
    }
}
