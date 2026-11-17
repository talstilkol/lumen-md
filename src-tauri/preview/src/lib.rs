//! Previews of Lumen's files outside the app (plan W13.K2): Quick Look on
//! macOS (src-tauri/quicklook/) and the Explorer preview pane on Windows.
//! Plain std, no dependencies: `rustc --edition 2021 --test src-tauri/preview/src/lib.rs`.
//!
//! - `.md`: Markdown to a self-contained HTML page. Each block carries
//!   `dir="auto"`, and the page's direction follows the note's first strong
//!   letter, so a Hebrew note reads right to left and an English one left
//!   to right, with niqqud kept. Nothing is loaded: no script, no remote
//!   image or font (a CSP says so), links are shown but not followed.
//! - `.excalidraw`: the drawing as an SVG (rectangles, ellipses, diamonds,
//!   lines, arrows, free draw, text), also used as its thumbnail.
//! - `.base`: the base's views, as a list.
//!
//! The C entry points (`lumen_preview_render`, `lumen_preview_free`) are what
//! the Swift extension and the Windows handler call.

pub mod json;
pub mod markdown;
pub mod excalidraw;

/// What kind of file is previewed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Markdown = 0,
    Excalidraw = 1,
    Base = 2,
}

impl Kind {
    pub fn from_ext(ext: &str) -> Option<Kind> {
        match ext.to_ascii_lowercase().as_str() {
            "md" | "markdown" => Some(Kind::Markdown),
            "excalidraw" => Some(Kind::Excalidraw),
            "base" => Some(Kind::Base),
            _ => None,
        }
    }
}

/// HTML-escape text.
pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            _ => o.push(c),
        }
    }
    o
}

/// "rtl" when the first strong letter is Hebrew or Arabic, else "ltr".
pub fn base_direction(text: &str) -> &'static str {
    for c in text.chars() {
        let u = c as u32;
        if (0x0590..=0x08FF).contains(&u) || (0xFB1D..=0xFDFF).contains(&u) || (0xFE70..=0xFEFF).contains(&u) {
            if (0x0591..=0x05C7).contains(&u) || (0x064B..=0x065F).contains(&u) {
                continue; // niqqud and harakat are not strong
            }
            return "rtl";
        }
        if c.is_alphabetic() {
            return "ltr";
        }
    }
    "ltr"
}

/// The page around a rendered body: no script, nothing remote.
pub fn page(title: &str, dir: &str, body: &str) -> String {
    format!(
        "<!doctype html><html dir=\"{dir}\"><head><meta charset=\"utf-8\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">\
<title>{}</title><style>{}</style></head><body><main>{body}</main></body></html>",
        esc(title),
        CSS
    )
}

const CSS: &str = ":root{color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText;font:15px/1.6 -apple-system,'Segoe UI','Noto Sans Hebrew','Arial Hebrew',sans-serif}\
main{max-width:46em;margin:0 auto;padding:24px}h1,h2,h3{line-height:1.25}code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;direction:ltr;unicode-bidi:isolate}\
pre{padding:12px;border-radius:8px;background:color-mix(in srgb,CanvasText 6%,Canvas);overflow:auto}blockquote{margin:0;padding-inline-start:12px;border-inline-start:3px solid GrayText;color:GrayText}\
table{border-collapse:collapse}td,th{border:1px solid GrayText;padding:4px 8px}.props{font-size:13px;color:GrayText}a{color:LinkText}mark{color:#000}.task{list-style:none;margin-inline-start:-1.2em}";

/// Render a file's bytes as HTML (Markdown, Base) or SVG (Excalidraw).
pub fn render(kind: Kind, name: &str, bytes: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(bytes);
    match kind {
        Kind::Markdown => Ok(markdown::to_page(name, &text)),
        Kind::Excalidraw => excalidraw::to_svg(&text),
        Kind::Base => Ok(base_page(name, &text)),
    }
}

/// A `.base` file (YAML): its views by name and type, the rest as text.
pub fn base_page(name: &str, yaml: &str) -> String {
    let mut views = Vec::new();
    let mut cur_name = String::new();
    let mut cur_type = String::new();
    for line in yaml.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("- type:") {
            if !cur_type.is_empty() {
                views.push((cur_name.clone(), cur_type.clone()));
                cur_name.clear();
            }
            cur_type = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = t.strip_prefix("name:") {
            cur_name = rest.trim().trim_matches('"').to_string();
        }
    }
    if !cur_type.is_empty() {
        views.push((cur_name, cur_type));
    }
    let mut body = format!("<h1 dir=\"auto\">{}</h1>", esc(name));
    if views.is_empty() {
        body.push_str("<p>No views.</p>");
    } else {
        body.push_str("<ul>");
        for (n, t) in &views {
            body.push_str(&format!("<li dir=\"auto\"><strong>{}</strong> · {}</li>", esc(if n.is_empty() { "—" } else { n }), esc(t)));
        }
        body.push_str("</ul>");
    }
    body.push_str(&format!("<pre>{}</pre>", esc(yaml)));
    page(name, base_direction(name), &body)
}

/// C ABI: render `len` bytes at `ptr` (kind 0 md, 1 excalidraw, 2 base). The
/// result is UTF-8 with its length in `out_len`; free it with `lumen_preview_free`.
/// Null on error (or for a null input).
///
/// # Safety
/// `ptr` must point at `len` readable bytes, `name` at `name_len`, `out_len` be writable.
#[no_mangle]
pub unsafe extern "C" fn lumen_preview_render(kind: u8, name: *const u8, name_len: usize, ptr: *const u8, len: usize, out_len: *mut usize) -> *mut u8 {
    if ptr.is_null() || out_len.is_null() {
        return std::ptr::null_mut();
    }
    let k = match kind {
        0 => Kind::Markdown,
        1 => Kind::Excalidraw,
        2 => Kind::Base,
        _ => return std::ptr::null_mut(),
    };
    let bytes = std::slice::from_raw_parts(ptr, len);
    let nm = if name.is_null() { String::new() } else { String::from_utf8_lossy(std::slice::from_raw_parts(name, name_len)).into_owned() };
    match render(k, &nm, bytes) {
        Ok(s) => {
            let mut b = s.into_bytes().into_boxed_slice();
            *out_len = b.len();
            let p = b.as_mut_ptr();
            std::mem::forget(b);
            p
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `p` and `len` must come from `lumen_preview_render`.
#[no_mangle]
pub unsafe extern "C" fn lumen_preview_free(p: *mut u8, len: usize) {
    if !p.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(p, len)));
    }
}

#[cfg(test)]
mod tests;
