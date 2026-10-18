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

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn entry(service: &str, name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, name).map_err(|e| e.to_string())
}

/// One secret, or `None` when there is no entry.
pub fn get(service: &str, name: &str) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        match entry(service, name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (service, name);
        Err("keychain unavailable on this platform".into())
    }
}

/// Store one secret, or with `None` delete it (deleting a missing one is fine).
pub fn set(service: &str, name: &str, value: Option<&str>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let e = entry(service, name)?;
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
        let _ = (service, name, value);
        Err("keychain unavailable on this platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
