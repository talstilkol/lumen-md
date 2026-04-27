export const WELCOME_DOC = `---
title: Welcome to Lumen
author: You
date: 2026-04-25
tags: [markdown, demo]
---

# Welcome to **Lumen** ✨

A markdown editor that turns *text and data* into beautiful, living documents.
Switch between **Source**, **Split**, **Preview**, and **WYSIWYG** modes from
the toolbar above (or press \`⌘1\`, \`⌘2\`, \`⌘3\`, \`⌘4\`). Press \`⌘K\` for the
**command palette** to insert charts, diagrams, maps, math blocks, and more.
Press \`⇧⌘F\` to fuzzy-search every file in the workspace.

Drop or paste an image directly into the editor — it'll be saved to the
in-browser **workspace** (OPFS) and inserted as a markdown link. Toggle the
workspace sidebar from the command palette to see a tree of all your files,
and run a real-time **collab session** to co-edit with anyone over WebRTC.

> Drop a \`.md\`, \`.csv\`, \`.tsv\`, or \`.json\` file anywhere on this window to open it.

---

## 1. Rich text, the way it should look

The preview uses a careful serif typeface with optical sizing, while
**bold**, *italic*, ~~strike~~, [links](https://example.com), and \`inline code\`
all retain a clean, deliberate rhythm.

### Lists & task tracking

- A bullet list
- Nested bullets work too
  - Just like this
  - And this
- Ordered lists, footnotes[^1], abbreviations, and emoji 🚀 all render natively.

#### Checklist

- [x] Beautiful typography
- [x] GitHub-flavored Markdown
- [x] Code highlighting with Shiki
- [x] LaTeX math, Mermaid, ECharts, maps
- [ ] Your masterpiece

[^1]: Yes — footnotes are first-class.

---

## 2. Code, with VS Code-grade highlighting

Code blocks are highlighted with **Shiki** (the same engine VS Code uses).

\`\`\`typescript title="parser.ts"
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .process(markdown);
  return String(file);
}
\`\`\`

\`\`\`python title="data.py"
import polars as pl

df = (
    pl.read_csv("sales.csv")
      .group_by("region")
      .agg(pl.col("revenue").sum().alias("total"))
      .sort("total", descending=True)
)
print(df)
\`\`\`

\`\`\`rust
fn main() {
    let primes: Vec<u32> = (2..50)
        .filter(|n| (2..*n).all(|i| n % i != 0))
        .collect();
    println!("{:?}", primes);
}
\`\`\`

---

## 3. Math, chemistry, and physics

Inline math: $E = mc^2$, the golden ratio $\\varphi = \\tfrac{1+\\sqrt{5}}{2}$,
and Euler: $e^{i\\pi} + 1 = 0$.

Display math:

$$
\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}, \\qquad
\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0\\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
$$

$$
\\hat{H}\\,\\psi = i\\hbar \\frac{\\partial \\psi}{\\partial t}
$$

Chemistry via \\ce{}:

$$
\\ce{CO2 + 6H2O ->[\\text{light}] C6H12O6 + 6O2}
$$

---

## 4. Diagrams with Mermaid

\`\`\`mermaid
flowchart LR
  A[📝 Markdown] -->|parse| B(remark)
  B --> C{Block type?}
  C -->|code| D[Shiki]
  C -->|math| E[KaTeX]
  C -->|chart| F[ECharts]
  C -->|csv / json| G[DataTable<br/>+ Auto chart]
  C -->|mermaid| H[Mermaid]
  C -->|map| I[Leaflet]
  D & E & F & G & H & I --> J((✨ Beautiful preview))
  style J fill:#7c5cff,stroke:#fff,color:#fff
\`\`\`

\`\`\`mermaid
sequenceDiagram
  autonumber
  participant U as You
  participant E as Editor
  participant P as Preview
  U->>E: types markdown
  E->>P: stream changes
  P->>P: parse + render
  P-->>U: live update ✨
\`\`\`

---

## 5. Data → tables and charts, automatically

Drop in raw CSV — Lumen parses it, infers column types, builds a sortable table,
and **suggests the right chart automatically**. Click between *Table* and *Chart*,
then cycle through suggested visualizations.

\`\`\`csv title="Quarterly revenue by region"
quarter,region,revenue,deals
2024 Q1,Americas,4200,82
2024 Q1,EMEA,3100,61
2024 Q1,APAC,2700,49
2024 Q2,Americas,4800,90
2024 Q2,EMEA,3500,68
2024 Q2,APAC,3200,57
2024 Q3,Americas,5100,97
2024 Q3,EMEA,4000,75
2024 Q3,APAC,3700,66
2024 Q4,Americas,5800,108
2024 Q4,EMEA,4400,82
2024 Q4,APAC,4100,72
\`\`\`

JSON arrays-of-objects work the same way:

\`\`\`json-table title="Programming languages"
[
  { "lang": "TypeScript", "year": 2012, "stars": 102000, "paradigm": "multi" },
  { "lang": "Rust",       "year": 2010, "stars": 98000,  "paradigm": "systems" },
  { "lang": "Go",         "year": 2009, "stars": 124000, "paradigm": "systems" },
  { "lang": "Python",     "year": 1991, "stars": 230000, "paradigm": "multi" },
  { "lang": "Elixir",     "year": 2011, "stars": 24000,  "paradigm": "functional" },
  { "lang": "Zig",        "year": 2016, "stars": 36000,  "paradigm": "systems" },
  { "lang": "Gleam",      "year": 2016, "stars": 18000,  "paradigm": "functional" },
  { "lang": "Kotlin",     "year": 2011, "stars": 49000,  "paradigm": "multi" }
]
\`\`\`

You can also write an explicit \`chart\` block (YAML or JSON ECharts spec):

\`\`\`chart
title:
  text: Page-load budget vs measured
  textStyle: { color: '#9aa3b2' }
xAxis:
  type: category
  data: [Home, Docs, Pricing, Blog, Dashboard]
  axisLabel: { color: '#9aa3b2' }
yAxis:
  type: value
  axisLabel: { color: '#9aa3b2' }
legend:
  textStyle: { color: '#9aa3b2' }
  top: 24
series:
  - name: Budget
    type: bar
    barMaxWidth: 28
    itemStyle: { borderRadius: [4,4,0,0], color: '#475569' }
    data: [2.0, 2.5, 2.0, 2.5, 3.0]
  - name: Measured
    type: bar
    barMaxWidth: 28
    itemStyle: { borderRadius: [4,4,0,0], color: '#7c5cff' }
    data: [1.4, 2.1, 1.8, 2.7, 3.4]
tooltip:
  trigger: axis
\`\`\`

GitHub-flavored tables are still here when you want them:

| Feature           | Lumen | Typora | Obsidian | StackEdit |
| ----------------- | :---: | :----: | :------: | :-------: |
| Mermaid           |   ✅   |   ❌    |    ✅     |     ✅     |
| KaTeX + mhchem    |   ✅   |   ✅    |    ✅     |     ✅     |
| ECharts           |   ✅   |   ❌    |    🔌    |     ❌     |
| Auto CSV → chart  |   ✅   |   ❌    |    🔌    |     ❌     |
| Maps              |   ✅   |   ❌    |    🔌    |     ❌     |
| Local-first       |   ✅   |   ✅    |    ✅     |     ⚠️    |

---

## 6. Maps (Leaflet)

\`\`\`map
center: [37.77, -25.0]
zoom: 2
markers:
  - { lat: 37.7749, lng: -122.4194, label: "San Francisco" }
  - { lat: 51.5074, lng: -0.1278,   label: "London" }
  - { lat: 35.6762, lng: 139.6503,  label: "Tokyo" }
  - { lat: -33.8688, lng: 151.2093, label: "Sydney" }
  - { lat: 40.7128, lng: -74.0060,  label: "New York" }
\`\`\`

---

## 7. Callouts

:::note{title="Heads up"}
Markdown directives (\`:::note\`, \`:::tip\`, \`:::info\`, \`:::warning\`, \`:::danger\`)
turn into themed callouts.
:::

:::tip{title="Pro tip"}
Drag any \`.csv\` or \`.json\` file onto the window — Lumen drops it into a fresh
document with the data block already in place.
:::

:::warning{title="Heavy block"}
Mermaid, Leaflet, and ECharts are loaded *on demand* — your initial bundle
stays small.
:::

:::danger{title="Unsaved changes"}
The little dot next to the filename means you have unsaved changes.
\`⌘S\` saves; \`⇧⌘S\` saves as.
:::

---

## 8. PlantUML, Graphviz, music & 3D — all first-class

A Graphviz \`dot\` block (rendered locally via WASM):

\`\`\`dot
digraph G {
  rankdir=LR;
  bgcolor="transparent";
  node [shape=box, style=rounded, color="#7c5cff", fontname="Inter"];
  edge [color="#9aa3b2"];
  Editor -> Pipeline -> Renderer;
  Pipeline -> "Block plugins" -> Renderer;
}
\`\`\`

Music notation via ABC:

\`\`\`abc
X:1
T:Lumen Theme
M:4/4
L:1/8
K:G
|:GABc dedB | dedB dedB | c2ec B2dB | A2EA B2EA |
GABc dedB | dedB dedB | c2ec B2dB |1 A2BG AGEG :|2 A2BG AGEG ||
\`\`\`

A YouTube embed via the \`embed\` fence (also supports Vimeo, CodePen, Figma,
Loom, Spotify, CodeSandbox, and any URL):

\`\`\`embed
https://www.youtube.com/watch?v=dQw4w9WgXcQ
\`\`\`

A **live HTML/CSS/JS preview** — paste any snippet and Lumen renders it inside
a sandboxed iframe. Toggle to *Source* to inspect the markup, or *Fullscreen*
to make it the entire viewport:

\`\`\`htmlpreview height=280 title="Live demo"
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
  .card { padding: 1.75rem 2.5rem; border-radius: 16px;
          background: linear-gradient(135deg, #7c5cff, #22d3ee);
          box-shadow: 0 20px 50px -12px rgba(124,92,255,0.5); text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 2rem; letter-spacing: -0.02em; }
  p  { margin: 0; opacity: 0.9; }
  button { margin-top: 1rem; padding: 0.4rem 1rem; border-radius: 999px;
           border: 0; background: rgba(255,255,255,0.2); color: inherit;
           cursor: pointer; backdrop-filter: blur(6px); }
</style>
<div class="card">
  <h1 id="t">Hello, Lumen ✨</h1>
  <p>Live HTML / CSS / JS, sandboxed and code-split.</p>
  <button onclick="document.getElementById('t').textContent = '🚀 Lift-off!';">
    Click me
  </button>
</div>
\`\`\`

---

## 9. Wiki-links

Drop \`[[wiki-links]]\` anywhere. They slugify the target and jump to the
matching heading — e.g. [[1. Rich text, the way it should look|jump to section 1]].
With the workspace enabled (\`⌘K → Toggle workspace\`), they'll cross files too.

---

## 10. Blockquote and a finishing flourish

> *"The best way to predict the future is to invent it."* — Alan Kay

---

## 12. Tabular conversions

Lumen turns SQL, Pandas, JSON and JS-object literals into the same sortable
DataTable + chart-suggestion UI. The fence language picks the parser; use
\`data\` to auto-detect.

A SQL dump:

\`\`\`sql
CREATE TABLE sales (date TEXT, region TEXT, revenue REAL);
INSERT INTO sales (date, region, revenue) VALUES
  ('2026-01-01', 'North', 1240.50),
  ('2026-01-02', 'South',  980.00),
  ('2026-01-03', 'East',  1670.25),
  ('2026-01-04', 'West',  1120.75);
\`\`\`

The textual repr of a Pandas DataFrame:

\`\`\`pandas
    date        region   revenue
0   2026-01-01  North     1240.5
1   2026-01-02  South      980.0
2   2026-01-03  East      1670.25
3   2026-01-04  West      1120.75
\`\`\`

A JS / JSON5-style object array (unquoted keys, single quotes, comments
all welcome):

\`\`\`object
[
  // Q1 launch metrics
  { product: 'Lumen Pro', signups: 1240, revenue: 18600 },
  { product: 'Lumen Team', signups:  480, revenue: 14400 },
  { product: 'Enterprise', signups:   38, revenue:  9500 },
]
\`\`\`

---

## 11. Social networks

Drop a public URL inside an \`embed\` fence and Lumen renders the platform's
own embed widget. Below: an iconic post from each supported platform —
the URLs are real, you can copy them anywhere.

**Video & audio**

🎵 **YouTube** — Rick Astley, *"Never Gonna Give You Up"* (1.6 B views, the rickroll)

\`\`\`embed
https://www.youtube.com/watch?v=dQw4w9WgXcQ
\`\`\`

🎬 **Vimeo** — *"Move"*, Rick Mereki's iconic 44-day, 11-country travel film

\`\`\`embed
https://vimeo.com/22439234
\`\`\`

🎙️ **Loom** — Loom's own product walkthrough

\`\`\`embed
https://www.loom.com/share/c43a642f815f4378b6f80a889bb73d8d
\`\`\`

🎶 **Spotify** — Queen, *"Bohemian Rhapsody"* (one of the most-streamed 20th-century songs)

\`\`\`embed
https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb
\`\`\`

🎧 **SoundCloud** — Forss, *"Flickermood"* (10 M plays)

\`\`\`embed
https://soundcloud.com/forss/flickermood
\`\`\`

**Code & design**

🖌️ **CodePen** — Hakim El Hattab's interactive shader demo

\`\`\`embed
https://codepen.io/hakimel/pen/BKyJpM
\`\`\`

🧪 **CodeSandbox** — fresh React quickstart sandbox

\`\`\`embed
https://codesandbox.io/s/new
\`\`\`

🎨 **Figma Community** — official iOS 18 UI Kit

\`\`\`embed
https://www.figma.com/community/file/1394965242715869180
\`\`\`

🐙 **GitHub Gist** — the Octocat sample gist (rendered with syntax highlighting)

\`\`\`embed
https://gist.github.com/octocat/6cad326836d38bd3a7ae
\`\`\`

**Maps**

🗼 **Google Maps** — the Eiffel Tower, Paris

\`\`\`embed
https://www.google.com/maps/place/Eiffel+Tower
\`\`\`

📍 **OpenStreetMap** — Times Square, NYC (privacy-friendly alternative)

\`\`\`embed
https://www.openstreetmap.org/#map=18/40.7580/-73.9855
\`\`\`

**Conversations**

🐦 **X / Twitter** — Elon Musk, *"the bird is freed"* (Oct 28 2022, the Twitter takeover)

\`\`\`embed
https://twitter.com/elonmusk/status/1585841080431321088
\`\`\`

🐣 **X / Twitter** — Jack Dorsey's first tweet ever, *"just setting up my twttr"* (Mar 21 2006)

\`\`\`embed
https://twitter.com/jack/status/20
\`\`\`

📘 **Facebook** — NASA milestone post

\`\`\`embed
https://www.facebook.com/NASA/posts/10168891891030772
\`\`\`

📷 **Instagram** — \`@world_record_egg\` (the egg that broke Instagram's like record)

\`\`\`embed
https://www.instagram.com/p/BsOGulcndj-/
\`\`\`

🎵 **TikTok** — Bella Poarch, *"M to the B"* (most-liked TikTok ever, 65 M+ likes)

\`\`\`embed
https://www.tiktok.com/@bellapoarch/video/6862153058223197445
\`\`\`

👽 **Reddit** — Bill Gates' famous IAmA, *"I am Bill Gates, co-chair of the Bill & Melinda Gates Foundation"*

\`\`\`embed
https://www.reddit.com/r/IAmA/comments/6byns4/i_am_bill_gates_cochair_of_the_bill_melinda_gates/
\`\`\`

💼 **LinkedIn** — Reid Hoffman on the future of work

\`\`\`embed
https://www.linkedin.com/posts/reidhoffman_the-future-of-work-activity-7050231856721895424-Cf2T
\`\`\`

> **Tip** — paste any of these URLs on a blank line in the source pane and
> Lumen offers a one-click "wrap as embed" pill. Try it.

Happy writing. ✦
`;

