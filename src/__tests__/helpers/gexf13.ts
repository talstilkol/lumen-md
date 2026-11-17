/**
 * The rules of the GEXF 1.3 schema (gexf.net/1.3: gexf.xsd, data.xsd,
 * viz.xsd) that a file written by `sceneToGexf` touches, checked on a
 * parsed document: element names and nesting in schema order, required
 * attributes, the attribute types (`attribute/@type`, `attvalue/@for`
 * pointing at a declared id, values of the declared type), viz colours in
 * 0–255 with alpha in 0–1, numeric positions and sizes, edge ends that are
 * node ids, and unique ids.
 *
 * Not the official XSD: the session's network refused gexf.net (W13.G12
 * evidence), so the schema check against the real gexf.xsd is owed (the
 * owner, or Gephi Lite opening the file).
 */
const NS = "http://gexf.net/1.3";
const VIZ = "http://gexf.net/1.3/viz";
const TYPES = new Set(["integer", "long", "double", "float", "boolean", "liststring", "string", "anyURI", "date", "listboolean", "listinteger", "listlong", "listdouble", "listfloat", "liststring"]);

/** The local name without a prefix (some DOMs keep "viz:position" as the local name). */
export const localOf = (el: Element) => (el.localName ?? el.tagName).replace(/^.*:/, "");
const isViz = (el: Element) => el.namespaceURI === VIZ || el.prefix === "viz" || el.tagName.startsWith("viz:");

export function gexf13Problems(doc: Document): string[] {
  const p: string[] = [];
  const kids = (el: Element) => Array.from(el.children);
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length) return ["not well-formed XML"];
  if (localOf(root) !== "gexf" || root.namespaceURI !== NS) p.push(`root is ${root.namespaceURI} ${localOf(root)}`);
  if (root.getAttribute("version") !== "1.3") p.push("gexf/@version is not 1.3");
  const top = kids(root).map((e) => localOf(e));
  if (top.filter((n) => n === "graph").length !== 1) p.push("gexf needs exactly one graph");
  if (top.some((n) => n !== "meta" && n !== "graph")) p.push(`gexf child not allowed: ${top}`);
  if (top[0] === "graph" && top.includes("meta")) p.push("meta must come before graph");
  const meta = kids(root).find((e) => localOf(e) === "meta");
  if (meta) {
    const d = meta.getAttribute("lastmodifieddate");
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) p.push("meta/@lastmodifieddate is not xs:date");
    for (const c of kids(meta)) if (!["creator", "keywords", "description", "title"].includes(localOf(c))) p.push(`meta child not allowed: ${localOf(c)}`);
  }
  const graph = kids(root).find((e) => localOf(e) === "graph");
  if (!graph) return p;
  const det = graph.getAttribute("defaultedgetype");
  if (det && !["directed", "undirected", "mutual"].includes(det)) p.push("graph/@defaultedgetype");
  const mode = graph.getAttribute("mode");
  if (mode && !["static", "dynamic"].includes(mode)) p.push("graph/@mode");
  const order = kids(graph).map((e) => localOf(e));
  const rank = (n: string) => ({ attributes: 0, nodes: 1, edges: 2 })[n] ?? -1;
  order.forEach((n, i) => {
    if (rank(n) < 0) p.push(`graph child not allowed: ${n}`);
    if (i && rank(order[i - 1]) > rank(n)) p.push("graph children out of order");
  });
  const declared: Record<string, Map<string, string>> = { node: new Map(), edge: new Map() };
  for (const a of kids(graph).filter((e) => localOf(e) === "attributes")) {
    const cls = a.getAttribute("class");
    if (cls !== "node" && cls !== "edge") p.push("attributes/@class");
    for (const at of kids(a)) {
      if (localOf(at) !== "attribute") p.push(`attributes child: ${localOf(at)}`);
      const id = at.getAttribute("id");
      const type = at.getAttribute("type");
      if (!id || !at.getAttribute("title") || !type) p.push("attribute needs id, title and type");
      if (type && !TYPES.has(type)) p.push(`attribute type ${type}`);
      if (id && cls) declared[cls].set(id, type ?? "string");
    }
  }
  const valueOk = (type: string, v: string) =>
    type === "integer" || type === "long" ? /^-?\d+$/.test(v) : type === "double" || type === "float" ? v.trim() !== "" && Number.isFinite(Number(v)) : type === "boolean" ? v === "true" || v === "false" : true;
  const checkValues = (el: Element, cls: "node" | "edge") => {
    for (const av of kids(el).filter((e) => localOf(e) === "attvalues")) {
      for (const v of kids(av)) {
        if (localOf(v) !== "attvalue") p.push(`attvalues child: ${localOf(v)}`);
        const f = v.getAttribute("for");
        const val = v.getAttribute("value");
        if (!f || val === null) p.push("attvalue needs for and value");
        else if (!declared[cls].has(f)) p.push(`attvalue for undeclared ${f}`);
        else if (!valueOk(declared[cls].get(f)!, val)) p.push(`attvalue ${f}=${val} is not ${declared[cls].get(f)}`);
      }
    }
  };
  const ids = new Set<string>();
  const nodes = kids(graph).find((e) => localOf(e) === "nodes");
  for (const n of nodes ? kids(nodes) : []) {
    if (localOf(n) !== "node") p.push(`nodes child: ${localOf(n)}`);
    const id = n.getAttribute("id");
    if (!id) p.push("node without id");
    else if (ids.has(id)) p.push(`duplicate node id ${id}`);
    else ids.add(id);
    checkValues(n, "node");
    for (const c of kids(n)) {
      if (isViz(c)) {
        if (localOf(c) === "color") {
          for (const k of ["r", "g", "b"]) {
            const v = Number(c.getAttribute(k));
            if (!Number.isInteger(v) || v < 0 || v > 255) p.push(`viz:color/@${k}`);
          }
          const a = c.getAttribute("a");
          if (a !== null && !(Number(a) >= 0 && Number(a) <= 1)) p.push("viz:color/@a");
        } else if (localOf(c) === "position") {
          for (const k of ["x", "y"]) if (!Number.isFinite(Number(c.getAttribute(k))) || c.getAttribute(k) === null) p.push(`viz:position/@${k}`);
        } else if (localOf(c) === "size") {
          if (!(Number(c.getAttribute("value")) >= 0)) p.push("viz:size/@value");
        } else if (localOf(c) !== "shape" && localOf(c) !== "thickness") p.push(`viz element ${localOf(c)}`);
      } else if (!["attvalues", "spells", "nodes", "edges", "parents"].includes(localOf(c))) p.push(`node child: ${localOf(c)}`);
    }
  }
  const edges = kids(graph).find((e) => localOf(e) === "edges");
  const eids = new Set<string>();
  for (const e of edges ? kids(edges) : []) {
    if (localOf(e) !== "edge") p.push(`edges child: ${localOf(e)}`);
    const id = e.getAttribute("id");
    if (!id || eids.has(id)) p.push(`edge id missing or duplicate: ${id}`);
    else eids.add(id);
    for (const k of ["source", "target"]) if (!ids.has(e.getAttribute(k) ?? "")) p.push(`edge ${id} ${k} is not a node`);
    const w = e.getAttribute("weight");
    if (w !== null && !Number.isFinite(Number(w))) p.push("edge/@weight");
    checkValues(e, "edge");
  }
  return p;
}
