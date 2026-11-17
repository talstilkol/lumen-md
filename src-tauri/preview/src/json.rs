//! A small JSON reader (enough for .excalidraw files), std only.

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, k: &str) -> Option<&Json> {
        match self {
            Json::Obj(v) => v.iter().find(|(a, _)| a == k).map(|(_, b)| b),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        if let Json::Str(s) = self { Some(s) } else { None }
    }
    pub fn num(&self) -> Option<f64> {
        if let Json::Num(n) = self { Some(*n) } else { None }
    }
    pub fn arr(&self) -> &[Json] {
        if let Json::Arr(a) = self { a } else { &[] }
    }
    pub fn truthy(&self) -> bool {
        matches!(self, Json::Bool(true))
    }
}

/// Parse; nesting is capped at 64 and the input at 32 MB.
pub fn parse(s: &str) -> Result<Json, String> {
    if s.len() > 32 << 20 {
        return Err("too large".into());
    }
    let b = s.as_bytes();
    let mut i = 0;
    let v = value(b, &mut i, 0)?;
    ws(b, &mut i);
    if i != b.len() {
        return Err(format!("trailing data at {i}"));
    }
    Ok(v)
}

fn ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && matches!(b[*i], b' ' | b'\n' | b'\r' | b'\t') {
        *i += 1;
    }
}

fn value(b: &[u8], i: &mut usize, depth: u32) -> Result<Json, String> {
    if depth > 64 {
        return Err("too deep".into());
    }
    ws(b, i);
    match b.get(*i) {
        Some(b'{') => {
            *i += 1;
            let mut out = Vec::new();
            ws(b, i);
            if b.get(*i) == Some(&b'}') {
                *i += 1;
                return Ok(Json::Obj(out));
            }
            loop {
                ws(b, i);
                let k = string(b, i)?;
                ws(b, i);
                if b.get(*i) != Some(&b':') {
                    return Err(format!("expected : at {i}"));
                }
                *i += 1;
                let v = value(b, i, depth + 1)?;
                out.push((k, v));
                ws(b, i);
                match b.get(*i) {
                    Some(b',') => *i += 1,
                    Some(b'}') => {
                        *i += 1;
                        return Ok(Json::Obj(out));
                    }
                    _ => return Err(format!("expected , or }} at {i}")),
                }
            }
        }
        Some(b'[') => {
            *i += 1;
            let mut out = Vec::new();
            ws(b, i);
            if b.get(*i) == Some(&b']') {
                *i += 1;
                return Ok(Json::Arr(out));
            }
            loop {
                out.push(value(b, i, depth + 1)?);
                ws(b, i);
                match b.get(*i) {
                    Some(b',') => *i += 1,
                    Some(b']') => {
                        *i += 1;
                        return Ok(Json::Arr(out));
                    }
                    _ => return Err(format!("expected , or ] at {i}")),
                }
            }
        }
        Some(b'"') => Ok(Json::Str(string(b, i)?)),
        Some(b't') if b[*i..].starts_with(b"true") => {
            *i += 4;
            Ok(Json::Bool(true))
        }
        Some(b'f') if b[*i..].starts_with(b"false") => {
            *i += 5;
            Ok(Json::Bool(false))
        }
        Some(b'n') if b[*i..].starts_with(b"null") => {
            *i += 4;
            Ok(Json::Null)
        }
        Some(c) if *c == b'-' || c.is_ascii_digit() => {
            let s = *i;
            *i += 1;
            while *i < b.len() && (b[*i].is_ascii_digit() || matches!(b[*i], b'.' | b'e' | b'E' | b'+' | b'-')) {
                *i += 1;
            }
            std::str::from_utf8(&b[s..*i]).ok().and_then(|t| t.parse::<f64>().ok()).map(Json::Num).ok_or_else(|| format!("bad number at {s}"))
        }
        _ => Err(format!("unexpected input at {i}")),
    }
}

fn string(b: &[u8], i: &mut usize) -> Result<String, String> {
    if b.get(*i) != Some(&b'"') {
        return Err(format!("expected a string at {i}"));
    }
    *i += 1;
    let mut out: Vec<u8> = Vec::new();
    while let Some(&c) = b.get(*i) {
        *i += 1;
        match c {
            b'"' => return String::from_utf8(out).map_err(|_| "bad UTF-8".into()),
            b'\\' => {
                let e = *b.get(*i).ok_or("bad escape")?;
                *i += 1;
                match e {
                    b'n' => out.push(b'\n'),
                    b't' => out.push(b'\t'),
                    b'r' => out.push(b'\r'),
                    b'b' => out.push(8),
                    b'f' => out.push(12),
                    b'u' => {
                        let hex = std::str::from_utf8(b.get(*i..*i + 4).ok_or("bad \\u")?).map_err(|_| "bad \\u")?;
                        let mut cp = u32::from_str_radix(hex, 16).map_err(|_| "bad \\u")?;
                        *i += 4;
                        if (0xD800..0xDC00).contains(&cp) && b.get(*i..*i + 2) == Some(b"\\u") {
                            let lo = u32::from_str_radix(std::str::from_utf8(b.get(*i + 2..*i + 6).ok_or("bad \\u")?).map_err(|_| "bad \\u")?, 16).map_err(|_| "bad \\u")?;
                            *i += 6;
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        }
                        let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
                        let mut tmp = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut tmp).as_bytes());
                    }
                    other => out.push(other),
                }
            }
            _ => out.push(c),
        }
    }
    Err("unterminated string".into())
}
