/**
 * Source-mode "Insert" menu — opened with `/` at the start of an empty line
 * (Notion-style slash menu) or with `⌘/`. Lists every block language and
 * social-network embed Lumen ships with; selecting an entry inserts the
 * matching template at the cursor and closes the menu.
 */

import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

interface MenuEntry {
  id: string;
  label: string;
  hint: string;
  group: string;
  /** Markdown to insert. Cursor lands on the line marked with `[CURSOR]`. */
  template: string;
}

const ENTRIES: MenuEntry[] = [
  // ─── Tables & data ─────────────────────────────────────────────────
  {
    id: "csv",
    label: "CSV table",
    hint: "Sortable table + auto chart",
    group: "Data",
    template: '```csv title="Untitled"\nmonth,revenue\nJan,4200\nFeb,4800\nMar,5100\n```',
  },
  {
    id: "tsv",
    label: "TSV table",
    hint: "Tab-separated values",
    group: "Data",
    template: '```tsv\nname\tscore\nAlice\t92\nBob\t81\n```',
  },
  {
    id: "json-table",
    label: "JSON table",
    hint: "Array of objects → table",
    group: "Data",
    template: '```json-table\n[\n  { "name": "Alice", "score": 92 },\n  { "name": "Bob",   "score": 81 }\n]\n```',
  },
  {
    id: "sql",
    label: "SQL → table",
    hint: "INSERT statements → DataTable",
    group: "Data",
    template: '```sql\nCREATE TABLE sales (date TEXT, region TEXT, revenue REAL);\nINSERT INTO sales VALUES\n  (\'2026-01-01\', \'North\', 1240.50),\n  (\'2026-01-02\', \'South\',  980.00);\n```',
  },
  {
    id: "database",
    label: "Database view",
    hint: "Notion-style Kanban / Gallery / Calendar over your notes",
    group: "Data",
    template:
      '```database\nsource: ""\ntype: book\nview: kanban\ngroupBy: status\nsortBy: -rating\nfields: [title, author, rating, status]\n```',
  },
  {
    id: "pandas",
    label: "Pandas DataFrame",
    hint: "print(df) output → table",
    group: "Data",
    template: '```pandas\n    date        region   revenue\n0   2026-01-01  North     1240.5\n1   2026-01-02  South      980.0\n```',
  },
  {
    id: "object",
    label: "JS / JSON5 object",
    hint: "Unquoted keys & comments OK",
    group: "Data",
    template: '```object\n[\n  { product: "Lumen Pro", signups: 1240 },\n  { product: "Lumen Team", signups:  480 },\n]\n```',
  },
  {
    id: "data",
    label: "Auto-detect data",
    hint: "Sniff SQL / JSON / pandas",
    group: "Data",
    template: '```data\n[paste SQL, JSON, or pandas output here]\n```',
  },
  {
    id: "chart",
    label: "ECharts chart",
    hint: "Explicit YAML/JSON spec",
    group: "Data",
    template: '```chart\ntitle:\n  text: My chart\nxAxis: { type: category, data: [Jan, Feb, Mar] }\nyAxis: { type: value }\nseries:\n  - name: Sales\n    type: bar\n    data: [12, 19, 8]\n```',
  },

  // ─── Diagrams ──────────────────────────────────────────────────────
  {
    id: "mermaid",
    label: "Mermaid diagram",
    hint: "Flowchart / sequence / gantt",
    group: "Diagrams",
    template: '```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Path A]\n  B -->|No| D[Path B]\n```',
  },
  {
    id: "graphviz",
    label: "Graphviz / DOT",
    hint: "WASM-rendered locally",
    group: "Diagrams",
    template: '```dot\ndigraph G {\n  rankdir=LR;\n  A -> B -> C;\n  A -> C;\n}\n```',
  },
  {
    id: "plantuml",
    label: "PlantUML",
    hint: "Rendered via kroki.io",
    group: "Diagrams",
    template: '```plantuml\n@startuml\nAlice -> Bob: Hello\nBob --> Alice: Hi!\n@enduml\n```',
  },

  // ─── Media ─────────────────────────────────────────────────────────
  {
    id: "map",
    label: "Map (Leaflet)",
    hint: "lat/lng markers",
    group: "Media",
    template: '```map\nzoom: 4\nmarkers:\n  - { lat: 40.7128, lng: -74.0060, label: "New York" }\n  - { lat: 51.5074, lng: -0.1278,  label: "London" }\n```',
  },
  {
    id: "geojson",
    label: "GeoJSON map",
    hint: "FeatureCollection",
    group: "Media",
    template: '```geojson\n{\n  "type": "FeatureCollection",\n  "features": []\n}\n```',
  },
  {
    id: "abc",
    label: "Music notation (ABC)",
    hint: "Sheet music",
    group: "Media",
    template: '```abc\nX:1\nT:Lumen Theme\nM:4/4\nL:1/8\nK:G\n|:GABc dedB | dedB dedB :|\n```',
  },
  {
    id: "model",
    label: "3D model",
    hint: ".glb / .gltf via model-viewer",
    group: "Media",
    template: '```model\nsrc: https://modelviewer.dev/shared-assets/models/Astronaut.glb\nposter:\n```',
  },
  {
    id: "htmlpreview",
    label: "Live HTML / CSS / JS",
    hint: "Sandboxed iframe",
    group: "Media",
    template: '```htmlpreview height=320 title="Demo"\n<style>\n  body { display: grid; place-items: center; height: 100vh; font-family: system-ui; }\n</style>\n<h1>Hello, Lumen ✨</h1>\n```',
  },
  {
    id: "live-css",
    label: "Live CSS",
    hint: "Style a card preview live",
    group: "Media",
    template: '```live-css\n.card {\n  padding: 24px;\n  border-radius: 12px;\n  background: linear-gradient(135deg, #7c5cff, #22d3ee);\n  color: white;\n  font-family: Inter, system-ui;\n}\n.btn {\n  margin-top: 12px;\n  padding: 8px 16px;\n  border-radius: 999px;\n  border: 0;\n  background: white;\n  color: #6d4cff;\n  font-weight: 600;\n}\n```',
  },
  {
    id: "live-js",
    label: "Live JavaScript",
    hint: "Sandbox + console output",
    group: "Media",
    template: '```live-js height=200\nconst sum = (a, b) => a + b;\nconsole.log("2 + 2 =", sum(2, 2));\nfor (let i = 0; i < 3; i++) console.log("tick", i);\n```',
  },
  {
    id: "live-svg",
    label: "Live SVG",
    hint: "Inline vector graphics",
    group: "Media",
    template: '```live-svg height=240\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">\n  <defs>\n    <radialGradient id="g">\n      <stop offset="0%" stop-color="#7c5cff" />\n      <stop offset="100%" stop-color="#22d3ee" />\n    </radialGradient>\n  </defs>\n  <circle cx="100" cy="100" r="80" fill="url(#g)" />\n  <text x="100" y="105" text-anchor="middle" fill="white" font-family="Inter" font-size="20">Lumen</text>\n</svg>\n```',
  },
  {
    id: "live-glsl",
    label: "Live GLSL shader",
    hint: "ShaderToy-style fragment shader",
    group: "Media",
    template: '```live-glsl height=280\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / iResolution.xy;\n  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));\n  gl_FragColor = vec4(col, 1.0);\n}\n```',
  },

  // ─── Math & references ─────────────────────────────────────────────
  {
    id: "math",
    label: "Math block",
    hint: "Display KaTeX",
    group: "Math & references",
    template: '$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$',
  },
  {
    id: "callout",
    label: "Callout / admonition",
    hint: ":::note, :::tip, …",
    group: "Math & references",
    template: ':::note\nHelpful context goes here.\n:::',
  },
  {
    id: "bibtex",
    label: "BibTeX bibliography",
    hint: "Numbered references",
    group: "Math & references",
    template: '```bibtex\n@article{einstein1905,\n  title  = {On the Electrodynamics of Moving Bodies},\n  author = {Einstein, Albert},\n  year   = 1905\n}\n```',
  },
  {
    id: "wiki",
    label: "Wiki-link",
    hint: "[[Page name]]",
    group: "Math & references",
    template: '[[Page name|optional label]]',
  },

  // ─── Social networks (embed fences) ────────────────────────────────
  {
    id: "yt",
    label: "YouTube",
    hint: "Video / Short",
    group: "Social",
    template: '```embed\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n```',
  },
  {
    id: "vimeo",
    label: "Vimeo",
    hint: "Video",
    group: "Social",
    template: '```embed\nhttps://vimeo.com/76979871\n```',
  },
  {
    id: "loom",
    label: "Loom",
    hint: "Recording",
    group: "Social",
    template: '```embed\nhttps://www.loom.com/share/<id>\n```',
  },
  {
    id: "spotify",
    label: "Spotify",
    hint: "Track / album",
    group: "Social",
    template: '```embed\nhttps://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT\n```',
  },
  {
    id: "soundcloud",
    label: "SoundCloud",
    hint: "Track",
    group: "Social",
    template: '```embed\nhttps://soundcloud.com/<artist>/<track>\n```',
  },
  {
    id: "codepen",
    label: "CodePen",
    hint: "Pen embed",
    group: "Social",
    template: '```embed\nhttps://codepen.io/<user>/pen/<id>\n```',
  },
  {
    id: "codesandbox",
    label: "CodeSandbox",
    hint: "Sandbox",
    group: "Social",
    template: '```embed\nhttps://codesandbox.io/s/<id>\n```',
  },
  {
    id: "figma",
    label: "Figma",
    hint: "File / proto / design",
    group: "Social",
    template: '```embed\nhttps://www.figma.com/file/<id>/Untitled\n```',
  },
  {
    id: "gmaps",
    label: "Google Maps",
    hint: "Place / directions",
    group: "Social",
    template: '```embed\nhttps://www.google.com/maps/place/Tel+Aviv-Yafo/@32.0853,34.7818,12z\n```',
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    hint: "Open-source map",
    group: "Social",
    template: '```embed\nhttps://www.openstreetmap.org/#map=12/32.0853/34.7818\n```',
  },
  {
    id: "x",
    label: "X (Twitter)",
    hint: "Tweet embed",
    group: "Social",
    template: '```embed\nhttps://twitter.com/<user>/status/<id>\n```',
  },
  {
    id: "fb",
    label: "Facebook",
    hint: "Post / video",
    group: "Social",
    template: '```embed\nhttps://www.facebook.com/<page>/posts/<id>\n```',
  },
  {
    id: "ig",
    label: "Instagram",
    hint: "Post / reel",
    group: "Social",
    template: '```embed\nhttps://www.instagram.com/p/<shortcode>/\n```',
  },
  {
    id: "tiktok",
    label: "TikTok",
    hint: "Video",
    group: "Social",
    template: '```embed\nhttps://www.tiktok.com/@<user>/video/<id>\n```',
  },
  {
    id: "reddit",
    label: "Reddit",
    hint: "Thread",
    group: "Social",
    template: '```embed\nhttps://www.reddit.com/r/<sub>/comments/<id>/\n```',
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    hint: "Post embed URN",
    group: "Social",
    template: '```embed\nhttps://www.linkedin.com/embed/feed/update/urn:li:share:<id>\n```',
  },
  {
    id: "gist",
    label: "GitHub Gist",
    hint: "Code snippet",
    group: "Social",
    template: '```embed\nhttps://gist.github.com/<user>/<id>\n```',
  },
];

interface MenuState {
  view: EditorView;
  triggerFrom: number; // doc position of the slash that opened the menu
  query: string;
  highlight: number;
}

let openMenu: { container: HTMLElement; state: MenuState } | null = null;

function close() {
  if (!openMenu) return;
  openMenu.container.remove();
  openMenu = null;
  document.removeEventListener("mousedown", onDocMouseDown, true);
}

function onDocMouseDown(e: MouseEvent) {
  if (!openMenu) return;
  if (!openMenu.container.contains(e.target as Node)) close();
}

function filtered(query: string): MenuEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ENTRIES;
  return ENTRIES.filter((e) =>
    `${e.label} ${e.hint} ${e.group} ${e.id}`.toLowerCase().includes(q),
  );
}

function insertEntry(view: EditorView, entry: MenuEntry, replaceFrom: number) {
  const replaceTo = view.state.selection.main.head;
  view.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert: entry.template + "\n" },
    selection: { anchor: replaceFrom + entry.template.length + 1 },
  });
  close();
  view.focus();
}

function render(state: MenuState) {
  if (!openMenu) return;
  const { container } = openMenu;
  container.innerHTML = "";

  const list = filtered(state.query);
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lumen-slash-empty";
    empty.textContent = "No matching block";
    container.appendChild(empty);
    return;
  }

  if (state.highlight >= list.length) state.highlight = 0;
  if (state.highlight < 0) state.highlight = list.length - 1;

  let lastGroup = "";
  list.forEach((entry, i) => {
    if (entry.group !== lastGroup) {
      const header = document.createElement("div");
      header.className = "lumen-slash-group";
      header.textContent = entry.group;
      container.appendChild(header);
      lastGroup = entry.group;
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lumen-slash-item";
    if (i === state.highlight) item.classList.add("active");
    item.innerHTML = `<span class="lumen-slash-label">${escape(entry.label)}</span><span class="lumen-slash-hint">${escape(entry.hint)}</span>`;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      insertEntry(state.view, entry, state.triggerFrom);
    });
    item.addEventListener("mouseenter", () => {
      state.highlight = i;
      render(state);
    });
    container.appendChild(item);
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function open(view: EditorView, triggerFrom: number) {
  close();
  const container = document.createElement("div");
  container.className = "lumen-slash-menu";
  container.setAttribute("role", "menu");
  // Position next to the cursor.
  const coords = view.coordsAtPos(triggerFrom);
  if (coords) {
    container.style.position = "fixed";
    container.style.top = `${coords.bottom + 4}px`;
    container.style.left = `${coords.left}px`;
  }
  document.body.appendChild(container);

  const state: MenuState = { view, triggerFrom, query: "", highlight: 0 };
  openMenu = { container, state };
  document.addEventListener("mousedown", onDocMouseDown, true);
  render(state);
}

function syncQueryFromDoc(): boolean {
  if (!openMenu) return false;
  const { state } = openMenu;
  const head = state.view.state.selection.main.head;
  if (head < state.triggerFrom) {
    close();
    return true;
  }
  state.query = state.view.state.doc.sliceString(state.triggerFrom + 1, head);
  render(state);
  return true;
}

export function insertSlashMenuExtension(): Extension {
  return [
    keymap.of([
      {
        // Auto-trigger: pressing `/` at the start of an otherwise empty line
        // opens the menu. Typing past it filters; backspace before the slash
        // closes it. (We don't bind ⌘/ here because the app reserves it for
        // the keyboard-shortcuts dialog.)
        key: "/",
        run(view) {
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          const before = view.state.doc.sliceString(line.from, head).trimStart();
          if (before === "") {
            // Insert the literal slash so the user sees it, then open.
            view.dispatch({
              changes: { from: head, insert: "/" },
              selection: { anchor: head + 1 },
            });
            open(view, head);
            return true;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run() {
          if (!openMenu) return false;
          close();
          return true;
        },
      },
      {
        key: "ArrowDown",
        run() {
          if (!openMenu) return false;
          openMenu.state.highlight++;
          render(openMenu.state);
          return true;
        },
      },
      {
        key: "ArrowUp",
        run() {
          if (!openMenu) return false;
          openMenu.state.highlight--;
          render(openMenu.state);
          return true;
        },
      },
      {
        key: "Enter",
        run(view) {
          if (!openMenu) return false;
          const list = filtered(openMenu.state.query);
          const entry = list[openMenu.state.highlight];
          if (entry) insertEntry(view, entry, openMenu.state.triggerFrom);
          return true;
        },
      },
      {
        key: "Backspace",
        run() {
          if (!openMenu) return false;
          // Let CodeMirror perform the actual deletion; sync query afterwards.
          requestAnimationFrame(() => syncQueryFromDoc());
          return false;
        },
      },
    ]),
    // Whenever the doc changes while the menu is open, re-read the query so
    // the filter list stays in sync with what the user has typed past `/`.
    EditorView.updateListener.of((u) => {
      if (!openMenu) return;
      if (u.docChanged) syncQueryFromDoc();
    }),
  ];
}
