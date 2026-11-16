//! Is one vault folder inside the other, on disk (R8b-L1)? The page's check
//! (src/storage/vault/moveCheck.ts `desktopRootsNested`) compares spellings
//! (NFC, `..`, case where the platform usually ignores it); this one asks the
//! file system, so `/tmp` and `/private/tmp`, a symlink, a junction, an NFD
//! name or a different case of the same folder are seen too.
//!
//! - Both folders are resolved with `std::fs::canonicalize` (realpath).
//! - On Unix, `inner` is inside `outer` when `outer` is the same directory
//!   (device and inode) as `inner` or one of its ancestors: that holds
//!   whatever the spelling, the case or the normalisation of the names.
//! - Elsewhere, the canonical paths are compared component by component
//!   (`Path::starts_with`: `/a/Vault2` is not inside `/a/Vault`).
//!
//! Only `std`, so it is tested without the Tauri crates:
//!
//!   rustc --edition 2021 --test src-tauri/vault/src/nesting.rs -o /tmp/n && /tmp/n

use std::io;
use std::path::Path;

#[cfg(unix)]
fn same_dir(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_dir(a: &Path, b: &Path) -> bool {
    a == b
}

/// `inner` is `outer` or below it, on disk. Both must exist.
pub fn inside(outer: &Path, inner: &Path) -> io::Result<bool> {
    let o = std::fs::canonicalize(outer)?;
    let i = std::fs::canonicalize(inner)?;
    if i.starts_with(&o) {
        return Ok(true);
    }
    Ok(i.ancestors().any(|a| same_dir(a, &o)))
}

/// One folder is the other or inside it: moving the vault there would copy it into itself.
pub fn roots_nested(a: &Path, b: &Path) -> io::Result<bool> {
    Ok(inside(a, b)? || inside(b, a)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("lumen-nesting-{}-{}-{}", name, std::process::id(), stamp));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_folder_inside_the_other_either_way_and_the_same_folder() {
        let base = tmp("nest");
        let sub = base.join("Vault").join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let v = base.join("Vault");
        assert!(roots_nested(&v, &sub).unwrap());
        assert!(roots_nested(&sub, &v).unwrap());
        assert!(roots_nested(&v, &v).unwrap());
        assert!(roots_nested(&v, &base.join("Vault").join(".").join("sub").join("..")).unwrap(), "`.` and `..` resolved");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_shared_prefix_is_not_a_parent() {
        let base = tmp("prefix");
        std::fs::create_dir_all(base.join("Vault")).unwrap();
        std::fs::create_dir_all(base.join("Vault2")).unwrap();
        assert!(!roots_nested(&base.join("Vault"), &base.join("Vault2")).unwrap());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_alias_of_the_folder_is_seen() {
        // `/tmp` vs `/private/tmp` on macOS is the same case: one folder, two spellings.
        let base = tmp("alias");
        let real = base.join("Real");
        std::fs::create_dir_all(real.join("sub")).unwrap();
        let alias = base.join("Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        assert!(roots_nested(&alias, &real.join("sub")).unwrap());
        assert!(roots_nested(&real, &alias.join("sub")).unwrap());
        assert!(roots_nested(&alias, &real).unwrap());
        // A link inside the vault that points out of it does not make the target nested.
        let other = base.join("Other");
        std::fs::create_dir_all(&other).unwrap();
        std::os::unix::fs::symlink(&other, real.join("out")).unwrap();
        assert!(!roots_nested(&real, &other).unwrap());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn names_in_another_unicode_form_are_other_folders_where_the_disk_says_so() {
        // On a file system that keeps the bytes (ext4), NFC "Café" and NFD "Café" are two folders;
        // APFS treats them as one, and then canonicalize / the inode say so. The disk decides.
        let base = tmp("nfd");
        let nfc = base.join("Caf\u{e9}");
        let nfd = base.join("Cafe\u{301}");
        std::fs::create_dir_all(&nfc).unwrap();
        let one_folder = nfd.exists();
        if !one_folder {
            std::fs::create_dir_all(&nfd).unwrap();
        }
        assert_eq!(roots_nested(&nfc, &nfd).unwrap(), one_folder);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_folder_that_does_not_exist_is_an_error_not_a_no() {
        let base = tmp("missing");
        assert!(roots_nested(&base, &base.join("nope")).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
