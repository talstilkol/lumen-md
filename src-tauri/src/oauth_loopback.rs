//! The loopback redirect of an MCP server sign-in (plan W13.A1, review 14 Low 1;
//! RFC 8252 §7.3): the system browser comes back to
//! `http://127.0.0.1:47613/oauth/callback?code=…&state=…&iss=…`, and this
//! listener hands that query to the app. Plain std, no Tauri:
//! `rustc --edition 2021 --test src-tauri/src/oauth_loopback.rs` runs the tests.
//!
//! - It listens on the IPv4 loopback address only (never 0.0.0.0), on the port
//!   the client metadata document names, for one sign-in at a time, and stops
//!   at the deadline.
//! - Only `GET /oauth/callback` whose `state` equals the one the app is
//!   waiting for is accepted. Anything else (another path, another method, a
//!   wrong or missing state, a request larger than 8 KiB) gets an error page
//!   and the listener keeps waiting: a local page cannot end the sign-in or
//!   hand the app a code of its own.
//! - The code is not checked here: the app checks `state` and `iss` again and
//!   redeems the code (src/agents/mcp/oauthFlow.ts).
//!
//! Owner: the Tauri command that calls `wait_for_redirect` must be added to
//! lib.rs's generate_handler! list and the isolation app's allow-list
//! (src-tauri/isolation/index.js) together; until then the app shows
//! "needs desktop command" (src/agents/mcp/oauthLoopback.ts).

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// The port in public/oauth/client-metadata.json's loopback redirect.
pub const PORT: u16 = 47613;
pub const PATH: &str = "/oauth/callback";
const MAX_REQUEST: usize = 8 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum LoopbackError {
    /// Nothing valid arrived before the deadline.
    TimedOut,
    /// The port could not be bound (another sign-in, or another program).
    Busy(String),
    Io(String),
}

/// Bind the loopback listener (127.0.0.1 only).
pub fn bind() -> Result<TcpListener, LoopbackError> {
    TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, PORT))).map_err(|e| LoopbackError::Busy(e.to_string()))
}

/// The value of `name` in a query string (percent-decoded; `+` is a space).
pub fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if decode(k)? == name {
            decode(v)
        } else {
            None
        }
    })
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// What one request is: the redirect for `state` (its query), or why not.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Redirect(String),
    NotFound,
    BadState,
    TooLarge,
    Malformed,
}

/// Judge one request's head (the bytes up to the blank line).
pub fn judge(head: &[u8], state: &str) -> Verdict {
    if head.len() > MAX_REQUEST {
        return Verdict::TooLarge;
    }
    let text = match std::str::from_utf8(head) {
        Ok(t) => t,
        Err(_) => return Verdict::Malformed,
    };
    let line = text.lines().next().unwrap_or("");
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if !version.starts_with("HTTP/1.") || parts.next().is_some() {
        return Verdict::Malformed;
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if method != "GET" || path != PATH {
        return Verdict::NotFound;
    }
    match query_param(query, "state") {
        Some(s) if !state.is_empty() && s == state => Verdict::Redirect(query.to_string()),
        _ => Verdict::BadState,
    }
}

fn read_head(stream: &mut TcpStream, deadline: Instant) -> Result<Vec<u8>, LoopbackError> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(LoopbackError::TimedOut);
        }
        stream.set_read_timeout(Some(left.min(Duration::from_secs(5)))).map_err(|e| LoopbackError::Io(e.to_string()))?;
        let n = match stream.read(&mut chunk) {
            Ok(n) => n,
            Err(e) => return Err(LoopbackError::Io(e.to_string())),
        };
        if n == 0 {
            return Ok(buf);
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > MAX_REQUEST {
            return Ok(buf);
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let page = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Lumen</title></head><body><p>{}</p></body></html>",
        body
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{}",
        status,
        page.len(),
        page
    );
    let _ = stream.flush();
}

/// Wait for the browser to come back with `state`; returns the redirect's query
/// (`code=…&state=…&iss=…`). Every other request is answered and ignored.
pub fn wait_for_redirect(listener: &TcpListener, state: &str, timeout: Duration) -> Result<String, LoopbackError> {
    let deadline = Instant::now() + timeout;
    listener.set_nonblocking(true).map_err(|e| LoopbackError::Io(e.to_string()))?;
    loop {
        if Instant::now() >= deadline {
            return Err(LoopbackError::TimedOut);
        }
        let (mut stream, peer) = match listener.accept() {
            Ok(x) => x,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
                continue;
            }
            Err(e) => return Err(LoopbackError::Io(e.to_string())),
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let _ = stream.set_nonblocking(false);
        let head = match read_head(&mut stream, deadline) {
            Ok(h) => h,
            Err(LoopbackError::TimedOut) => return Err(LoopbackError::TimedOut),
            Err(_) => continue,
        };
        match judge(&head, state) {
            Verdict::Redirect(q) => {
                respond(&mut stream, "200 OK", "Signed in. You can close this tab and go back to Lumen. / ההתחברות הושלמה. אפשר לסגור את הלשונית ולחזור ל־Lumen.");
                return Ok(q);
            }
            Verdict::NotFound => respond(&mut stream, "404 Not Found", "Not found."),
            Verdict::BadState => respond(&mut stream, "400 Bad Request", "This sign-in does not belong to Lumen's current request."),
            Verdict::TooLarge => respond(&mut stream, "431 Request Header Fields Too Large", "Too large."),
            Verdict::Malformed => respond(&mut stream, "400 Bad Request", "Bad request."),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn local() -> TcpListener {
        TcpListener::bind("127.0.0.1:0").unwrap()
    }

    fn send(port: u16, req: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn judges_only_the_callback_with_the_awaited_state() {
        let ok = b"GET /oauth/callback?code=abc&state=s%2B1&iss=https%3A%2F%2Fauth.example.com HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(judge(ok, "s+1"), Verdict::Redirect("code=abc&state=s%2B1&iss=https%3A%2F%2Fauth.example.com".into()));
        assert_eq!(judge(ok, "other"), Verdict::BadState);
        assert_eq!(judge(ok, ""), Verdict::BadState);
        assert_eq!(judge(b"GET /oauth/callback?code=abc HTTP/1.1\r\n\r\n", "s"), Verdict::BadState);
        assert_eq!(judge(b"POST /oauth/callback?state=s HTTP/1.1\r\n\r\n", "s"), Verdict::NotFound);
        assert_eq!(judge(b"GET /other?state=s HTTP/1.1\r\n\r\n", "s"), Verdict::NotFound);
        assert_eq!(judge(b"GET /oauth/callback/x?state=s HTTP/1.1\r\n\r\n", "s"), Verdict::NotFound);
        assert_eq!(judge(b"garbage\r\n\r\n", "s"), Verdict::Malformed);
        assert_eq!(judge(&vec![b'a'; MAX_REQUEST + 1], "s"), Verdict::TooLarge);
    }

    #[test]
    fn decodes_query_values() {
        assert_eq!(query_param("a=1&state=x%20y+z&b", "state").as_deref(), Some("x y z"));
        assert_eq!(query_param("a=1", "state"), None);
        assert_eq!(query_param("state=%zz", "state"), None);
    }

    #[test]
    fn ignores_wrong_requests_and_returns_the_right_redirect() {
        let l = local();
        let port = l.local_addr().unwrap().port();
        let h = thread::spawn(move || wait_for_redirect(&l, "st-1", Duration::from_secs(10)));
        let wrong = send(port, "GET /oauth/callback?code=evil&state=nope HTTP/1.1\r\n\r\n");
        assert!(wrong.starts_with("HTTP/1.1 400"), "{}", wrong);
        let other = send(port, "GET / HTTP/1.1\r\n\r\n");
        assert!(other.starts_with("HTTP/1.1 404"), "{}", other);
        let good = send(port, "GET /oauth/callback?code=c1&state=st-1 HTTP/1.1\r\n\r\n");
        assert!(good.starts_with("HTTP/1.1 200"), "{}", good);
        assert!(good.contains("Cache-Control: no-store"));
        assert_eq!(h.join().unwrap(), Ok("code=c1&state=st-1".to_string()));
    }

    #[test]
    fn stops_at_the_deadline() {
        let l = local();
        let t = Instant::now();
        assert_eq!(wait_for_redirect(&l, "s", Duration::from_millis(200)), Err(LoopbackError::TimedOut));
        assert!(t.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn binds_the_loopback_address_only() {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, PORT));
        assert!(addr.ip().is_loopback());
        assert_eq!(PORT, 47613);
    }
}
