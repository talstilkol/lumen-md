//! The MCP stdio allow-list (plan W13.X1, review 8b R8b-M1): a server's program runs only when
//! the user approved **this exact program file, this exact argument list and this folder**.
//!
//! An approval pins:
//! - the program's **absolute, resolved path** (a bare name is looked up on `PATH` once, symlinks
//!   are followed, and the real file is what is pinned and what is started);
//! - the program file's **sha256**: one changed byte and the approval no longer matches;
//! - the **full argv**, in order, and the folder;
//! - the sha256 of **every argument that names an existing file** (a script or a config the
//!   program is handed), so a script that changes needs a new approval too.
//!
//! Anything else is refused before a process is started (`may_spawn`, `checked_spawn`). The
//! deny-list in `Spec::validate` (shells, launchers, `npx -y`, invisible characters) stays in
//! front as defence in depth, but it is no longer the gate: an interpreter with an approved,
//! pinned script runs; the same interpreter with any other argv does not, whatever that argv is.
//!
//! Old approvals (format 1: the command line only, no path or hash) are not honoured: the user
//! approves each command again once, and gets the pinned form.
//!
//! Limits: the file is hashed just before it is started, so a program swapped in between those
//! two moments is not caught (it needs write access to the pinned path); and hashing a large
//! interpreter takes a moment on each start.

use crate::{quote, spawn, Event, Session, Spec};
use std::io::Read;
use std::path::{Path, PathBuf};

/// The line prefix of the pinned format. A line without it is an old approval and is ignored.
const FORMAT: &str = "pin2 ";

// ---------------------------------------------------------------- sha256 (FIPS 180-4), std only

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// A streaming SHA-256.
pub struct Sha256 {
    h: [u32; 8],
    buf: [u8; 64],
    len: usize,
    total: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Sha256 { h: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], buf: [0; 64], len: 0, total: 0 }
    }
}

impl Sha256 {
    fn block(&mut self, b: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([b[4 * i], b[4 * i + 1], b[4 * i + 2], b[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b2, mut c, mut d, mut e, mut f, mut g, mut h] = self.h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b2) ^ (a & c) ^ (b2 & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b2;
            b2 = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in self.h.iter_mut().zip([a, b2, c, d, e, f, g, h]) {
            *x = x.wrapping_add(y);
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        while !data.is_empty() {
            let take = (64 - self.len).min(data.len());
            self.buf[self.len..self.len + take].copy_from_slice(&data[..take]);
            self.len += take;
            data = &data[take..];
            if self.len == 64 {
                let b = self.buf;
                self.block(&b);
                self.len = 0;
            }
        }
    }

    pub fn hex(mut self) -> String {
        let bits = self.total.wrapping_mul(8);
        self.update(&[0x80]);
        while self.len != 56 {
            self.update(&[0]);
        }
        self.update(&bits.to_be_bytes());
        self.h.iter().map(|x| format!("{x:08x}")).collect()
    }
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut s = Sha256::default();
    s.update(data);
    s.hex()
}

/// The sha256 of a file's bytes, read in pieces.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let mut s = Sha256::default();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        s.update(&buf[..n]);
    }
    Ok(s.hex())
}

// ---------------------------------------------------------------- resolving and pinning

fn is_absolute(p: &str) -> bool {
    Path::new(p).is_absolute() || (p.len() > 2 && p.as_bytes()[1] == b':' && (p.as_bytes()[2] == b'\\' || p.as_bytes()[2] == b'/'))
}

/// The real file a command names: an absolute path as it is, a bare name looked up on `path_var`
/// (the PATH the server gets); symlinks followed. A relative path with a folder in it is refused:
/// what it names depends on the app's working folder.
pub fn resolve_program(command: &str, path_var: Option<&str>) -> Result<PathBuf, String> {
    let found = if is_absolute(command) {
        PathBuf::from(command)
    } else if command.contains('/') || command.contains('\\') {
        return Err(format!("not approved: \"{command}\" is a relative path; give the program's full path"));
    } else {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let mut hit = None;
        for dir in path_var.unwrap_or("").split(sep).filter(|d| !d.is_empty() && is_absolute(d)) {
            let mut names = vec![command.to_string()];
            if cfg!(windows) && !command.contains('.') {
                names.push(format!("{command}.exe"));
            }
            for n in names {
                let p = Path::new(dir).join(&n);
                if p.is_file() {
                    hit = Some(p);
                    break;
                }
            }
            if hit.is_some() {
                break;
            }
        }
        hit.ok_or_else(|| format!("not approved: \"{command}\" is not on the PATH Lumen gives servers; give the program's full path"))?
    };
    let real = std::fs::canonicalize(&found).map_err(|e| format!("not approved: the program {} cannot be found: {e}", found.display()))?;
    if !real.is_file() {
        return Err(format!("not approved: {} is not a program file", real.display()));
    }
    Ok(real)
}

/// One exact, pinned command: what the dialog shows and what the allow-list holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    /// The resolved absolute path that runs.
    pub program: String,
    pub program_sha256: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// Arguments that name an existing file, by position, with the file's sha256.
    pub files: Vec<(usize, String)>,
}

impl Pin {
    /// What an approval is for, without the hashes (the same program, argv and folder).
    pub fn key(&self) -> String {
        let mut out = String::from(FORMAT);
        out.push('[');
        out.push_str(&quote(&self.program));
        for a in &self.args {
            out.push(',');
            out.push_str(&quote(a));
        }
        out.push_str("]@");
        out.push_str(&self.cwd.as_deref().map(quote).unwrap_or_else(|| "null".into()));
        out
    }

    /// The allow-list line: the key and every hash. Equal lines, equal approvals.
    pub fn line(&self) -> String {
        let mut out = self.key();
        out.push_str(" sha256=");
        out.push_str(&self.program_sha256);
        for (i, h) in &self.files {
            out.push_str(&format!(" arg{i}={h}"));
        }
        out
    }

    /// The spec that is started: the resolved program, the approved argv and folder.
    pub fn spec(&self) -> Spec {
        Spec { command: self.program.clone(), args: self.args.clone(), cwd: self.cwd.clone() }
    }
}

/// Resolve and hash `spec` as it stands now (the program file and every file an argument names).
pub fn pin(spec: &Spec, path_var: Option<&str>) -> Result<Pin, String> {
    let program = resolve_program(&spec.command, path_var)?;
    if let Some(cwd) = &spec.cwd {
        if !is_absolute(cwd) {
            return Err("not approved: the folder must be a full path".into());
        }
    }
    let program_sha256 = sha256_file(&program)?;
    let base: Option<PathBuf> = match &spec.cwd {
        Some(c) => Some(PathBuf::from(c)),
        None => std::env::current_dir().ok(),
    };
    let mut files = Vec::new();
    for (i, a) in spec.args.iter().enumerate() {
        if a.is_empty() || a.starts_with('-') {
            continue;
        }
        let p = if is_absolute(a) { Some(PathBuf::from(a)) } else { base.as_ref().map(|b| b.join(a)) };
        if let Some(p) = p {
            if p.is_file() {
                files.push((i, sha256_file(&p)?));
            }
        }
    }
    Ok(Pin { program: program.to_string_lossy().into_owned(), program_sha256, args: spec.args.clone(), cwd: spec.cwd.clone(), files })
}

// ---------------------------------------------------------------- the allow-list

/// What the user approved, one pinned line each (the file the glue keeps in the config folder).
#[derive(Default, Debug, Clone)]
pub struct AllowList {
    lines: Vec<String>,
}

impl AllowList {
    /// Only pinned lines are kept; an old command-line-only approval is dropped (approve again).
    pub fn parse(text: &str) -> Self {
        let mut lines: Vec<String> = Vec::new();
        for l in text.lines() {
            let l = l.trim_end_matches('\r');
            if l.starts_with(FORMAT) && !lines.iter().any(|x| x == l) {
                lines.push(l.to_string());
            }
        }
        AllowList { lines }
    }
    pub fn serialize(&self) -> String {
        let mut s = self.lines.join("\n");
        if !s.is_empty() {
            s.push('\n');
        }
        s
    }
    /// Is this exact pin (path, every hash, argv, folder) approved?
    pub fn allows(&self, p: &Pin) -> bool {
        let l = p.line();
        self.lines.iter().any(|x| *x == l)
    }
    /// Was the same program, argv and folder approved with other hashes (it changed since)?
    pub fn changed(&self, p: &Pin) -> bool {
        let k = format!("{} ", p.key());
        !self.allows(p) && self.lines.iter().any(|x| x.starts_with(&k))
    }
    /// Approve `p`; an older approval of the same command (other hashes) is replaced.
    pub fn add(&mut self, p: &Pin) {
        let k = format!("{} ", p.key());
        self.lines.retain(|x| !x.starts_with(&k));
        self.lines.push(p.line());
    }
    /// Withdraw every approval of this program, argv and folder, whatever the hashes.
    pub fn revoke_key(&mut self, key: &str) -> bool {
        let k = format!("{key} ");
        let before = self.lines.len();
        self.lines.retain(|x| !x.starts_with(&k));
        before != self.lines.len()
    }
    pub fn len(&self) -> usize {
        self.lines.len()
    }
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

/// The key a revoke uses: the resolved program when it can still be found, else the command as given.
pub fn revoke_key_of(spec: &Spec, path_var: Option<&str>) -> String {
    let program = resolve_program(&spec.command, path_var).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| spec.command.clone());
    Pin { program, program_sha256: String::new(), args: spec.args.clone(), cwd: spec.cwd.clone(), files: vec![] }.key()
}

/// May `spec` start now? The deny-list first (defence in depth), then the exact pin. Returns the
/// pin, whose `spec()` is what to start (the resolved program, not a name looked up again).
pub fn may_spawn(spec: &Spec, allow: &AllowList, path_var: Option<&str>) -> Result<Pin, String> {
    spec.validate()?;
    let p = pin(spec, path_var)?;
    if allow.allows(&p) {
        return Ok(p);
    }
    if allow.changed(&p) {
        return Err("changed since approval: the program or a file it is given is not the one you approved; approve it again".into());
    }
    Err("not approved: Lumen runs a server's command only after you approve that exact program, its arguments and its folder".into())
}

/// The only way the glue starts a server: refused before any process exists unless `may_spawn` says yes.
pub fn checked_spawn(spec: &Spec, allow: &AllowList, path_var: Option<&str>, env: Vec<(String, String)>, on_event: impl Fn(Event) + Send + Sync + 'static) -> Result<Session, String> {
    let p = may_spawn(spec, allow, path_var)?;
    spawn(&p.spec(), env, on_event)
}

// ---------------------------------------------------------------- the dialog

/// The native dialog's language: Hebrew or English (the rest of the UI's languages read English here).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    He,
    En,
}

impl Lang {
    pub fn of(code: Option<&str>) -> Lang {
        match code.map(|c| c.to_ascii_lowercase()) {
            Some(c) if c == "he" || c.starts_with("he-") || c == "iw" => Lang::He,
            _ => Lang::En,
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Lang::He => "להריץ שרת MCP?",
            Lang::En => "Run an MCP server?",
        }
    }
    pub fn allow(self) -> &'static str {
        match self {
            Lang::He => "לאשר",
            Lang::En => "Allow",
        }
    }
    pub fn deny(self) -> &'static str {
        match self {
            Lang::He => "לא לאשר",
            Lang::En => "Don't allow",
        }
    }
}

/// The dialog text for a pinned command: the command (`approval_text`), then what the approval pins.
pub fn pin_text(server: &str, p: &Pin, changed: bool, lang: Lang) -> String {
    let mut t = String::new();
    if changed {
        t.push_str(match lang {
            Lang::He => "התוכנה, או קובץ שהיא מקבלת, השתנו מאז שאישרת אותה. אפשר להריץ רק אחרי אישור מחדש.\n\n",
            Lang::En => "The program, or a file it is given, changed since you approved it. It runs only if you approve it again.\n\n",
        });
    }
    t.push_str(&crate::approval_text_in(server, &p.spec(), lang));
    t.push_str(match lang {
        Lang::He => "\n\nהאישור הוא רק לקובץ הזה בדיוק (sha256):\n  ",
        Lang::En => "\n\nThe approval is for this exact file only (sha256):\n  ",
    });
    t.push_str(&p.program_sha256);
    for (i, h) in &p.files {
        t.push_str(&match lang {
            Lang::He => format!("\n  ארגומנט {} (קובץ): {h}", i + 1),
            Lang::En => format!("\n  argument {} (a file): {h}", i + 1),
        });
    }
    t.push_str(match lang {
        Lang::He => "\n\nשינוי של בייט אחד בתוכנה או בקבצים האלה, או ארגומנט אחר, ידרוש אישור חדש.",
        Lang::En => "\n\nOne changed byte in the program or in these files, or any other argument, needs a new approval.",
    });
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Duration;

    static N: AtomicUsize = AtomicUsize::new(0);

    /// A fresh folder under the temp dir (canonical, so pins compare equal on macOS's /private/var).
    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumen-allow-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(d).unwrap()
    }

    fn s(cmd: &str, args: &[&str], cwd: Option<&str>) -> Spec {
        Spec { command: cmd.into(), args: args.iter().map(|a| a.to_string()).collect(), cwd: cwd.map(String::from) }
    }

    /// A program of our own: a copy of the system's `touch`, so bytes can be changed.
    #[cfg(unix)]
    fn own_touch(d: &Path, name: &str) -> String {
        let src = ["/usr/bin/touch", "/bin/touch"].iter().find(|p| Path::new(p).is_file()).expect("touch");
        let dst = d.join(name);
        std::fs::copy(src, &dst).unwrap();
        dst.to_string_lossy().into_owned()
    }

    fn approve(list: &mut AllowList, spec: &Spec) {
        list.add(&pin(spec, None).unwrap());
    }

    #[test]
    fn sha256_known_answers() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        let mut st = Sha256::default();
        for _ in 0..1000 {
            st.update(&[b'a'; 1000]);
        }
        assert_eq!(st.hex(), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    #[cfg(unix)]
    #[test]
    fn nothing_runs_before_approval_and_an_approved_command_runs() {
        let d = dir();
        let prog = own_touch(&d, "srv");
        let marker = d.join("ran").to_string_lossy().into_owned();
        let spec = s(&prog, &[&marker], None);
        let mut list = AllowList::default();
        let e = checked_spawn(&spec, &list, None, vec![], |_| {}).err().expect("refused");
        assert!(e.starts_with("not approved"), "{e}");
        std::thread::sleep(Duration::from_millis(200));
        assert!(!Path::new(&marker).exists(), "refused before spawn: no process ran");
        approve(&mut list, &spec);
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = Mutex::new(tx);
        let sess = checked_spawn(&spec, &list, None, vec![], move |e| {
            let _ = tx.lock().unwrap().send(e);
        })
        .expect("approved");
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(5)) {
            if matches!(e, Event::Exit(_)) {
                break;
            }
        }
        sess.close(Duration::from_secs(1));
        assert!(Path::new(&marker).exists(), "the approved command ran");
    }

    #[cfg(unix)]
    #[test]
    fn one_changed_byte_in_the_program_needs_a_new_approval() {
        let d = dir();
        let prog = own_touch(&d, "srv");
        let spec = s(&prog, &["/nonexistent-dir/x"], None);
        let mut list = AllowList::default();
        approve(&mut list, &spec);
        assert!(may_spawn(&spec, &list, None).is_ok());
        let mut bytes = std::fs::read(&prog).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        std::fs::write(&prog, &bytes).unwrap();
        let e = may_spawn(&spec, &list, None).unwrap_err();
        assert!(e.starts_with("changed since approval"), "{e}");
        assert!(checked_spawn(&spec, &list, None, vec![], |_| {}).is_err());
        // Approving again replaces the old pin (one line, the new hash).
        approve(&mut list, &spec);
        assert!(may_spawn(&spec, &list, None).is_ok());
        assert_eq!(list.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn the_same_bytes_at_another_path_are_not_approved() {
        let d = dir();
        let a = own_touch(&d, "a");
        let b = own_touch(&d, "b");
        let mut list = AllowList::default();
        approve(&mut list, &s(&a, &["x"], None));
        assert_eq!(pin(&s(&a, &[], None), None).unwrap().program_sha256, pin(&s(&b, &[], None), None).unwrap().program_sha256);
        assert!(may_spawn(&s(&b, &["x"], None), &list, None).unwrap_err().starts_with("not approved"));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_pointed_elsewhere_is_not_approved() {
        use std::os::unix::fs::symlink;
        let d = dir();
        let a = own_touch(&d, "a");
        let b = own_touch(&d, "b");
        let link = d.join("srv");
        symlink(&a, &link).unwrap();
        let spec = s(link.to_str().unwrap(), &["x"], None);
        let mut list = AllowList::default();
        approve(&mut list, &spec);
        assert_eq!(may_spawn(&spec, &list, None).unwrap().program, a, "the real file is pinned and started");
        std::fs::remove_file(&link).unwrap();
        symlink(&b, &link).unwrap();
        assert!(may_spawn(&spec, &list, None).is_err(), "same name, other file");
    }

    #[cfg(unix)]
    #[test]
    fn any_other_argv_or_folder_is_not_approved() {
        let d = dir();
        let prog = own_touch(&d, "srv");
        let base = d.to_string_lossy().into_owned();
        let spec = s(&prog, &["--flag", "one", "two"], Some(&base));
        let mut list = AllowList::default();
        approve(&mut list, &spec);
        assert!(may_spawn(&spec, &list, None).is_ok());
        let other_dir = dir();
        for (why, other) in [
            ("no arguments", s(&prog, &[], Some(&base))),
            ("one missing", s(&prog, &["--flag", "one"], Some(&base))),
            ("one extra", s(&prog, &["--flag", "one", "two", "three"], Some(&base))),
            ("reordered", s(&prog, &["--flag", "two", "one"], Some(&base))),
            ("one edited", s(&prog, &["--flag", "one", "tw0"], Some(&base))),
            ("split", s(&prog, &["--flag", "one two"], Some(&base))),
            ("another folder", s(&prog, &["--flag", "one", "two"], other_dir.to_str())),
            ("no folder", s(&prog, &["--flag", "one", "two"], None)),
        ] {
            let e = may_spawn(&other, &list, None).unwrap_err();
            assert!(e.starts_with("not approved"), "{why}: {e}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_file_the_program_is_given_is_pinned_too() {
        let d = dir();
        let prog = own_touch(&d, "interp");
        let script = d.join("server.script");
        std::fs::write(&script, b"version one").unwrap();
        let base = d.to_string_lossy().into_owned();
        for spec in [s(&prog, &[script.to_str().unwrap()], None), s(&prog, &["server.script"], Some(&base))] {
            std::fs::write(&script, b"version one").unwrap();
            let mut list = AllowList::default();
            approve(&mut list, &spec);
            let p = may_spawn(&spec, &list, None).unwrap();
            assert_eq!(p.files, vec![(0, sha256_hex(b"version one"))]);
            std::fs::write(&script, b"version two").unwrap();
            assert!(may_spawn(&spec, &list, None).unwrap_err().starts_with("changed since approval"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_bare_name_is_pinned_to_the_file_path_finds_and_a_relative_path_is_refused() {
        let d = dir();
        let first = dir();
        let prog = own_touch(&d, "my-mcp-srv");
        let path_var = format!("{}:{}", first.display(), d.display());
        let spec = s("my-mcp-srv", &["x"], None);
        let mut list = AllowList::default();
        list.add(&pin(&spec, Some(&path_var)).unwrap());
        assert_eq!(may_spawn(&spec, &list, Some(&path_var)).unwrap().program, prog);
        // Another program of that name earlier on PATH: another file, not approved.
        own_touch(&first, "my-mcp-srv");
        assert!(may_spawn(&spec, &list, Some(&path_var)).is_err());
        // Not on PATH, or a relative path with a folder: refused.
        assert!(may_spawn(&spec, &list, Some("/nonexistent")).unwrap_err().starts_with("not approved"));
        assert!(pin(&s("./my-mcp-srv", &[], None), None).unwrap_err().starts_with("not approved"));
        assert!(pin(&s("bin/my-mcp-srv", &[], None), None).unwrap_err().starts_with("not approved"));
        assert!(pin(&s(&prog, &[], Some("relative/dir")), None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_deny_list_still_stands_in_front() {
        // A shell is refused even with a valid pin in the list (defence in depth).
        let sh = ["/bin/sh", "/usr/bin/sh"].iter().find(|p| Path::new(p).exists()).unwrap();
        let spec = s(sh, &[], None);
        let mut list = AllowList::default();
        approve(&mut list, &spec);
        assert!(may_spawn(&spec, &list, None).unwrap_err().contains("shell"));
    }

    #[cfg(unix)]
    #[test]
    fn the_list_persists_old_approvals_do_not_count_and_revoke_ignores_hashes() {
        let d = dir();
        let prog = own_touch(&d, "srv");
        let spec = s(&prog, &["a"], None);
        // An approval in the old format (the command line only) is not honoured.
        let old = format!("[\"{prog}\",\"a\"]@null\n");
        let list = AllowList::parse(&old);
        assert!(list.is_empty());
        assert!(may_spawn(&spec, &list, None).unwrap_err().starts_with("not approved"));
        let mut list = AllowList::default();
        approve(&mut list, &spec);
        let back = AllowList::parse(&format!("{old}{}", list.serialize()));
        assert_eq!(back.len(), 1);
        assert!(may_spawn(&spec, &back, None).is_ok());
        // The program changes; revoke still withdraws the approval.
        std::fs::write(&prog, b"other bytes").unwrap();
        let mut back = back;
        assert!(back.revoke_key(&revoke_key_of(&spec, None)));
        assert!(back.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn the_dialog_names_the_full_path_and_the_hashes_in_hebrew_or_english() {
        let d = dir();
        let prog = own_touch(&d, "srv");
        let script = d.join("s.js");
        std::fs::write(&script, b"x").unwrap();
        let p = pin(&s(&prog, &[script.to_str().unwrap()], None), None).unwrap();
        let en = pin_text("Files", &p, false, Lang::En);
        assert!(en.contains(&format!("Program:\n  \"{prog}\"")), "{en}");
        assert!(en.contains(&p.program_sha256) && en.contains(&sha256_hex(b"x")));
        assert!(en.contains("One changed byte"));
        let he = pin_text("Files", &p, true, Lang::He);
        assert!(he.starts_with("התוכנה, או קובץ שהיא מקבלת, השתנו"), "{he}");
        assert!(he.contains("תוכנה:") && he.contains(&p.program_sha256), "{he}");
        assert_eq!(Lang::of(Some("he")), Lang::He);
        assert_eq!(Lang::of(Some("he-IL")), Lang::He);
        assert_eq!(Lang::of(Some("fr")), Lang::En);
        assert_eq!(Lang::of(None), Lang::En);
    }
}
