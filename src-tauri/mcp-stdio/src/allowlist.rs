//! The MCP stdio allow-list (plan W13.X1, review 8b R8b-M1): a server's program runs only when
//! the user approved **this exact program file, this exact argument list and this folder**.
//!
//! An approval pins:
//! - the program's **absolute, resolved path** (a bare name is looked up on `PATH` once, with
//!   `PATHEXT` on Windows; symlinks are followed, and the real file is what is pinned and started);
//! - the program file's **sha256**: one changed byte and the approval no longer matches;
//! - the **full argv**, in order, and the folder;
//! - the sha256 of **every argument that names an existing file**, and of the file in an
//!   `--option=file` argument (review 10, M4), so a script that changes needs a new approval too.
//!
//! Anything else is refused before a process is started (`may_spawn_in`, `checked_spawn`), with one
//! message for every refusal (review 10, M6): the allow-list is looked up first, by the resolved
//! path, argv and folder, and nothing is hashed unless that command was approved, so a page cannot
//! use these calls to read files or learn which paths exist. A file over `MAX_PINNED_BYTES` is not
//! hashed at all. The deny-list in `Spec::validate` (shells, launchers, `npx -y`, code on the
//! command line or from stdin, invisible characters) stays in front as defence in depth, checked
//! on the resolved file too (a link named `mytool` to a shell is a shell; review 10, M7), but it
//! is not the gate: an interpreter with an approved, pinned script runs; the same interpreter with
//! any other argv does not, whatever that argv is.
//!
//! Refused when pinning (review 10, M4): a folder given to an interpreter where its program goes
//! (`python pkg/`, `node dir`, `node --require=dir`: the folder's files would run, unpinned), and a
//! program, a file argument or a working folder inside a vault the user granted (the page can write
//! there; `vaults`).
//!
//! Old approvals (format 1: the command line only, no path or hash) are not honoured: the user
//! approves each command again once, and gets the pinned form.
//!
//! Limits (what an approval does not pin; the dialog says the first three):
//! - files the program loads by itself: modules a script imports, plugins, a folder argument's
//!   contents (a folder given to a compiled program is shown in the dialog as not pinned);
//! - code a package runner (`npx`, `uvx`, `pnpm dlx`, `bunx`, `deno run https://…`) downloads
//!   when it starts;
//! - a renamed copy of a shell or an interpreter: the deny-list reads names; the pin still holds;
//! - the window between hashing and starting (L1): the program and every pinned file are hashed
//!   just before the process starts and are opened again by path when it starts, so a file
//!   swapped in between is not caught. That needs write access to the pinned path (outside the
//!   vaults, which are refused). Executing the hashed file descriptor itself (`fexecve`) is not in
//!   std, breaks `#!` scripts and has no macOS form; it is owed if this window matters;
//! - hashing a large interpreter takes a moment on each start.

use crate::{quote, spawn, Event, Session, Spec};
#[cfg(test)]
use std::cell::Cell;
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

/// The largest file that is hashed (review 10, M6): a program or a file argument over it is
/// refused, not read.
pub const MAX_PINNED_BYTES: u64 = 256 * 1024 * 1024;

#[cfg(test)]
thread_local! {
    /// Bytes hashed on this thread (tests check that nothing is read before the list matches).
    static HASHED: Cell<u64> = const { Cell::new(0) };
}

/// The sha256 of a file's bytes, read in pieces; at most `MAX_PINNED_BYTES`.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    sha256_file_within(path, MAX_PINNED_BYTES)
}

/// `sha256_file` with the bound `max` (tests use a small one).
pub(crate) fn sha256_file_within(path: &Path, max: u64) -> Result<String, String> {
    let f = std::fs::File::open(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let len = f.metadata().map_err(|e| format!("cannot read {}: {e}", path.display()))?.len();
    let too_big = || format!("{} is larger than {} MB: it is not pinned", path.display(), max / (1024 * 1024));
    if len > max {
        return Err(too_big());
    }
    // A file that grows while it is read (or whose size the file system does not report) stops at the bound too.
    let mut f = f.take(max + 1);
    let mut s = Sha256::default();
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > max {
            return Err(too_big());
        }
        #[cfg(test)]
        HASHED.with(|h| h.set(h.get() + n as u64));
        s.update(&buf[..n]);
    }
    Ok(s.hex())
}

// ---------------------------------------------------------------- resolving and pinning

/// An absolute path on this system (review 10, L3: `C:/x` is a drive path only on Windows; on
/// Unix it is relative to the app's working folder).
fn is_absolute(p: &str) -> bool {
    is_absolute_for(p, cfg!(windows))
}

fn is_absolute_for(p: &str, windows: bool) -> bool {
    let b = p.as_bytes();
    if windows {
        (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) || p.starts_with("\\\\") || p.starts_with("//")
    } else {
        p.starts_with('/')
    }
}

/// The file names a bare command is looked up as (review 10, L5). Unix: the name. Windows: the
/// name if it has an extension, then the name with each `PATHEXT` extension in order (".COM;.EXE;
/// .BAT;.CMD" when PATHEXT is not set), as the Windows shell looks a command up.
fn candidate_names(command: &str, windows: bool, pathext: Option<&str>) -> Vec<String> {
    if !windows {
        return vec![command.to_string()];
    }
    let mut names = Vec::new();
    if command.contains('.') {
        names.push(command.to_string());
    }
    let lower = command.to_ascii_lowercase();
    for ext in pathext.unwrap_or(".COM;.EXE;.BAT;.CMD").split(';').map(str::trim).filter(|e| e.len() > 1 && e.starts_with('.') && !e[1..].contains(['.', '/', '\\']) && !e.contains(char::is_whitespace)) {
        if !lower.ends_with(&ext.to_ascii_lowercase()) {
            names.push(format!("{command}{ext}"));
        }
    }
    names
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
        let pathext = if cfg!(windows) { std::env::var("PATHEXT").ok() } else { None };
        let names = candidate_names(command, cfg!(windows), pathext.as_deref());
        let mut hit = None;
        'dirs: for dir in path_var.unwrap_or("").split(sep).filter(|d| !d.is_empty() && is_absolute(d)) {
            for n in &names {
                let p = Path::new(dir).join(n);
                if p.is_file() {
                    hit = Some(p);
                    break 'dirs;
                }
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
    /// Arguments that name an existing file (or hold one after `=`), by position, with the file's sha256.
    pub files: Vec<(usize, String)>,
    /// Arguments that name a folder the program is given as data: shown in the dialog, contents not pinned.
    pub folders: Vec<usize>,
    /// Whether the program downloads what it runs (a package runner): the dialog warns.
    pub fetches: bool,
}

/// The allow-list key of a program path, argv and folder (no hashes).
fn key_of(program: &str, args: &[String], cwd: Option<&str>) -> String {
    let mut out = String::from(FORMAT);
    out.push('[');
    out.push_str(&quote(program));
    out.push_str(&key_tail(args, cwd));
    out
}

/// The part of a key after the program: the arguments and the folder.
fn key_tail(args: &[String], cwd: Option<&str>) -> String {
    let mut out = String::new();
    for a in args {
        out.push(',');
        out.push_str(&quote(a));
    }
    out.push_str("]@");
    out.push_str(&cwd.map(quote).unwrap_or_else(|| "null".into()));
    out
}

impl Pin {
    /// What an approval is for, without the hashes (the same program, argv and folder).
    pub fn key(&self) -> String {
        key_of(&self.program, &self.args, self.cwd.as_deref())
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

/// Is `path` inside `root` (or `root` itself)? Component by component, ignoring case where the
/// file system usually does (macOS, Windows).
fn inside(path: &Path, root: &Path, ignore_case: bool) -> bool {
    if ignore_case {
        let low = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
        low(path).starts_with(low(root))
    } else {
        path.starts_with(root)
    }
}

/// The folders a page can write to, for `pin_in`'s `vaults` (review 11, L2): the granted vault
/// roots and the app's `backups` folder (`vault_backup` writes the page's bytes there), each made
/// canonical when it exists (a root given through a symlink still matches).
pub fn page_writable_roots(vault_roots: &[String], app_data_dir: Option<&Path>) -> Vec<String> {
    let canon = |p: PathBuf| std::fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned();
    let mut out: Vec<String> = vault_roots.iter().filter(|v| !v.is_empty()).map(|v| canon(PathBuf::from(v))).collect();
    if let Some(d) = app_data_dir {
        let base = std::fs::canonicalize(d).unwrap_or_else(|_| d.to_path_buf());
        out.push(canon(base.join("backups")));
    }
    out.dedup();
    out
}

/// The granted vault `path` is in, if any (`path` canonical when it exists).
fn in_vault<'a>(path: &Path, vaults: &'a [String]) -> Option<&'a str> {
    let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let ignore_case = cfg!(any(target_os = "macos", windows));
    vaults.iter().find(|v| !v.is_empty() && inside(&real, Path::new(v.as_str()), ignore_case)).map(String::as_str)
}

/// Where an interpreter takes its program (review 10, M4): the index of the first argument that is
/// not an option nor an option's value (after `deno run` / `bun run`), of python's `-mmod`, or of
/// the module after `-m` (review 11, M1: per family, `-W ignore`, `-X dev`, `-r pre.js` take the
/// next argument as their value). A folder at or before it would be run (`python pkg/`,
/// `node dir`, `node -r dir`, `python -W ignore dir`); after it a folder is the script's data.
/// `args.len()` when there is no program argument.
pub(crate) fn program_position(family: &str, args: &[String]) -> usize {
    let mut skip_subcommand = matches!(family, "deno" | "bun");
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with('-') && a != "-" {
            match crate::next_arg(family, a) {
                crate::NextArg::Free => i += 1,
                crate::NextArg::Value => i += 2,
                crate::NextArg::Program => return i + 1,
                crate::NextArg::ProgramHere => return i,
            }
            continue;
        }
        if skip_subcommand && matches!(a.as_str(), "run" | "serve" | "test" | "x") {
            skip_subcommand = false;
            i += 1;
            continue;
        }
        return i;
    }
    args.len()
}

/// Resolve and hash `spec` as it stands now (the program file and every file an argument names),
/// refusing a program, file or folder in one of `vaults` and a folder where an interpreter's
/// program goes. The detailed reasons are for the user's own approval; a refusal to start uses
/// `NOT_APPROVED` until the list matched.
pub fn pin_in(spec: &Spec, path_var: Option<&str>, vaults: &[String]) -> Result<Pin, String> {
    let program = resolve_program(&spec.command, path_var)?;
    pin_resolved(&program, spec, vaults)
}

/// `pin_in` with no vault to keep out of.
pub fn pin(spec: &Spec, path_var: Option<&str>) -> Result<Pin, String> {
    pin_in(spec, path_var, &[])
}

/// The deny-list on the file that would run (a link named `mytool` to /bin/sh is a shell).
fn validate_resolved(program: &Path, spec: &Spec) -> Result<(), String> {
    Spec { command: program.to_string_lossy().into_owned(), args: spec.args.clone(), cwd: spec.cwd.clone() }.validate().map_err(|e| format!("{e} (the program {} is what runs)", program.display()))
}

fn pin_resolved(program: &Path, spec: &Spec, vaults: &[String]) -> Result<Pin, String> {
    validate_resolved(program, spec)?;
    if let Some(cwd) = &spec.cwd {
        if !is_absolute(cwd) {
            return Err("not approved: the folder must be a full path".into());
        }
        if let Some(v) = in_vault(Path::new(cwd), vaults) {
            return Err(format!("not approved: the folder {cwd} is inside the vault {v}; a page can write there"));
        }
    }
    if let Some(v) = in_vault(program, vaults) {
        return Err(format!("not approved: the program {} is inside the vault {v}; a page can write there", program.display()));
    }
    let program_sha256 = sha256_file(program)?;
    let base: Option<PathBuf> = match &spec.cwd {
        Some(c) => Some(PathBuf::from(c)),
        None => std::env::current_dir().ok(),
    };
    let name = crate::base_name(&program.to_string_lossy());
    let family = crate::interpreter(&name);
    let runs_at = family.map(|f| program_position(f, &spec.args));
    let mut files = Vec::new();
    let mut folders = Vec::new();
    for (i, a) in spec.args.iter().enumerate() {
        // An option's value after `=` (`--require=preload.js`, `--config=x.toml`); deno's
        // permission lists (`--allow-read=dir`) are data.
        let value = if a.starts_with('-') {
            match a.split_once('=') {
                Some((opt, v)) if !(family == Some("deno") && (opt.starts_with("--allow-") || opt.starts_with("--deny-"))) => v,
                _ => continue,
            }
        } else {
            a.as_str()
        };
        if value.is_empty() {
            continue;
        }
        let Some(p) = (if is_absolute(value) { Some(PathBuf::from(value)) } else { base.as_ref().map(|b| b.join(value)) }) else { continue };
        if p.is_dir() {
            if runs_at.is_some_and(|at| i <= at) {
                return Err(format!("not approved: argument {} is a folder where {name} takes its program; the files in it would run unpinned. Name the script file", i + 1));
            }
            folders.push(i);
        } else if p.is_file() {
            if let Some(v) = in_vault(&p, vaults) {
                return Err(format!("not approved: argument {} names a file inside the vault {v}; a page can write there", i + 1));
            }
            files.push((i, sha256_file(&p)?));
        }
    }
    Ok(Pin {
        program: program.to_string_lossy().into_owned(),
        program_sha256,
        args: spec.args.clone(),
        cwd: spec.cwd.clone(),
        files,
        folders,
        fetches: crate::package_runner(spec) || crate::package_runner(&Spec { command: program.to_string_lossy().into_owned(), args: spec.args.clone(), cwd: None }),
    })
}

/// The one answer to a command that may not start before the list matched (review 10, M6): it
/// says nothing about which paths exist or what they hold.
pub const NOT_APPROVED: &str = "not approved: Lumen runs a server's command only after you approve that exact program, its arguments and its folder";

/// The pin a native approval dialog shows, for `mcp_stdio_approve`: the deny-list's reasons (they
/// read only the strings the page sent) as they are; anything that looked at files is one message.
pub fn approval_pin(spec: &Spec, path_var: Option<&str>, vaults: &[String]) -> Result<Pin, String> {
    spec.validate()?;
    pin_in(spec, path_var, vaults).map_err(|_| {
        "cannot approve: Lumen pins only an existing program file (a full path, or a name on the PATH servers get), with every file it is given under 256 MB, no folder where an interpreter takes its program, and nothing inside a vault".to_string()
    })
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
    /// Is any approval of this program, argv and folder on the list (whatever its hashes)?
    pub fn has_key(&self, key: &str) -> bool {
        let k = format!("{key} ");
        self.lines.iter().any(|x| x.starts_with(&k))
    }
    /// Withdraw every approval of this program, argv and folder, whatever the hashes.
    pub fn revoke_key(&mut self, key: &str) -> bool {
        let k = format!("{key} ");
        let before = self.lines.len();
        self.lines.retain(|x| !x.starts_with(&k));
        before != self.lines.len()
    }
    /// Withdraw the approvals of `spec` (review 10, L4): of this argv and folder with the program
    /// as given, as it resolves now, or, for a bare name, any pinned program of that file name (the
    /// file may have moved since, so that its path now resolves elsewhere or nowhere).
    pub fn revoke(&mut self, spec: &Spec, path_var: Option<&str>) -> bool {
        let tail = format!("{} ", key_tail(&spec.args, spec.cwd.as_deref()));
        let now = resolve_program(&spec.command, path_var).ok().map(|p| p.to_string_lossy().into_owned());
        let bare = !spec.command.contains(['/', '\\']);
        let wanted = |program: &str| {
            program == spec.command
                || now.as_deref() == Some(program)
                || (bare && Path::new(program).file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    n == spec.command.as_str() || (cfg!(windows) && n.to_ascii_lowercase().strip_prefix(&spec.command.to_ascii_lowercase()).is_some_and(|ext| ext.starts_with('.') && !ext[1..].contains('.')))
                }))
        };
        let before = self.lines.len();
        self.lines.retain(|line| match split_program(line) {
            Some((program, rest)) => !(rest.starts_with(&tail) && wanted(&program)),
            None => true,
        });
        before != self.lines.len()
    }
    pub fn len(&self) -> usize {
        self.lines.len()
    }
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

/// A pinned line's program (unquoted) and what follows its closing quote.
fn split_program(line: &str) -> Option<(String, &str)> {
    let body = line.strip_prefix(FORMAT)?.strip_prefix("[\"")?;
    let mut out = String::new();
    let mut chars = body.char_indices();
    while let Some((i, c)) = chars.next() {
        match c {
            '"' => return Some((out, &body[i + 1..])),
            '\\' => match chars.next()?.1 {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                'u' => {
                    let hex: String = (0..4).filter_map(|_| chars.next().map(|(_, h)| h)).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
                }
                other => out.push(other),
            },
            c => out.push(c),
        }
    }
    None
}

/// May `spec` start now? The deny-list (on the strings the page sent), then the allow-list,
/// looked up by the resolved program, argv and folder **before anything is hashed** (review 10,
/// M6), then the deny-list on the resolved file and the exact pin (hashes, vaults, folders).
/// Until the list matched, every refusal is `NOT_APPROVED`. Returns the pin, whose `spec()` is
/// what to start (the resolved program, not a name looked up again).
pub fn may_spawn_in(spec: &Spec, allow: &AllowList, path_var: Option<&str>, vaults: &[String]) -> Result<Pin, String> {
    spec.validate()?;
    let program = resolve_program(&spec.command, path_var).map_err(|_| NOT_APPROVED.to_string())?;
    if spec.cwd.as_deref().is_some_and(|c| !is_absolute(c)) || !allow.has_key(&key_of(&program.to_string_lossy(), &spec.args, spec.cwd.as_deref())) {
        return Err(NOT_APPROVED.into());
    }
    let p = pin_resolved(&program, spec, vaults)?;
    if allow.allows(&p) {
        return Ok(p);
    }
    Err("changed since approval: the program or a file it is given is not the one you approved; approve it again".into())
}

/// `may_spawn_in` with no vault to keep out of.
pub fn may_spawn(spec: &Spec, allow: &AllowList, path_var: Option<&str>) -> Result<Pin, String> {
    may_spawn_in(spec, allow, path_var, &[])
}

/// The only way the glue starts a server: refused before any process exists unless `may_spawn_in`
/// says yes; started from the resolved, pinned path.
pub fn checked_spawn(spec: &Spec, allow: &AllowList, path_var: Option<&str>, vaults: &[String], env: Vec<(String, String)>, on_event: impl Fn(Event) + Send + Sync + 'static) -> Result<Session, String> {
    let p = may_spawn_in(spec, allow, path_var, vaults)?;
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
    if p.fetches {
        t.push_str(match lang {
            Lang::He => "אזהרה: התוכנה הזאת מורידה חבילה (או כתובת) ומריצה אותה. הקוד שהיא מורידה בכל הפעלה אינו חלק מהאישור ויכול להשתנות בלי ששום דבר כאן ישתנה. עדיף להתקין את השרת ולתת את הנתיב לתוכנה שלו.\n\n",
            Lang::En => "Warning: this program downloads a package (or a URL) and runs it. The code it downloads on each start is not part of this approval and can change without anything here changing. Prefer installing the server and giving its own program's path.\n\n",
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
    for i in &p.folders {
        t.push_str(&match lang {
            Lang::He => format!("\n  ארגומנט {} (תיקייה): התוכן שלה אינו נעול", i + 1),
            Lang::En => format!("\n  argument {} (a folder): its contents are not pinned", i + 1),
        });
    }
    t.push_str(match lang {
        Lang::He => "\n\nשינוי של בייט אחד בתוכנה או בקבצים האלה, או ארגומנט אחר, ידרוש אישור חדש. קבצים שהתוכנה טוענת בעצמה (מודולים שסקריפט מייבא, תוספים, תוכן של תיקייה) אינם נעולים.",
        Lang::En => "\n\nOne changed byte in the program or in these files, or any other argument, needs a new approval. Files the program loads by itself (modules a script imports, plugins, a folder's contents) are not pinned.",
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
        let e = checked_spawn(&spec, &list, None, &[], vec![], |_| {}).err().expect("refused");
        assert!(e.starts_with("not approved"), "{e}");
        std::thread::sleep(Duration::from_millis(200));
        assert!(!Path::new(&marker).exists(), "refused before spawn: no process ran");
        approve(&mut list, &spec);
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = Mutex::new(tx);
        let sess = checked_spawn(&spec, &list, None, &[], vec![], move |e| {
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
        assert!(checked_spawn(&spec, &list, None, &[], vec![], |_| {}).is_err());
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
        // pin() refuses it too now (the deny-list on the resolved file); a line put on the list by
        // hand still does not start it.
        assert!(pin(&spec, None).unwrap_err().contains("shell"));
        let real = std::fs::canonicalize(sh).unwrap();
        let hand = Pin { program: real.to_string_lossy().into_owned(), program_sha256: sha256_file(&real).unwrap(), args: vec![], cwd: None, files: vec![], folders: vec![], fetches: false };
        let mut list = AllowList::default();
        list.add(&hand);
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
        assert!(back.revoke(&spec, None));
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

/// Review 10 (M4, M6, M7, L2–L5): each test fails on the code before that review.
#[cfg(test)]
mod review10 {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    static N: AtomicUsize = AtomicUsize::new(0);

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumen-allow10-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(d).unwrap()
    }

    fn s(cmd: &str, args: &[&str], cwd: Option<&str>) -> Spec {
        Spec { command: cmd.into(), args: args.iter().map(|a| a.to_string()).collect(), cwd: cwd.map(String::from) }
    }

    /// A program of our own (a copy of `touch`) under `name`.
    #[cfg(unix)]
    fn own(d: &Path, name: &str) -> String {
        let src = ["/usr/bin/touch", "/bin/touch"].iter().find(|p| Path::new(p).is_file()).expect("touch");
        let dst = d.join(name);
        std::fs::copy(src, &dst).unwrap();
        dst.to_string_lossy().into_owned()
    }

    fn hashed() -> u64 {
        HASHED.with(|h| h.get())
    }

    #[cfg(unix)]
    #[test]
    fn m6_nothing_is_hashed_and_one_message_until_the_list_matches() {
        let d = dir();
        let prog = own(&d, "srv");
        let script = d.join("s.js");
        std::fs::write(&script, b"x").unwrap();
        let empty = AllowList::default();
        let before = hashed();
        let refusals: Vec<String> = [
            s(&prog, &[script.to_str().unwrap()], None),
            s(&prog, &[], None),
            s(&d.join("missing").to_string_lossy(), &[], None),
            s(d.to_str().unwrap(), &[], None),
            s("no-such-program-anywhere", &[], None),
            s(&prog, &[], Some("relative/dir")),
        ]
        .iter()
        .map(|spec| may_spawn(spec, &empty, None).unwrap_err())
        .collect();
        assert_eq!(hashed(), before, "nothing read before the list matched");
        for r in &refusals {
            assert_eq!(r, NOT_APPROVED);
        }
        // Approved: hashed now, and a change is reported as one.
        let spec = s(&prog, &[script.to_str().unwrap()], None);
        let mut list = AllowList::default();
        list.add(&pin(&spec, None).unwrap());
        assert!(may_spawn(&spec, &list, None).is_ok());
        assert!(hashed() > before);
        std::fs::write(&script, b"y").unwrap();
        assert!(may_spawn(&spec, &list, None).unwrap_err().starts_with("changed since approval"));
    }

    #[cfg(unix)]
    #[test]
    fn m6_a_file_over_the_bound_is_refused_not_read() {
        let d = dir();
        let big = d.join("big.bin");
        std::fs::File::create(&big).unwrap().set_len(MAX_PINNED_BYTES + 1).unwrap();
        let before = hashed();
        assert!(sha256_file(&big).unwrap_err().contains("larger than"));
        let prog = own(&d, "srv");
        assert!(pin(&s(&prog, &[big.to_str().unwrap()], None), None).unwrap_err().contains("larger than"));
        assert_eq!(hashed() - before, std::fs::metadata(&prog).unwrap().len(), "only the program was read");
        // The approval dialog's own refusal says nothing about which file.
        let e = approval_pin(&s(&prog, &[big.to_str().unwrap()], None), None, &[]).unwrap_err();
        assert!(e.starts_with("cannot approve") && !e.contains("big.bin"), "{e}");
    }

    #[cfg(unix)]
    #[test]
    fn m7_the_deny_list_reads_the_resolved_file() {
        let d = dir();
        let sh = ["/bin/sh", "/usr/bin/sh"].iter().find(|p| Path::new(p).exists()).unwrap();
        let link = d.join("mytool");
        std::os::unix::fs::symlink(sh, &link).unwrap();
        let spec = s(link.to_str().unwrap(), &[], None);
        assert!(spec.validate().is_ok(), "the name alone passes");
        assert!(pin(&spec, None).unwrap_err().contains("shell"));
        assert!(approval_pin(&spec, None, &[]).is_err());
        // Even a line put on the list by hand does not start it.
        let real = std::fs::canonicalize(sh).unwrap();
        let mut list = AllowList::default();
        list.add(&Pin { program: real.to_string_lossy().into_owned(), program_sha256: sha256_file(&real).unwrap(), args: vec![], cwd: None, files: vec![], folders: vec![], fetches: false });
        assert!(may_spawn(&spec, &list, None).unwrap_err().contains("shell"));
        // An interpreter under another name keeps its inline-code check.
        if let Some(py) = ["/usr/bin/python3", "/usr/local/bin/python3"].iter().find(|p| Path::new(p).exists()) {
            let alias = d.join("srv");
            std::os::unix::fs::symlink(py, &alias).unwrap();
            assert!(pin(&s(alias.to_str().unwrap(), &["-c", "x"], None), None).unwrap_err().contains("code written in the command line"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn m4_an_option_attached_file_is_pinned() {
        let d = dir();
        let prog = own(&d, "srv");
        let pre = d.join("preload.js");
        std::fs::write(&pre, b"v1").unwrap();
        let a = format!("--require={}", pre.display());
        let spec = s(&prog, &[&a, "--port=3000"], Some(d.to_str().unwrap()));
        let p = pin(&spec, None).unwrap();
        assert_eq!(p.files, vec![(0, sha256_hex(b"v1"))]);
        let mut list = AllowList::default();
        list.add(&p);
        std::fs::write(&pre, b"v2").unwrap();
        assert!(may_spawn(&spec, &list, None).unwrap_err().starts_with("changed since approval"));
        // Relative to the folder too.
        std::fs::write(d.join("c.toml"), b"k=1").unwrap();
        assert_eq!(pin(&s(&prog, &["--config=c.toml"], Some(d.to_str().unwrap())), None).unwrap().files, vec![(0, sha256_hex(b"k=1"))]);
    }

    #[cfg(unix)]
    #[test]
    fn m4_a_folder_where_an_interpreter_takes_its_program_is_refused() {
        let d = dir();
        let pkg = d.join("pkg");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("__main__.py"), b"v1").unwrap();
        let py = own(&d, "python3");
        let node = own(&d, "node");
        let deno = own(&d, "deno");
        let p = pkg.to_str().unwrap();
        let req = format!("--require={p}");
        for (prog, args) in [(&py, vec![p]), (&py, vec!["-u", p]), (&node, vec![p]), (&node, vec![req.as_str(), "s.js"]), (&deno, vec!["run", p])] {
            let e = pin(&s(prog, &args, Some(d.to_str().unwrap())), None).unwrap_err();
            assert!(e.contains("is a folder where"), "{prog} {args:?}: {e}");
        }
        // After the script (or python -m), a folder is the script's data; a compiled program's
        // folder argument too. The dialog names it as not pinned.
        std::fs::write(d.join("s.js"), b"x").unwrap();
        let after = pin(&s(&node, &["s.js", p], Some(d.to_str().unwrap())), None).unwrap();
        assert_eq!(after.folders, vec![1]);
        assert!(pin(&s(&py, &["-m", "srv", p], None), None).is_ok());
        assert!(pin(&s(&deno, &["run", &format!("--allow-read={p}"), "s.js"], Some(d.to_str().unwrap())), None).is_ok());
        let compiled = own(&d, "mcp-server-files");
        let data = pin(&s(&compiled, &[p], None), None).unwrap();
        assert_eq!(data.folders, vec![0]);
        assert!(pin_text("x", &data, false, Lang::En).contains("argument 1 (a folder): its contents are not pinned"));
        assert!(pin_text("x", &data, false, Lang::He).contains("ארגומנט 1 (תיקייה)"));
    }

    #[cfg(unix)]
    #[test]
    fn m4_a_program_file_or_folder_inside_a_vault_is_refused() {
        let vault = dir();
        let outside = dir();
        let vaults = vec![vault.to_string_lossy().into_owned()];
        let inside_prog = own(&vault, "srv");
        let prog = own(&outside, "srv");
        let script = vault.join("s.js");
        std::fs::write(&script, b"x").unwrap();
        assert!(pin_in(&s(&inside_prog, &[], None), None, &vaults).unwrap_err().contains("inside the vault"));
        assert!(pin_in(&s(&prog, &[script.to_str().unwrap()], None), None, &vaults).unwrap_err().contains("inside the vault"));
        assert!(pin_in(&s(&prog, &[], Some(vault.to_str().unwrap())), None, &vaults).unwrap_err().contains("inside the vault"));
        let sub = vault.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(pin_in(&s(&prog, &[], Some(sub.to_str().unwrap())), None, &vaults).is_err());
        // A vault folder given as data (a files server) is allowed; outside the vaults all is as before.
        assert!(pin_in(&s(&prog, &[vault.to_str().unwrap()], None), None, &vaults).is_ok());
        assert!(pin_in(&s(&prog, &[], Some(outside.to_str().unwrap())), None, &vaults).is_ok());
        // A vault granted after the approval: the start is refused too.
        let spec = s(&prog, &[script.to_str().unwrap()], None);
        let mut list = AllowList::default();
        list.add(&pin(&spec, None).unwrap());
        assert!(may_spawn(&spec, &list, None).is_ok());
        assert!(may_spawn_in(&spec, &list, None, &vaults).unwrap_err().contains("inside the vault"));
        // A sibling folder whose name starts like the vault's is not inside it.
        assert!(!inside(Path::new("/a/vault2/x"), Path::new("/a/vault"), false));
        assert!(inside(Path::new("/A/Vault/x"), Path::new("/a/vault"), true));
    }

    #[test]
    fn m4_the_dialog_warns_about_package_runners() {
        for (cmd, args) in [("npx", &["@scope/server"][..]), ("/usr/local/bin/uvx", &["mcp-server-git"]), ("pnpm", &["dlx", "x"]), ("bunx", &["x"]), ("deno", &["run", "https://example.invalid/s.ts"]), ("npm", &["exec", "x"]), ("pipx", &["run", "x"]), ("yarn", &["dlx", "x"]), ("npx.cmd", &["x"])] {
            assert!(crate::package_runner(&s(cmd, args, None)), "{cmd} {args:?}");
        }
        for (cmd, args) in [("node", &["s.js"][..]), ("deno", &["run", "s.ts"]), ("pnpm", &["install"]), ("uv", &["--version"])] {
            assert!(!crate::package_runner(&s(cmd, args, None)), "{cmd} {args:?}");
        }
        let p = Pin { program: "/usr/bin/npx".into(), program_sha256: "0".into(), args: vec!["x".into()], cwd: None, files: vec![], folders: vec![], fetches: true };
        assert!(pin_text("x", &p, false, Lang::En).starts_with("Warning: this program downloads a package"));
        assert!(pin_text("x", &p, false, Lang::He).starts_with("אזהרה: התוכנה הזאת מורידה חבילה"));
        let plain = Pin { fetches: false, ..p };
        assert!(!pin_text("x", &plain, false, Lang::En).contains("downloads a package"));
        assert!(pin_text("x", &plain, false, Lang::En).contains("are not pinned"));
    }

    #[cfg(unix)]
    #[test]
    fn m4_a_package_runner_found_by_its_pin_is_flagged() {
        let d = dir();
        let npx = own(&d, "npx");
        assert!(pin(&s(&npx, &["@scope/server"], None), None).unwrap().fetches);
        let link = d.join("runner");
        std::os::unix::fs::symlink(&npx, &link).unwrap();
        assert!(pin(&s(link.to_str().unwrap(), &["x"], None), None).unwrap().fetches, "the resolved name counts too");
    }

    #[cfg(unix)]
    #[test]
    fn l2_the_resolved_path_is_what_starts() {
        // The name is found only on the PATH given to the check, not on this process's PATH:
        // starting the spec as typed would not find it.
        let d = dir();
        let prog = own(&d, "lumen-l2-only-here");
        let marker = d.join("ran");
        let path_var = d.to_string_lossy().into_owned();
        let spec = s("lumen-l2-only-here", &[marker.to_str().unwrap()], None);
        let mut list = AllowList::default();
        list.add(&pin(&spec, Some(&path_var)).unwrap());
        assert_eq!(may_spawn(&spec, &list, Some(&path_var)).unwrap().program, prog);
        let sess = checked_spawn(&spec, &list, Some(&path_var), &[], vec![], |_| {}).expect("starts the resolved file");
        for _ in 0..50 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        sess.close(Duration::from_secs(1));
        assert!(marker.exists());
    }

    #[test]
    fn l3_a_drive_letter_is_absolute_only_on_windows() {
        assert!(!is_absolute_for("C:/vault", false));
        assert!(!is_absolute_for("C:\\vault", false));
        assert!(is_absolute_for("/vault", false));
        assert!(is_absolute_for("C:/vault", true));
        assert!(is_absolute_for("c:\\vault", true));
        assert!(is_absolute_for("\\\\server\\share", true));
        assert!(!is_absolute_for("C:vault", true));
        assert!(!is_absolute_for("vault", true));
        #[cfg(unix)]
        assert!(pin(&s("/usr/bin/touch", &[], Some("C:/anything")), None).unwrap_err().contains("full path"));
    }

    #[cfg(unix)]
    #[test]
    fn l4_revoke_finds_a_program_that_moved() {
        let d = dir();
        let prog = own(&d, "srv");
        let spec = s(&prog, &["a"], None);
        let mut list = AllowList::default();
        list.add(&pin(&spec, None).unwrap());
        let moved = d.join("moved");
        std::fs::rename(&prog, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &prog).unwrap();
        assert!(list.revoke(&spec, None));
        assert!(list.is_empty());
        // A bare name whose file is gone: its pinned line goes too; other argv stay.
        let bin = dir();
        let p2 = own(&bin, "my-mcp");
        let path_var = bin.to_string_lossy().into_owned();
        let bare = s("my-mcp", &["x"], None);
        list.add(&pin(&bare, Some(&path_var)).unwrap());
        list.add(&pin(&s("my-mcp", &["y"], None), Some(&path_var)).unwrap());
        std::fs::remove_file(&p2).unwrap();
        assert!(list.revoke(&bare, Some(&path_var)));
        assert_eq!(list.len(), 1);
        assert!(!list.revoke(&bare, Some(&path_var)), "nothing left to withdraw");
    }

    #[test]
    fn l5_windows_looks_a_name_up_with_pathext() {
        assert_eq!(candidate_names("srv", false, Some(".EXE")), vec!["srv"]);
        assert_eq!(candidate_names("npx", true, None), vec!["npx.COM", "npx.EXE", "npx.BAT", "npx.CMD"]);
        assert_eq!(candidate_names("npx", true, Some(".EXE;.CMD")), vec!["npx.EXE", "npx.CMD"]);
        assert_eq!(candidate_names("srv.exe", true, Some(".EXE;.CMD")), vec!["srv.exe", "srv.exe.CMD"]);
        assert_eq!(candidate_names("my.server", true, Some(".EXE")), vec!["my.server", "my.server.EXE"]);
        // Odd PATHEXT entries are skipped.
        assert_eq!(candidate_names("x", true, Some(";EXE;.;.a/b;. EXE ;.PY")), vec!["x.PY"]);
    }

    #[test]
    fn split_program_reads_a_pinned_line() {
        let k = key_of("/a \"b\"\\c", &["x".into()], None);
        let line = format!("{k} sha256=0");
        let (prog, rest) = split_program(&line).unwrap();
        assert_eq!(prog, "/a \"b\"\\c");
        assert!(rest.starts_with(",\"x\"]@null "));
        assert!(split_program("pin2 [\"unterminated").is_none());
    }
}
