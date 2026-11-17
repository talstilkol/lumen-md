//! An `.excalidraw` drawing as SVG: the preview and the thumbnail. Deleted
//! elements are skipped; colours are kept only when they are plain colour
//! values (a hex code or a CSS name), so the SVG cannot carry anything else.

use crate::esc;
use crate::json::{parse, Json};

fn colour(v: Option<&Json>, fallback: &str) -> String {
    let s = v.and_then(Json::str).unwrap_or(fallback);
    let ok = (s.starts_with('#') && (s.len() == 4 || s.len() == 7 || s.len() == 9) && s[1..].chars().all(|c| c.is_ascii_hexdigit())) || (s.len() < 24 && s.chars().all(|c| c.is_ascii_alphabetic()));
    if ok { s.to_string() } else { fallback.to_string() }
}

fn n(e: &Json, k: &str) -> f64 {
    e.get(k).and_then(Json::num).filter(|x| x.is_finite()).unwrap_or(0.0)
}

pub fn to_svg(text: &str) -> Result<String, String> {
    let doc = parse(text)?;
    if doc.get("type").and_then(Json::str) != Some("excalidraw") {
        return Err("not an excalidraw file".into());
    }
    let els: Vec<&Json> = doc.get("elements").map(|e| e.arr().iter().filter(|x| !x.get("isDeleted").is_some_and(Json::truthy)).collect()).unwrap_or_default();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for e in &els {
        let (x, y, w, h) = (n(e, "x"), n(e, "y"), n(e, "width"), n(e, "height"));
        x0 = x0.min(x.min(x + w));
        y0 = y0.min(y.min(y + h));
        x1 = x1.max(x.max(x + w));
        y1 = y1.max(y.max(y + h));
    }
    if els.is_empty() {
        (x0, y0, x1, y1) = (0.0, 0.0, 100.0, 100.0);
    }
    let pad = 16.0;
    let bg = colour(doc.get("appState").and_then(|a| a.get("viewBackgroundColor")), "#ffffff");
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{} {} {} {}\" width=\"{}\" height=\"{}\"><rect x=\"{}\" y=\"{}\" width=\"100%\" height=\"100%\" fill=\"{bg}\"/>",
        x0 - pad,
        y0 - pad,
        x1 - x0 + 2.0 * pad,
        y1 - y0 + 2.0 * pad,
        (x1 - x0 + 2.0 * pad).round(),
        (y1 - y0 + 2.0 * pad).round(),
        x0 - pad,
        y0 - pad
    );
    for e in els {
        let (x, y, w, h) = (n(e, "x"), n(e, "y"), n(e, "width"), n(e, "height"));
        let stroke = colour(e.get("strokeColor"), "#1e1e1e");
        let fill = match e.get("backgroundColor").and_then(Json::str) {
            Some("transparent") | None => "none".to_string(),
            _ => colour(e.get("backgroundColor"), "none"),
        };
        let sw = n(e, "strokeWidth").clamp(0.5, 16.0).max(1.0);
        let style = format!("stroke=\"{stroke}\" stroke-width=\"{sw}\" fill=\"{fill}\"");
        match e.get("type").and_then(Json::str).unwrap_or("") {
            "rectangle" => out.push_str(&format!("<rect x=\"{x}\" y=\"{y}\" width=\"{}\" height=\"{}\" rx=\"8\" {style}/>", w.abs(), h.abs())),
            "ellipse" => out.push_str(&format!("<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" {style}/>", x + w / 2.0, y + h / 2.0, (w / 2.0).abs(), (h / 2.0).abs())),
            "diamond" => out.push_str(&format!("<polygon points=\"{},{} {},{} {},{} {},{}\" {style}/>", x + w / 2.0, y, x + w, y + h / 2.0, x + w / 2.0, y + h, x, y + h / 2.0)),
            t @ ("line" | "arrow" | "freedraw") => {
                let pts: Vec<String> = e.get("points").map(|p| p.arr().iter().map(|q| format!("{},{}", x + q.arr().first().and_then(Json::num).unwrap_or(0.0), y + q.arr().get(1).and_then(Json::num).unwrap_or(0.0))).collect()).unwrap_or_default();
                if pts.len() >= 2 {
                    let marker = if t == "arrow" { " marker-end=\"url(#a)\"" } else { "" };
                    out.push_str(&format!("<polyline points=\"{}\" stroke=\"{stroke}\" stroke-width=\"{sw}\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"{marker}/>", pts.join(" ")));
                }
            }
            "text" => {
                let size = n(e, "fontSize").clamp(4.0, 200.0);
                let text = e.get("text").and_then(Json::str).unwrap_or("");
                out.push_str(&format!("<text x=\"{x}\" y=\"{}\" font-size=\"{size}\" fill=\"{stroke}\" font-family=\"sans-serif\" direction=\"{}\" unicode-bidi=\"plaintext\">", y + size, if crate::base_direction(text) == "rtl" { "rtl" } else { "ltr" }));
                for (i, line) in text.lines().enumerate() {
                    out.push_str(&format!("<tspan x=\"{}\" dy=\"{}\">{}</tspan>", if crate::base_direction(text) == "rtl" { x + w } else { x }, if i == 0 { 0.0 } else { size * 1.25 }, esc(line)));
                }
                out.push_str("</text>");
            }
            _ => {}
        }
    }
    out.push_str("<defs><marker id=\"a\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto-start-reverse\"><path d=\"M0,0 L10,5 L0,10 z\" fill=\"context-stroke\"/></marker></defs></svg>");
    Ok(out)
}
