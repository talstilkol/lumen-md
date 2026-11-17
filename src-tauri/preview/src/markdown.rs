//! Markdown to a preview page: the blocks a note uses (headings, paragraphs,
//! lists and tasks, quotes, code, tables, rules), the inline marks (bold,
//! italic, code, links, wiki links, highlights), properties as a small
//! table. Every block is `dir="auto"`: each paragraph takes the direction of
//! its own first letter, as in the app.

use crate::{base_direction, esc, page};

/// Inline marks, on escaped text.
pub fn inline(raw: &str) -> String {
    // Code spans first: their content is not marked up.
    let mut out = String::new();
    let mut rest = raw;
    while let Some(a) = rest.find('`') {
        out.push_str(&marks(&rest[..a]));
        if let Some(b) = rest[a + 1..].find('`') {
            out.push_str(&format!("<code>{}</code>", esc(&rest[a + 1..a + 1 + b])));
            rest = &rest[a + 2 + b..];
        } else {
            out.push_str(&marks(&rest[a..]));
            rest = "";
        }
    }
    out.push_str(&marks(rest));
    out
}

fn pair(s: &str, delim: &str, open: &str, close: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find(delim) {
        if let Some(b) = rest[a + delim.len()..].find(delim) {
            let inner = &rest[a + delim.len()..a + delim.len() + b];
            if !inner.is_empty() && !inner.starts_with(' ') {
                out.push_str(&rest[..a]);
                out.push_str(open);
                out.push_str(inner);
                out.push_str(close);
                rest = &rest[a + 2 * delim.len() + b..];
                continue;
            }
        }
        out.push_str(&rest[..a + delim.len()]);
        rest = &rest[a + delim.len()..];
    }
    out.push_str(rest);
    out
}

fn marks(raw: &str) -> String {
    let mut s = esc(raw);
    // [[target|label]] and [[target]]: shown as the label, not followed.
    while let Some(a) = s.find("[[") {
        let Some(b) = s[a..].find("]]") else { break };
        let inner = s[a + 2..a + b].to_string();
        let label = inner.split('|').nth(1).unwrap_or_else(|| inner.split('#').next().unwrap_or(&inner)).to_string();
        s = format!("{}<a dir=\"auto\">{}</a>{}", &s[..a], label, &s[a + b + 2..]);
    }
    // [text](url): the text, the address in a title; nothing is loaded or followed.
    let mut out = String::new();
    let mut rest = s.as_str();
    while let Some(a) = rest.find('[') {
        if let (Some(mid), true) = (rest[a..].find("]("), true) {
            if let Some(end) = rest[a + mid..].find(')') {
                let text = &rest[a + 1..a + mid];
                let url = &rest[a + mid + 2..a + mid + end];
                let img = a > 0 && rest.as_bytes()[a - 1] == b'!';
                out.push_str(&rest[..if img { a - 1 } else { a }]);
                if img {
                    out.push_str(&format!("<span title=\"{url}\">🖼 {text}</span>"));
                } else {
                    out.push_str(&format!("<a title=\"{url}\">{text}</a>"));
                }
                rest = &rest[a + mid + end + 1..];
                continue;
            }
        }
        out.push_str(&rest[..a + 1]);
        rest = &rest[a + 1..];
    }
    out.push_str(rest);
    let s = pair(&out, "**", "<strong>", "</strong>");
    let s = pair(&s, "==", "<mark>", "</mark>");
    let s = pair(&s, "~~", "<del>", "</del>");
    pair(&s, "*", "<em>", "</em>")
}

/// The note's properties (YAML front matter) and the body after them.
pub fn split_front_matter(text: &str) -> (Vec<(String, String)>, &str) {
    let t = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    if !t.starts_with("---\n") && !t.starts_with("---\r\n") {
        return (vec![], t);
    }
    let after = &t[t.find('\n').unwrap() + 1..];
    let mut end = None;
    let mut pos = 0;
    for line in after.split_inclusive('\n') {
        if line.trim_end() == "---" {
            end = Some(pos + line.len());
            break;
        }
        pos += line.len();
    }
    let Some(end) = end else { return (vec![], t) };
    let mut props = Vec::new();
    for line in after[..pos].lines() {
        if let Some((k, v)) = line.split_once(':') {
            if !k.starts_with(' ') && !k.starts_with('-') {
                props.push((k.trim().to_string(), v.trim().to_string()));
                continue;
            }
        }
        if let (Some(last), Some(item)) = (props.last_mut(), line.trim().strip_prefix("- ")) {
            if !last.1.is_empty() {
                last.1.push_str(", ");
            }
            last.1.push_str(item.trim());
        }
    }
    (props, &after[end..])
}

/// Markdown body to HTML.
pub fn to_html(md: &str) -> String {
    let lines: Vec<&str> = md.lines().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut para: Vec<&str> = Vec::new();
    let flush = |para: &mut Vec<&str>, out: &mut String| {
        if !para.is_empty() {
            out.push_str(&format!("<p dir=\"auto\">{}</p>", para.iter().map(|l| inline(l.trim())).collect::<Vec<_>>().join("<br>")));
            para.clear();
        }
    };
    while i < lines.len() {
        let l = lines[i];
        let t = l.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            flush(&mut para, &mut out);
            let fence = &t[..3];
            let mut code = Vec::new();
            i += 1;
            while i < lines.len() && !lines[i].trim_start().starts_with(fence) {
                code.push(lines[i]);
                i += 1;
            }
            out.push_str(&format!("<pre><code>{}</code></pre>", esc(&code.join("\n"))));
            i += 1;
            continue;
        }
        if t.is_empty() {
            flush(&mut para, &mut out);
            i += 1;
            continue;
        }
        let hashes = t.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && t[hashes..].starts_with(' ') {
            flush(&mut para, &mut out);
            out.push_str(&format!("<h{hashes} dir=\"auto\">{}</h{hashes}>", inline(t[hashes..].trim().trim_end_matches('#').trim())));
            i += 1;
            continue;
        }
        if matches!(t, "---" | "***" | "___") {
            flush(&mut para, &mut out);
            out.push_str("<hr>");
            i += 1;
            continue;
        }
        if t.starts_with('>') {
            flush(&mut para, &mut out);
            let mut q = Vec::new();
            while i < lines.len() && lines[i].trim_start().starts_with('>') {
                q.push(lines[i].trim_start()[1..].trim_start());
                i += 1;
            }
            // No dir="auto" here: it would skip the paragraphs inside (they carry their own) and fall back to ltr.
            out.push_str(&format!("<blockquote>{}</blockquote>", to_html(&q.join("\n"))));
            continue;
        }
        if is_item(t).is_some() {
            flush(&mut para, &mut out);
            let ordered = t.chars().next().is_some_and(|c| c.is_ascii_digit());
            out.push_str(if ordered { "<ol dir=\"auto\">" } else { "<ul dir=\"auto\">" });
            while i < lines.len() {
                let Some(item) = is_item(lines[i].trim_start()) else { break };
                if let Some(rest) = item.strip_prefix("[ ] ") {
                    out.push_str(&format!("<li class=\"task\">☐ {}</li>", inline(rest)));
                } else if let Some(rest) = item.strip_prefix("[x] ").or_else(|| item.strip_prefix("[X] ")) {
                    out.push_str(&format!("<li class=\"task\">☑ {}</li>", inline(rest)));
                } else {
                    out.push_str(&format!("<li>{}</li>", inline(item)));
                }
                i += 1;
            }
            out.push_str(if ordered { "</ol>" } else { "</ul>" });
            continue;
        }
        if t.starts_with('|') && i + 1 < lines.len() && lines[i + 1].trim_start().starts_with('|') && lines[i + 1].contains("--") {
            flush(&mut para, &mut out);
            let cells = |l: &str| l.trim().trim_matches('|').split('|').map(|c| inline(c.trim())).collect::<Vec<_>>();
            out.push_str("<table dir=\"auto\"><thead><tr>");
            for c in cells(t) {
                out.push_str(&format!("<th>{c}</th>"));
            }
            out.push_str("</tr></thead><tbody>");
            i += 2;
            while i < lines.len() && lines[i].trim_start().starts_with('|') {
                out.push_str("<tr>");
                for c in cells(lines[i]) {
                    out.push_str(&format!("<td>{c}</td>"));
                }
                out.push_str("</tr>");
                i += 1;
            }
            out.push_str("</tbody></table>");
            continue;
        }
        para.push(l);
        i += 1;
    }
    flush(&mut para, &mut out);
    out
}

fn is_item(t: &str) -> Option<&str> {
    for p in ["- ", "* ", "+ "] {
        if let Some(r) = t.strip_prefix(p) {
            return Some(r);
        }
    }
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits < 10 {
        let r = &t[digits..];
        if let Some(r) = r.strip_prefix(". ").or_else(|| r.strip_prefix(") ")) {
            return Some(r);
        }
    }
    None
}

/// The whole page for a note named `name`.
pub fn to_page(name: &str, text: &str) -> String {
    let (props, body) = split_front_matter(text);
    let mut html = String::new();
    if !props.is_empty() {
        html.push_str("<table class=\"props\">");
        for (k, v) in &props {
            html.push_str(&format!("<tr><th dir=\"auto\">{}</th><td dir=\"auto\">{}</td></tr>", esc(k), esc(v)));
        }
        html.push_str("</table>");
    }
    html.push_str(&to_html(body));
    let title = props.iter().find(|(k, _)| k == "title").map(|(_, v)| v.as_str()).unwrap_or(name);
    page(title, base_direction(body), &html)
}
