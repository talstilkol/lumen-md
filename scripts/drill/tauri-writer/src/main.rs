//! Saves notes with the desktop app's own `Vault::write` (src-tauri/vault),
//! one request per message on stdin: a line `<vault path>\t<byte count>`,
//! then the bytes. Answers `ok` or `err <code> <message>` on stdout. The
//! drill kills this process with SIGKILL in the middle of a save.
use std::io::{self, BufRead, Read, Write};

fn main() {
    let root = std::env::args().nth(1).expect("usage: lumen-drill-tauri-writer <vault folder>");
    let vault = lumen_vault::Vault::open(&root).expect("open the vault");
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut out = io::stdout().lock();
    writeln!(out, "ready").unwrap();
    out.flush().unwrap();
    let mut line = String::new();
    loop {
        line.clear();
        if input.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let (path, len) = line.trim_end().split_once('\t').expect("<path>\\t<len>");
        let mut data = vec![0u8; len.parse().expect("a byte count")];
        input.read_exact(&mut data).expect("the bytes");
        match vault.write(path, &data) {
            Ok(()) => writeln!(out, "ok").unwrap(),
            Err(e) => writeln!(out, "err {}", e.to_string().replace('\n', " ")).unwrap(),
        }
        out.flush().unwrap();
    }
}
