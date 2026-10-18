//! OS keychain access for Lumen's secrets (T36, plan 2.5): the macOS Keychain
//! and the Windows Credential Manager, through the `keyring` crate. Other
//! platforms report the keychain as unavailable, and the app keeps its
//! WebCrypto store there.

/// The service name every Lumen secret is stored under.
pub const SERVICE: &str = "app.lumen.secrets";

/// Does this platform have a keychain the app uses?
pub fn available() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

/// Characters per stored entry. The Windows Credential Manager caps a
/// credential blob at 5 × 512 bytes, and keyring stores the password as
/// UTF-16 there, so a value longer than this (a Supabase session with its
/// user metadata easily is) is split over several entries (plan 2.5).
pub const CHUNK_CHARS: usize = 512;
const HEADER: &str = "lumen-keychain-chunks:";

fn chunk_name(name: &str, i: usize) -> String {
    format!("{name}#chunk{i}")
}

/// The store the chunking is built on: one entry per name.
trait Backend {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: Option<&str>) -> Result<(), String>;
}

fn chunk_count(b: &dyn Backend, name: &str) -> Result<usize, String> {
    Ok(match b.get(name)? {
        Some(v) => v
            .strip_prefix(HEADER)
            .and_then(|n| n.parse().ok())
            .unwrap_or(0),
        None => 0,
    })
}

fn get_with(b: &dyn Backend, name: &str) -> Result<Option<String>, String> {
    let Some(v) = b.get(name)? else {
        return Ok(None);
    };
    let Some(n) = v.strip_prefix(HEADER).and_then(|n| n.parse::<usize>().ok()) else {
        return Ok(Some(v));
    };
    let mut out = String::new();
    for i in 1..=n {
        match b.get(&chunk_name(name, i))? {
            Some(part) => out.push_str(&part),
            None => return Err(format!("{name}: chunk {i} of {n} is missing")),
        }
    }
    Ok(Some(out))
}

fn set_with(b: &dyn Backend, name: &str, value: Option<&str>) -> Result<(), String> {
    let old = chunk_count(b, name)?;
    let new = match value {
        None => {
            b.set(name, None)?;
            0
        }
        Some(v) if v.chars().count() <= CHUNK_CHARS && !v.starts_with(HEADER) => {
            b.set(name, Some(v))?;
            0
        }
        Some(v) => {
            let chars: Vec<char> = v.chars().collect();
            let parts: Vec<String> = chars
                .chunks(CHUNK_CHARS)
                .map(|c| c.iter().collect())
                .collect();
            // The parts first, the header last: a reader never sees a header without its parts.
            for (i, part) in parts.iter().enumerate() {
                b.set(&chunk_name(name, i + 1), Some(part))?;
            }
            b.set(name, Some(&format!("{HEADER}{}", parts.len())))?;
            parts.len()
        }
    };
    // Parts of an earlier, longer value.
    for i in new + 1..=old {
        b.set(&chunk_name(name, i), None)?;
    }
    Ok(())
}

/// The OS keychain under one service name.
struct Os<'a>(&'a str);

impl Backend for Os<'_> {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            match keyring::Entry::new(self.0, name)
                .map_err(|e| e.to_string())?
                .get_password()
            {
                Ok(v) => Ok(Some(v)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (self.0, name);
            Err("keychain unavailable on this platform".into())
        }
    }

    fn set(&self, name: &str, value: Option<&str>) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let e = keyring::Entry::new(self.0, name).map_err(|e| e.to_string())?;
            match value {
                Some(v) => e.set_password(v).map_err(|e| e.to_string()),
                None => match e.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(err) => Err(err.to_string()),
                },
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (self.0, name, value);
            Err("keychain unavailable on this platform".into())
        }
    }
}

/// One secret, or `None` when there is no entry.
pub fn get(service: &str, name: &str) -> Result<Option<String>, String> {
    get_with(&Os(service), name)
}

/// Store one secret, or with `None` delete it (deleting a missing one is fine).
/// A value over [`CHUNK_CHARS`] is split over several entries.
pub fn set(service: &str, name: &str, value: Option<&str>) -> Result<(), String> {
    set_with(&Os(service), name, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// An in-memory backend with the Windows size limit, so the chunking is
    /// tested on every platform.
    struct Mem(RefCell<HashMap<String, String>>);
    impl Backend for Mem {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: Option<&str>) -> Result<(), String> {
            match value {
                Some(v) if v.encode_utf16().count() * 2 > 2560 => {
                    Err("blob over 2560 bytes".into())
                }
                Some(v) => {
                    self.0.borrow_mut().insert(name.into(), v.into());
                    Ok(())
                }
                None => {
                    self.0.borrow_mut().remove(name);
                    Ok(())
                }
            }
        }
    }

    #[test]
    fn long_values_are_chunked_and_cleaned_up() {
        let m = Mem(RefCell::new(HashMap::new()));
        let session = format!(
            r#"{{"access_token":"{}","user":{{"name":"טל","meta":"{}"}}}}"#,
            "a".repeat(1200),
            "m".repeat(2500)
        );
        set_with(&m, "sb-proj-auth-token", Some(&session)).unwrap();
        assert_eq!(
            get_with(&m, "sb-proj-auth-token").unwrap().as_deref(),
            Some(session.as_str())
        );
        assert!(m.0.borrow().len() > 2);
        // A shorter value replaces it and the stale parts go.
        set_with(&m, "sb-proj-auth-token", Some("short")).unwrap();
        assert_eq!(
            get_with(&m, "sb-proj-auth-token").unwrap().as_deref(),
            Some("short")
        );
        assert_eq!(m.0.borrow().len(), 1);
        set_with(&m, "sb-proj-auth-token", Some(&session)).unwrap();
        set_with(&m, "sb-proj-auth-token", None).unwrap();
        assert!(m.0.borrow().is_empty());
        // A value that looks like a header is chunked too, never misread.
        set_with(&m, "x", Some("lumen-keychain-chunks:9")).unwrap();
        assert_eq!(
            get_with(&m, "x").unwrap().as_deref(),
            Some("lumen-keychain-chunks:9")
        );
    }

    #[test]
    fn a_missing_part_is_an_error_not_a_truncated_secret() {
        let m = Mem(RefCell::new(HashMap::new()));
        set_with(&m, "k", Some(&"z".repeat(CHUNK_CHARS * 2 + 1))).unwrap();
        m.0.borrow_mut().remove("k#chunk2");
        assert!(get_with(&m, "k").is_err());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn unavailable_elsewhere() {
        assert!(!available());
        assert!(get(SERVICE, "x").is_err());
        assert!(set(SERVICE, "x", Some("v")).is_err());
    }

    /// A service name of its own per run, so tests never touch the app's
    /// secrets and parallel runs never collide.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn test_service(tag: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{SERVICE}.test.{tag}.{}.{nanos}", std::process::id())
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn round_trip_overwrite_and_delete() {
        assert!(available());
        let svc = test_service("rt");
        let name = "lumen.ai.key.anthropic";
        assert_eq!(get(&svc, name).unwrap(), None);
        set(&svc, name, Some("sk-ant-test-1")).unwrap();
        assert_eq!(get(&svc, name).unwrap().as_deref(), Some("sk-ant-test-1"));
        set(&svc, name, Some("sk-ant-test-2")).unwrap();
        assert_eq!(get(&svc, name).unwrap().as_deref(), Some("sk-ant-test-2"));
        set(&svc, name, None).unwrap();
        assert_eq!(get(&svc, name).unwrap(), None);
        // Deleting what is not there is not an error (removeSecret on a fresh install).
        set(&svc, name, None).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn keeps_unicode_and_a_full_session() {
        let svc = test_service("uni");
        let hebrew = "סיסמה-חדר-🔑";
        set(&svc, "lumen.collab.password", Some(hebrew)).unwrap();
        assert_eq!(
            get(&svc, "lumen.collab.password").unwrap().as_deref(),
            Some(hebrew)
        );
        // A Supabase session (JSON with two JWT-sized tokens) fits.
        let session = format!(
            r#"{{"access_token":"{}","refresh_token":"{}"}}"#,
            "a".repeat(900),
            "r".repeat(40)
        );
        set(&svc, "sb-proj-auth-token", Some(&session)).unwrap();
        assert_eq!(
            get(&svc, "sb-proj-auth-token").unwrap().as_deref(),
            Some(session.as_str())
        );
        set(&svc, "lumen.collab.password", None).unwrap();
        set(&svc, "sb-proj-auth-token", None).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn a_session_over_the_windows_blob_limit_round_trips() {
        let svc = test_service("big");
        let session = format!(
            r#"{{"access_token":"{}","provider_token":"{}","user":{{"user_metadata":"{}"}}}}"#,
            "a".repeat(1100),
            "p".repeat(900),
            "מ".repeat(1500)
        );
        set(&svc, "sb-proj-auth-token", Some(&session)).unwrap();
        assert_eq!(
            get(&svc, "sb-proj-auth-token").unwrap().as_deref(),
            Some(session.as_str())
        );
        set(&svc, "sb-proj-auth-token", None).unwrap();
        assert_eq!(get(&svc, "sb-proj-auth-token").unwrap(), None);
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn names_are_separate() {
        let svc = test_service("sep");
        set(&svc, "a", Some("1")).unwrap();
        set(&svc, "b", Some("2")).unwrap();
        assert_eq!(get(&svc, "a").unwrap().as_deref(), Some("1"));
        assert_eq!(get(&svc, "b").unwrap().as_deref(), Some("2"));
        set(&svc, "a", None).unwrap();
        assert_eq!(get(&svc, "b").unwrap().as_deref(), Some("2"));
        set(&svc, "b", None).unwrap();
    }
}
