//! The update manifest's own signature (W11.S2, research R3.2).
//!
//! tauri-plugin-updater checks the signature of each *binary*, but it trusts
//! `latest.json` itself: the version, the notes and which file to fetch
//! (CVE-2026-95625). So the release signs `latest.json` too, as a detached
//! `latest.json.sig` made with the same updater key (scripts/release-run.mjs,
//! W11.S3), and the app:
//!
//!   1. downloads `latest.json` and `latest.json.sig` itself;
//!   2. verifies the signature over the exact bytes against the build's
//!      updater public key, before reading anything in the manifest;
//!   3. reads the version from the verified bytes only, and refuses a
//!      version that isn't newer than the running one and the highest ever
//!      installed here (update_guard.rs, W10.D9);
//!   4. lets the plugin fetch the manifest again for the install, and
//!      refuses unless what the plugin got is the manifest it verified;
//!   5. (T6-I2) refuses a signed manifest for another channel than the
//!      endpoint it came from, or one past its signed `expires`: the beta
//!      and stable feeds share the key, and a replayed old manifest would
//!      otherwise freeze updates ("up to date") for as long as it is served.
//!
//! The signature is Tauri's format: base64 of a minisign signature file, the
//! same as the `.sig` next to each bundle; the key is the updater key in
//! Tauri's form (base64 of a minisign public key file). The Ed25519 check is
//! the `minisign-verify` crate's (the one the plugin uses), passed in as
//! `verify`, so the rules here have no dependencies and `rustc --test
//! src/manifest_sig.rs` runs them on their own.

/// Why a manifest was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The release has no `latest.json.sig` (or it is empty).
    Unsigned,
    /// The signature or the key is not valid base64 / UTF-8, or the key is missing.
    Malformed,
    /// The signature does not verify against the updater key.
    BadSignature,
    /// The manifest is bigger than any real one.
    TooLarge,
    /// The signed manifest is for another channel, or names none (T6-I2).
    WrongChannel,
    /// The signed manifest is past its `expires`, or names no valid one (T6-I2).
    Expired,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Refusal::Unsigned => "the update manifest has no signature (latest.json.sig): update refused",
            Refusal::Malformed => "the update manifest's signature or the updater key is malformed: update refused",
            Refusal::BadSignature => "the update manifest's signature does not verify with this build's updater key: update refused",
            Refusal::TooLarge => "the update manifest is too large: update refused",
            Refusal::WrongChannel => "the update manifest is for another update channel (or names none): update refused",
            Refusal::Expired => "the update manifest has expired (or names no expiry), so it may be an old one replayed: update check failed",
        }
    }
}

/// No real latest.json comes near this (a few platforms, a short note).
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;

/// Where the signature of a manifest lives: next to it, with `.sig` added.
pub fn sig_url(manifest_url: &str) -> String {
    format!("{manifest_url}.sig")
}

/// Standard base64 (RFC 4648 §4), padding optional, ASCII whitespace ignored.
pub fn b64decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits, mut pad) = (0u32, 0u32, 0usize);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                pad += 1;
                continue;
            }
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        if pad > 0 {
            return None; // data after padding
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    // Leftover bits must be zero and fewer than 6; at most two '='.
    if pad > 2 || bits >= 6 || acc != 0 {
        return None;
    }
    Some(out)
}

/// Verify `manifest` (the exact bytes downloaded) against `sig_b64` (the
/// contents of latest.json.sig, or None when it could not be fetched) and the
/// updater key `pubkey_b64`. `verify(data, signature_text, pubkey_text)` is
/// the Ed25519/minisign check. Nothing in the manifest is read before this.
pub fn verify_manifest(manifest: &[u8], sig_b64: Option<&[u8]>, pubkey_b64: &str, verify: impl Fn(&[u8], &str, &str) -> bool) -> Result<(), Refusal> {
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err(Refusal::TooLarge);
    }
    let sig_b64 = match sig_b64 {
        Some(s) if !s.iter().all(u8::is_ascii_whitespace) => s,
        _ => return Err(Refusal::Unsigned),
    };
    let sig_b64 = std::str::from_utf8(sig_b64).map_err(|_| Refusal::Malformed)?;
    let sig_text = b64decode(sig_b64).and_then(|b| String::from_utf8(b).ok()).ok_or(Refusal::Malformed)?;
    if pubkey_b64.trim().is_empty() {
        return Err(Refusal::Malformed);
    }
    let key_text = b64decode(pubkey_b64).and_then(|b| String::from_utf8(b).ok()).ok_or(Refusal::Malformed)?;
    if verify(manifest, &sig_text, &key_text) {
        Ok(())
    } else {
        Err(Refusal::BadSignature)
    }
}

/// Seconds since 1970 of a UTC time "YYYY-MM-DDTHH:MM:SS[.fraction]Z" (the
/// form JavaScript's toISOString writes), or None for anything else.
pub fn parse_utc(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<u64> {
        let t = s.get(r)?;
        if !t.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        t.parse().ok()
    };
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let rest = &s[19..s.len() - 1];
    if !rest.is_empty() && !(rest.starts_with('.') && rest.len() > 1 && rest[1..].bytes().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let (y, mo, d, h, mi, se) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if y < 1970 || !(1..=12).contains(&mo) || d < 1 || d > dim[(mo - 1) as usize] || h > 23 || mi > 59 || se > 59 {
        return None;
    }
    // Days from 1970-01-01 (Howard Hinnant's days_from_civil).
    let (yy, m) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = yy / 400;
    let yoe = yy - era * 400;
    let doy = (153 * m + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3_600 + mi * 60 + se)
}

/// T6-I2: the verified manifest's `channel` must be the one its endpoint
/// serves (`want`: "stable" or "beta"), and `now` (seconds since 1970) must
/// be before its `expires`. Run on the verified bytes only.
pub fn check_binding(channel: Option<&str>, expires: Option<&str>, want: &str, now: u64) -> Result<(), Refusal> {
    if channel != Some(want) {
        return Err(Refusal::WrongChannel);
    }
    match expires.and_then(parse_utc) {
        Some(t) if now < t => Ok(()),
        _ => Err(Refusal::Expired),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgVEVTVApSV1FmNkxSQ0dBOWk1M21sWWVjTzRJelQ1MVRHUHB2V3VjTlNDaDFDQk0wUVRhTG43M1k3R0ZPMwo=";

    fn b64(s: &str) -> Vec<u8> {
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let b = s.as_bytes();
        let mut out = Vec::new();
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            out.push(A[(n >> 18) as usize & 63]);
            out.push(A[(n >> 12) as usize & 63]);
            out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] } else { b'=' });
            out.push(if c.len() > 2 { A[n as usize & 63] } else { b'=' });
        }
        out
    }

    /// A stand-in for minisign: the "signature" is valid when it names the data.
    fn fake_verify(data: &[u8], sig: &str, key: &str) -> bool {
        key.contains("minisign public key") && sig == format!("signed:{}", String::from_utf8_lossy(data))
    }

    #[test]
    fn base64_round_trips_and_refuses_junk() {
        assert_eq!(b64decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(b64decode("aGVsbG8").unwrap(), b"hello");
        assert_eq!(b64decode("aGVs\nbG8=\n").unwrap(), b"hello");
        assert_eq!(b64decode("").unwrap(), b"");
        assert!(b64decode("aGVsbG8*").is_none());
        assert!(b64decode("aGVsbG8=x").is_none());
        assert!(b64decode("aGVsbG9=").is_none()); // non-zero leftover bits
        assert!(b64decode("a").is_none());
        assert!(String::from_utf8(b64decode(KEY).unwrap()).unwrap().starts_with("untrusted comment: minisign public key"));
    }

    #[test]
    fn a_signed_manifest_passes() {
        let m = br#"{"version":"0.3.0"}"#;
        let sig = b64(&format!("signed:{}", std::str::from_utf8(m).unwrap()));
        assert_eq!(verify_manifest(m, Some(&sig), KEY, fake_verify), Ok(()));
    }

    #[test]
    fn a_missing_or_empty_signature_is_refused() {
        let m = br#"{"version":"0.3.0"}"#;
        assert_eq!(verify_manifest(m, None, KEY, |_, _, _| true), Err(Refusal::Unsigned));
        assert_eq!(verify_manifest(m, Some(b""), KEY, |_, _, _| true), Err(Refusal::Unsigned));
        assert_eq!(verify_manifest(m, Some(b" \n"), KEY, |_, _, _| true), Err(Refusal::Unsigned));
    }

    #[test]
    fn a_corrupt_signature_is_refused() {
        let m = br#"{"version":"0.3.0"}"#;
        // Not base64 at all, or not UTF-8 inside: refused before any check runs.
        assert_eq!(verify_manifest(m, Some(b"%%%"), KEY, |_, _, _| true), Err(Refusal::Malformed));
        assert_eq!(verify_manifest(m, Some(&b64("\u{0}")[..]), KEY, |_, _, _| false), Err(Refusal::BadSignature));
        assert_eq!(verify_manifest(m, Some(b"/w=="), KEY, |_, _, _| true), Err(Refusal::Malformed)); // 0xFF: not UTF-8
        // A signature over other bytes (an old manifest's, say) does not verify.
        let other = b64("signed:{\"version\":\"0.1.0\"}");
        assert_eq!(verify_manifest(m, Some(&other), KEY, fake_verify), Err(Refusal::BadSignature));
        // One changed byte in the manifest.
        let sig = b64(&format!("signed:{}", std::str::from_utf8(m).unwrap()));
        assert_eq!(verify_manifest(br#"{"version":"0.3.1"}"#, Some(&sig), KEY, fake_verify), Err(Refusal::BadSignature));
    }

    #[test]
    fn no_key_means_no_update() {
        let m = br#"{"version":"0.3.0"}"#;
        let sig = b64(&format!("signed:{}", std::str::from_utf8(m).unwrap()));
        assert_eq!(verify_manifest(m, Some(&sig), "", |_, _, _| true), Err(Refusal::Malformed));
        assert_eq!(verify_manifest(m, Some(&sig), "not base64!", |_, _, _| true), Err(Refusal::Malformed));
    }

    #[test]
    fn nothing_is_read_from_an_oversized_manifest() {
        let big = vec![b' '; MAX_MANIFEST_BYTES + 1];
        assert_eq!(verify_manifest(&big, Some(b"x"), KEY, |_, _, _| true), Err(Refusal::TooLarge));
    }

    #[test]
    fn utc_times_parse_like_javascript_writes_them() {
        assert_eq!(parse_utc("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_utc("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_utc("2000-03-01T00:00:00.000Z"), Some(951_868_800));
        assert_eq!(parse_utc("2026-11-15T12:34:56.789Z"), Some(1_794_746_096));
        assert_eq!(parse_utc("2024-02-29T23:59:59Z"), Some(1_709_251_199));
        for bad in ["", "2026-11-15", "2026-11-15T12:34:56", "2026-11-15T12:34:56+00:00", "2026-13-01T00:00:00Z", "2026-02-29T00:00:00Z", "2026-11-15T24:00:00Z", "2026-11-15T12:34:56.Z", "+026-11-15T12:34:56Z", "1969-12-31T23:59:59Z", "2026-11-15T12:34:5xZ"] {
            assert_eq!(parse_utc(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_manifest_for_another_channel_or_past_its_expiry_is_refused() {
        let now = parse_utc("2026-11-15T00:00:00Z").unwrap();
        let later = Some("2027-02-13T00:00:00.000Z");
        assert_eq!(check_binding(Some("stable"), later, "stable", now), Ok(()));
        assert_eq!(check_binding(Some("beta"), later, "beta", now), Ok(()));
        // A beta manifest served on the stable feed, and the other way round (one key signs both).
        assert_eq!(check_binding(Some("beta"), later, "stable", now), Err(Refusal::WrongChannel));
        assert_eq!(check_binding(Some("stable"), later, "beta", now), Err(Refusal::WrongChannel));
        // An old manifest from before channels were signed names none.
        assert_eq!(check_binding(None, later, "stable", now), Err(Refusal::WrongChannel));
        // Replayed after it ran out, at the second it runs out, or with no or a junk expiry.
        assert_eq!(check_binding(Some("stable"), Some("2026-11-14T23:59:59Z"), "stable", now), Err(Refusal::Expired));
        assert_eq!(check_binding(Some("stable"), Some("2026-11-15T00:00:00Z"), "stable", now), Err(Refusal::Expired));
        assert_eq!(check_binding(Some("stable"), None, "stable", now), Err(Refusal::Expired));
        assert_eq!(check_binding(Some("stable"), Some("never"), "stable", now), Err(Refusal::Expired));
    }

    #[test]
    fn the_signature_sits_next_to_the_manifest() {
        assert_eq!(sig_url("https://github.com/o/r/releases/latest/download/latest.json"), "https://github.com/o/r/releases/latest/download/latest.json.sig");
    }
}
