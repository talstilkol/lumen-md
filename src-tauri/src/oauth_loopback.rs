//! The loopback redirect of a remote MCP server's OAuth sign-in on the desktop (plan W13.A1, review 14
//! Low 1; RFC 8252 §7.3). The system browser is sent to the authorization server; the server redirects it
//! to http://127.0.0.1:47613/oauth/callback?code=…&state=…&iss=…, and this listener takes that one request.
//!
//! - It binds 127.0.0.1 only (never 0.0.0.0, never `localhost`, which can resolve elsewhere).
//! - It answers `GET /oauth/callback` only, with a Host of 127.0.0.1:<port> (a page that rebinds a name
//!   to 127.0.0.1 sends its own Host and is refused).
//! - It hands back the query only when its `state` is the one the sign-in started with (compared in
//!   constant time); anything else gets a 400 and the listener keeps waiting, until the deadline.
//! - It reads at most 8 KiB of a request and never follows or fetches anything.
//!
//! The code is not redeemed here: the query goes to the web view, which checks `iss` and `state` again
//! (src/agents/mcp/oauth.ts) before the token request. The Tauri command that runs `wait_for_callback`
//! is owed with the UI: a new command needs the isolation app's allow-list (src-tauri/isolation/index.js),
//! reviewed by its owner.
//!
//! std only, so `rustc --test` checks it without the Tauri crates.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// The port in public/oauth/client-metadata.json's loopback redirect URI.
pub const LOOPBACK_PORT: u16 = 47613;
pub const CALLBACK_PATH: &str = "/oauth/callback";
const MAX_REQUEST: usize = 8 * 1024;

/// Bind the loopback address only.
pub fn bind(port: u16) -> std::io::Result<TcpListener> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

/// The query of a `GET /oauth/callback?… HTTP/1.x` request whose Host is 127.0.0.1:`port`, or why not.
pub fn callback_query(raw: &[u8], port: u16) -> Result<String, String> {
    let end = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("an incomplete request")?;
    let head = std::str::from_utf8(&raw[..end]).map_err(|_| "a request that is not UTF-8")?;
    let mut lines = head.split("\r\n");
    let line = lines.next().unwrap_or("");
    let mut parts = line.split(' ');
    let (method, target, proto) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if parts.next().is_some() || !proto.starts_with("HTTP/1.") {
        return Err("not an HTTP/1 request line".into());
    }
    if method != "GET" {
        return Err(format!("{method} is not allowed"));
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Err(format!("{path} is not the callback"));
    }
    let want = format!("127.0.0.1:{port}");
    let mut host = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("host") {
                if host.is_some() {
                    return Err("two Host headers".into());
                }
                host = Some(v.trim().to_string());
            }
        }
    }
    if host.as_deref() != Some(want.as_str()) {
        return Err(format!("the Host is not {want}"));
    }
    if query.is_empty() || !query.bytes().all(|b| (0x21..0x7f).contains(&b)) {
        return Err("no query, or one with spaces or control characters".into());
    }
    Ok(query.to_string())
}

/// The value of `name` in a query (percent-decoding is left to the web view: `state` is base64url).
pub fn param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| v))
}

/// Constant-time equality of two byte strings of the same length.
pub fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

const DONE: &str = "<!doctype html><meta charset=utf-8><title>Lumen</title><p>Signed in. You can close this tab and go back to Lumen.</p><p dir=rtl lang=he>ההתחברות הושלמה. אפשר לסגור את הלשונית ולחזור ל-Lumen.</p>";

fn answer(stream: &mut TcpStream, status: &str, body: &str) {
    let msg = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
    // A browser that went away is not an error of the sign-in.
    let _ = stream.write_all(msg.as_bytes());
}

fn read_request(stream: &mut TcpStream) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while buf.len() < MAX_REQUEST && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n.min(MAX_REQUEST - buf.len())]),
        }
    }
    buf
}

/// Wait for the redirect that carries `state`, until `timeout`; returns its query. One listener, one sign-in.
pub fn wait_for_callback(listener: &TcpListener, state: &str, timeout: Duration) -> Result<String, String> {
    if state.len() < 16 {
        return Err("a state that short is guessable".into());
    }
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let deadline = Instant::now() + timeout;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let raw = read_request(&mut stream);
                match callback_query(&raw, port) {
                    Ok(q) if param(&q, "state").is_some_and(|s| same(s, state)) => {
                        answer(&mut stream, "200 OK", DONE);
                        return Ok(q);
                    }
                    _ => answer(&mut stream, "400 Bad Request", "<!doctype html><title>Lumen</title><p>Not this sign-in.</p>"),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("the sign-in did not come back in time".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ST: &str = "abcdefghijklmnopqrstuvwxyz012345";
    fn req(line: &str, host: &str) -> Vec<u8> {
        format!("{line}\r\nHost: {host}\r\nUser-Agent: t\r\n\r\n").into_bytes()
    }

    #[test]
    fn takes_only_the_callback_on_the_loopback_host() {
        let ok = req(&format!("GET /oauth/callback?code=c1&state={ST}&iss=https%3A%2F%2Fas.example HTTP/1.1"), "127.0.0.1:47613");
        assert_eq!(callback_query(&ok, 47613).unwrap(), format!("code=c1&state={ST}&iss=https%3A%2F%2Fas.example"));
        for (line, host) in [
            ("POST /oauth/callback?code=c HTTP/1.1", "127.0.0.1:47613"),
            ("GET /oauth/callbackx?code=c HTTP/1.1", "127.0.0.1:47613"),
            ("GET /?code=c HTTP/1.1", "127.0.0.1:47613"),
            ("GET /oauth/callback?code=c HTTP/1.1", "localhost:47613"),
            ("GET /oauth/callback?code=c HTTP/1.1", "evil.example:47613"),
            ("GET /oauth/callback?code=c HTTP/1.1", "127.0.0.1:1"),
            ("GET /oauth/callback HTTP/1.1", "127.0.0.1:47613"),
            ("GET /oauth/callback?code=c HTTP/2", "127.0.0.1:47613"),
            ("GET /oauth/callback?code=c x HTTP/1.1", "127.0.0.1:47613"),
        ] {
            assert!(callback_query(&req(line, host), 47613).is_err(), "{line} / {host}");
        }
        let two = b"GET /oauth/callback?code=c HTTP/1.1\r\nHost: 127.0.0.1:47613\r\nHost: evil.example\r\n\r\n";
        assert!(callback_query(two, 47613).is_err());
        assert!(callback_query(b"GET /oauth/callback?code=c HTTP/1.1\r\nHost: 127.0.0.1:47613\r\n", 47613).is_err());
    }

    #[test]
    fn params_and_constant_time_compare() {
        assert_eq!(param("code=a&state=b", "state"), Some("b"));
        assert_eq!(param("xstate=b", "state"), None);
        assert!(same(ST, ST) && !same(ST, "abcdefghijklmnopqrstuvwxyz012346") && !same(ST, "short"));
    }

    #[test]
    fn binds_loopback_and_waits_for_its_own_state() {
        let l = bind(0).unwrap();
        assert!(l.local_addr().unwrap().ip().is_loopback());
        let port = l.local_addr().unwrap().port();
        let client = std::thread::spawn(move || {
            let send = |q: &str| {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(format!("GET /oauth/callback?{q} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).unwrap();
                let mut out = String::new();
                let _ = s.read_to_string(&mut out);
                out
            };
            let wrong = send("code=x&state=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
            let right = send(&format!("code=c2&state={ST}"));
            (wrong, right)
        });
        let q = wait_for_callback(&l, ST, Duration::from_secs(10)).unwrap();
        let (wrong, right) = client.join().unwrap();
        assert!(wrong.starts_with("HTTP/1.1 400"));
        assert!(right.starts_with("HTTP/1.1 200") && right.contains("no-store"));
        assert_eq!(q, format!("code=c2&state={ST}"));
    }

    #[test]
    fn times_out_and_refuses_a_short_state() {
        let l = bind(0).unwrap();
        assert!(wait_for_callback(&l, "short", Duration::from_millis(50)).is_err());
        assert_eq!(wait_for_callback(&l, ST, Duration::from_millis(100)).unwrap_err(), "the sign-in did not come back in time");
    }
}
