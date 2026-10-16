/**
 * Lumen for VS Code — "Lumen: Open Preview" renders the active Markdown file
 * with Lumen's Markdown dialect (see ./render.ts) in a webview beside the
 * editor, re-rendering as you type and following the active editor.
 */
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { renderPreviewDocument } from "./render";

let panel: vscode.WebviewPanel | undefined;
let currentDoc: vscode.TextDocument | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

function isMarkdown(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  return !!doc && (doc.languageId === "markdown" || /\.(md|markdown)$/i.test(doc.fileName));
}

function render(context: vscode.ExtensionContext): void {
  if (!panel || !currentDoc) return;
  const webview = panel.webview;
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", f)).toString();
  panel.title = `Lumen: ${basename(currentDoc.fileName)}`;
  // The webview may only load files under its localResourceRoots; make sure
  // the current document's folder is one (it may sit outside the workspace).
  const docDir = vscode.Uri.joinPath(currentDoc.uri, "..");
  const roots = webview.options.localResourceRoots ?? [];
  if (!roots.some((r) => r.toString() === docDir.toString())) {
    webview.options = { ...webview.options, localResourceRoots: [...roots, docDir] };
  }
  webview.html = renderPreviewDocument(currentDoc.getText(), {
    nonce: randomBytes(16).toString("base64"),
    cspSource: webview.cspSource,
    styleUri: media("preview.css"),
    katexCssUri: media("katex/katex.min.css"),
    scriptUri: media("preview.js"),
    title: basename(currentDoc.fileName),
    resourceBaseUri: webview.asWebviewUri(docDir).toString(),
  });
}

function scheduleRender(context: vscode.ExtensionContext): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => render(context), 200);
}

function openPreview(context: vscode.ExtensionContext): void {
  const doc = vscode.window.activeTextEditor?.document;
  if (!isMarkdown(doc)) {
    void vscode.window.showInformationMessage("Lumen: open a Markdown file to preview it.");
    return;
  }
  currentDoc = doc;
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
  } else {
    const roots = [vscode.Uri.joinPath(context.extensionUri, "media")];
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (folder) roots.push(folder.uri);
    panel = vscode.window.createWebviewPanel(
      "lumen.preview",
      "Lumen Preview",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: roots },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      currentDoc = undefined;
    }, null, context.subscriptions);
  }
  render(context);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("lumen.openPreview", () => openPreview(context)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (panel && e.document === currentDoc) scheduleRender(context);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (panel && isMarkdown(editor?.document) && editor!.document !== currentDoc) {
        currentDoc = editor!.document;
        render(context);
      }
    }),
  );
}

export function deactivate(): void {
  if (pending) clearTimeout(pending);
  panel?.dispose();
}
