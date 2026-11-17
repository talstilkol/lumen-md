/**
 * User-text isolation check (plan W13.H4).
 *
 * A surface is a place in the interface that shows a user's string — a note
 * name, a path, a tag, a heading, a search snippet, an author. In each, the
 * JSX expression that prints the string must sit directly in an isolating
 * element: <bdi>, or any element with a `dir` attribute (dir="auto" picks
 * the string's own direction). Then "פתק (2).md" keeps its brackets and
 * "README.md" stays readable in a Hebrew interface, and "שלום world 123"
 * does not drag the English interface around it.
 *
 * `checkSurface` finds every `{expr}` child in the file. A surface whose
 * expression is no longer there fails too, so the inventory cannot go stale
 * and pass by finding nothing.
 */
import ts from "typescript";

function nearestElement(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) return p.openingElement;
    if (ts.isJsxSelfClosingElement(p)) return p;
    if (ts.isJsxFragment(p)) return null;
  }
  return null;
}

function isolating(el) {
  if (!el) return false;
  const tag = el.tagName.getText();
  if (tag === "bdi") return true;
  return el.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "dir");
}

/**
 * @returns {{ found: number, bad: {line: number, text: string}[] }}
 */
export function checkSurface(fileName, text, expr) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = 0;
  const bad = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression && node.expression.getText(sf) === expr && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      found++;
      const el = nearestElement(node);
      if (!isolating(el)) bad.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: `<${el ? el.tagName.getText() : "fragment"}>{${expr}}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { found, bad };
}
