use crate::{base_direction, json, lumen_preview_free, lumen_preview_render, markdown, render, Kind};

const NOTE: &str = "---\ntitle: עוגת שמרים\ntags:\n  - מטבח\n  - מתוק\n---\n# עוגה\n\nבָּצֵק **רך** עם [[מתכונים/שמרים|שמרים]] ו-`code <b>`.\n\n- [ ] ללוש\n- [x] לקנות קמח\n\n> ציטוט\n\n```js\nalert('<x>')\n```\n\n| א | ב |\n|---|---|\n| 1 | 2 |\n\nAn English paragraph with a [link](https://example.com).\n";

#[test]
fn hebrew_note_reads_right_to_left_with_its_niqqud() {
    let html = markdown::to_page("עוגה.md", NOTE);
    assert!(html.starts_with("<!doctype html><html dir=\"rtl\">"), "{html}");
    assert!(html.contains("<title>עוגת שמרים</title>"));
    assert!(html.contains("<h1 dir=\"auto\">עוגה</h1>"));
    assert!(html.contains("בָּצֵק <strong>רך</strong>"), "niqqud kept");
    assert!(html.contains("<a dir=\"auto\">שמרים</a>"), "a wiki link shows its label");
    assert!(html.contains("<li class=\"task\">☐ ללוש</li>") && html.contains("☑ לקנות קמח"));
    assert!(html.contains("<blockquote><p dir=\"auto\">ציטוט</p></blockquote>"));
    assert!(html.contains("<th dir=\"auto\">tags</th><td dir=\"auto\">מטבח, מתוק</td>"), "properties as a table");
    assert!(html.contains("<table dir=\"auto\"><thead><tr><th>א</th><th>ב</th>"));
    // Every paragraph decides its own direction: the English one too.
    assert!(html.contains("<p dir=\"auto\">An English paragraph"));
}

#[test]
fn nothing_runs_and_nothing_is_fetched() {
    let html = markdown::to_page("x.md", NOTE);
    assert!(!html.contains("<script"), "code is escaped, never run");
    assert!(html.contains("alert(&#39;&lt;x&gt;&#39;)"));
    assert!(html.contains("<code>code &lt;b&gt;</code>"));
    assert!(html.contains("default-src 'none'"), "a CSP that loads nothing");
    assert!(!html.contains("href="), "links are shown, not followed");
    let img = markdown::to_html("![cat](https://evil.example/t.png)");
    assert!(!img.contains("<img") && img.contains("🖼 cat"));
    let raw = markdown::to_html("<img src=x onerror=alert(1)>");
    assert!(raw.contains("&lt;img"));
}

#[test]
fn direction_follows_the_first_strong_letter() {
    assert_eq!(base_direction("\u{05B8}שָׁלוֹם"), "rtl");
    assert_eq!(base_direction("123 hello שלום"), "ltr");
    assert_eq!(base_direction("  — مرحبا"), "rtl");
    assert_eq!(base_direction(""), "ltr");
    assert!(markdown::to_page("en.md", "# Hello\n").starts_with("<!doctype html><html dir=\"ltr\">"));
}

#[test]
fn excalidraw_drawing_as_svg() {
    let file = r##"{"type":"excalidraw","version":2,"appState":{"viewBackgroundColor":"#fafafa"},"elements":[
      {"type":"rectangle","x":0,"y":0,"width":200,"height":100,"strokeColor":"#1971c2","backgroundColor":"transparent","strokeWidth":2},
      {"type":"ellipse","x":250,"y":0,"width":80,"height":80,"strokeColor":"#e03131","backgroundColor":"#ffc9c9","strokeWidth":1},
      {"type":"arrow","x":200,"y":50,"width":50,"height":0,"points":[[0,0],[50,0]],"strokeColor":"#000","strokeWidth":2},
      {"type":"text","x":20,"y":30,"width":160,"height":25,"text":"שלום <עולם>","fontSize":20,"strokeColor":"red"},
      {"type":"rectangle","x":5000,"y":5000,"width":10,"height":10,"isDeleted":true},
      {"type":"diamond","x":0,"y":150,"width":60,"height":60,"strokeColor":"javascript:alert(1)"}
    ]}"##;
    let svg = render(Kind::Excalidraw, "d.excalidraw", file.as_bytes()).unwrap();
    assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-16 -16 362 242\""), "{svg}");
    assert!(svg.contains("<rect x=\"0\" y=\"0\" width=\"200\" height=\"100\" rx=\"8\" stroke=\"#1971c2\""));
    assert!(svg.contains("<ellipse cx=\"290\" cy=\"40\" rx=\"40\" ry=\"40\" stroke=\"#e03131\" stroke-width=\"1\" fill=\"#ffc9c9\"/>"));
    assert!(svg.contains("marker-end=\"url(#a)\""));
    assert!(svg.contains("direction=\"rtl\"") && svg.contains("שלום &lt;עולם&gt;"));
    assert!(!svg.contains("5000"), "deleted elements are left out");
    assert!(!svg.contains("javascript"), "only plain colours");
    assert!(render(Kind::Excalidraw, "x", b"{\"type\":\"other\"}").is_err());
    assert!(render(Kind::Excalidraw, "x", b"not json").is_err());
}

#[test]
fn base_lists_its_views() {
    let html = render(Kind::Base, "משימות.base", "views:\n  - type: table\n    name: \"פתוחות\"\n  - type: cards\n    name: Done\n".as_bytes()).unwrap();
    assert!(html.contains("<li dir=\"auto\"><strong>פתוחות</strong> · table</li>"));
    assert!(html.contains("<strong>Done</strong> · cards"));
    assert!(html.contains("<html dir=\"rtl\">"));
}

#[test]
fn json_reader() {
    let v = json::parse(r#"{"a":[1,-2.5e1,true,null,"ש😀\n"]}"#).unwrap();
    let a = v.get("a").unwrap().arr();
    assert_eq!(a[1].num(), Some(-25.0));
    assert_eq!(a[4].str(), Some("ש😀\n"));
    assert!(json::parse("[1,]").is_err());
    assert!(json::parse(&"[".repeat(100)).is_err(), "nesting is capped");
}

#[test]
fn the_c_entry_points_round_trip() {
    let src = "# שלום\n";
    let name = "a.md";
    let mut len = 0usize;
    unsafe {
        let p = lumen_preview_render(0, name.as_ptr(), name.len(), src.as_ptr(), src.len(), &mut len);
        assert!(!p.is_null());
        let s = std::str::from_utf8(std::slice::from_raw_parts(p, len)).unwrap().to_string();
        lumen_preview_free(p, len);
        assert!(s.contains("<h1 dir=\"auto\">שלום</h1>"));
        assert!(lumen_preview_render(9, name.as_ptr(), name.len(), src.as_ptr(), src.len(), &mut len).is_null());
        assert!(lumen_preview_render(1, name.as_ptr(), name.len(), src.as_ptr(), src.len(), &mut len).is_null(), "not a drawing");
    }
    assert_eq!(Kind::from_ext("MD"), Some(Kind::Markdown));
    assert_eq!(Kind::from_ext("txt"), None);
}
