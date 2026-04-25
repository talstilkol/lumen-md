/** Block templates inserted by the command palette. */
export const BLOCK_SNIPPETS = {
  chart: `
\`\`\`chart
title:
  text: My chart
xAxis:
  type: category
  data: [Jan, Feb, Mar, Apr, May]
yAxis:
  type: value
series:
  - name: Sales
    type: bar
    data: [12, 19, 8, 15, 22]
\`\`\`
`,
  csv: `
\`\`\`csv title="Untitled dataset"
month,revenue,deals
Jan,4200,82
Feb,4800,90
Mar,5100,97
Apr,5800,108
\`\`\`
`,
  jsonTable: `
\`\`\`json-table title="Untitled JSON"
[
  { "name": "Alice", "score": 92, "team": "A" },
  { "name": "Bob",   "score": 81, "team": "B" },
  { "name": "Carol", "score": 88, "team": "A" }
]
\`\`\`
`,
  mermaid: `
\`\`\`mermaid
flowchart LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Path A]
  B -->|No| D[Path B]
  C --> E((End))
  D --> E
\`\`\`
`,
  map: `
\`\`\`map
zoom: 4
markers:
  - { lat: 40.7128, lng: -74.0060, label: "New York" }
  - { lat: 51.5074, lng: -0.1278,  label: "London" }
  - { lat: 35.6762, lng: 139.6503, label: "Tokyo" }
\`\`\`
`,
  math: `
$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$
`,
  note: `
:::note{title="Heads up"}
Write your callout here. Use \`:::tip\`, \`:::info\`, \`:::warning\`, or \`:::danger\` for other styles.
:::
`,
  graphviz: `
\`\`\`dot
digraph G {
  rankdir=LR;
  bgcolor="transparent";
  node [shape=box, style=rounded, color="#7c5cff", fontname="Inter"];
  Start -> Process -> End;
  Process -> Process [label="loop"];
}
\`\`\`
`,
  abc: `
\`\`\`abc
X:1
T:Lumen Theme
M:4/4
L:1/8
K:G
|:GABc dedB | dedB dedB | c2ec B2dB | A2EA B2EA |
GABc dedB | dedB dedB | c2ec B2dB |1 A2BG AGEG :|2 A2BG AGEG ||
\`\`\`
`,
  model: `
\`\`\`model
src: https://modelviewer.dev/shared-assets/models/Astronaut.glb
alt: Astronaut
autoRotate: true
\`\`\`
`,
  plantuml: `
\`\`\`plantuml
@startuml
actor User
participant "Lumen App" as App
database "OPFS" as DB
User -> App: edit document
App -> DB: persist
DB --> App: ok
App --> User: rendered preview
@enduml
\`\`\`
`,
  embed: `
\`\`\`embed
https://www.youtube.com/watch?v=dQw4w9WgXcQ
\`\`\`
`,
  wikilink: "[[Target Page|optional label]]",
  bibtex: `
\`\`\`bibtex
@article{einstein1905,
  author  = {Albert Einstein},
  title   = {On the electrodynamics of moving bodies},
  journal = {Annalen der Physik},
  year    = {1905},
  doi     = {10.1002/andp.19053221004}
}

@book{knuth1997,
  author    = {Donald E. Knuth},
  title     = {The Art of Computer Programming, Volume 1},
  publisher = {Addison-Wesley},
  year      = {1997}
}
\`\`\`
`,
  htmlpreview: `
\`\`\`htmlpreview height=320 title="Live HTML"
<style>
  body { display: grid; place-items: center; height: 100vh; margin: 0;
         font-family: system-ui, sans-serif;
         background: linear-gradient(135deg, #7c5cff 0%, #22d3ee 100%); color: white; }
  h1 { font-size: 3rem; letter-spacing: -0.02em; }
  button { padding: 0.5rem 1rem; border-radius: 999px; border: 0;
           background: white; color: #7c5cff; font-weight: 600;
           cursor: pointer; }
</style>
<h1 id="t">Hello, Lumen 👋</h1>
<button onclick="document.getElementById('t').textContent='Hello again!'">
  Click me
</button>
\`\`\`
`,
};
