/**
 * Test fixtures shaped like the two reference MCP servers (plan W10.C1/C2):
 * `@modelcontextprotocol/server-everything` and
 * `@modelcontextprotocol/server-filesystem`.
 *
 * SYNTHETIC. These are not the real servers (the npm registry is offline
 * here): they carry the real servers' tool names and argument shapes as
 * published in their READMEs, and speak the 2026-07-28 protocol the way our
 * client needs to be tested against — `server/discover`, `_meta` on every
 * request, `resultType`, MRTR `input_required` with `requestState`, and a
 * legacy `initialize` fallback. The real servers are the owner's check
 * (PR body, "Not verified here").
 *
 * Plain JavaScript so the same code serves in process (tests) and over real
 * stdio (`stdioMain.mjs`, a child process).
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const MODERN = "2026-07-28";
const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
};

const text = (t) => ({ content: [{ type: "text", text: t }] });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
const obj = (properties, required = []) => ({ type: "object", properties, required });
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

/** The protocol frame both fixtures share. `tools` is a list; `call(name, args, params, caps)` returns a result. */
function server({ name, tools, call, log = () => {} }) {
  let legacy = false;
  return {
    name,
    tools,
    /** Mutate a tool's definition (the rug-pull test): the next tools/list shows it. */
    setTool(toolName, patch) {
      const i = tools.findIndex((t) => t.name === toolName);
      if (i >= 0) tools[i] = { ...tools[i], ...patch };
    },
    log: [],
    async handle(msg) {
      this.log.push(msg);
      if (msg.id === undefined) return null; // notifications: nothing to answer
      const params = msg.params ?? {};
      if (msg.method === "initialize") {
        legacy = true;
        return ok(msg.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name, version: "fixture" } });
      }
      const meta = params._meta ?? {};
      if (!legacy) {
        if (msg.method === "server/discover") {
          return ok(msg.id, { resultType: "complete", supportedVersions: [MODERN, "2025-11-25"], capabilities: { tools: { listChanged: true } }, serverInfo: { name, version: "fixture" } });
        }
        if (meta[META.protocolVersion] !== MODERN) return fail(msg.id, -32602, "missing _meta protocolVersion");
        if (!meta[META.clientCapabilities] || typeof meta[META.clientCapabilities] !== "object") return fail(msg.id, -32602, "missing _meta clientCapabilities");
      }
      const caps = meta[META.clientCapabilities] ?? {};
      if (msg.method === "tools/list") return ok(msg.id, { ...(legacy ? {} : { resultType: "complete", ttlMs: 5000, cacheScope: "private" }), tools: tools.map((t) => ({ ...t })) });
      if (msg.method === "tools/call") {
        const tool = tools.find((t) => t.name === params.name);
        if (!tool) return fail(msg.id, -32602, `Unknown tool: ${params.name}`);
        try {
          const r = await call(tool.name, params.arguments ?? {}, params, caps);
          log(`called ${tool.name}`);
          return ok(msg.id, legacy || r.resultType ? r : { resultType: "complete", ...r });
        } catch (e) {
          return ok(msg.id, { resultType: "complete", ...text(String(e?.message ?? e)), isError: true });
        }
      }
      return fail(msg.id, -32601, "Method not found");
    },
  };
}

/** Shaped like server-everything: echo, add, a tiny image, an annotated message, and elicitation (form and URL). */
export function everythingServer(o = {}) {
  const tools = [
    { name: "echo", description: "Echoes back the input", inputSchema: obj({ message: str("Message to echo") }, ["message"]), annotations: { readOnlyHint: true } },
    { name: "add", description: "Adds two numbers", inputSchema: obj({ a: num("First number"), b: num("Second number") }, ["a", "b"]), annotations: { readOnlyHint: true } },
    { name: "longRunningOperation", description: "Demonstrates a long running operation with progress updates", inputSchema: obj({ duration: num("Duration of the operation in seconds"), steps: num("Number of steps in the operation") }) },
    { name: "getTinyImage", description: "Returns the MCP_TINY_IMAGE", inputSchema: obj({}), annotations: { readOnlyHint: true } },
    { name: "annotatedMessage", description: "Demonstrates how annotations can be used to provide metadata about content", inputSchema: obj({ messageType: { type: "string", enum: ["error", "success", "debug"] }, includeImage: { type: "boolean" } }, ["messageType"]) },
    { name: "startElicitation", description: "Demonstrates the Elicitation feature by asking the user to provide information about their favorite color, number, and pets.", inputSchema: obj({}) },
    { name: "authorizeService", description: "Asks the user to open a page to connect a third-party service (URL-mode elicitation)", inputSchema: obj({ service: str("Service to connect") }) },
  ];
  const url = o.url ?? "https://auth.example.com/connect?flow=abc";
  return server({
    name: "example-servers/everything",
    tools,
    log: o.log,
    async call(name, args, params, caps) {
      if (name === "echo") return text(`Echo: ${args.message}`);
      if (name === "add") return text(`The sum of ${args.a} and ${args.b} is ${Number(args.a) + Number(args.b)}.`);
      if (name === "longRunningOperation") return text(`Long running operation completed. Duration: ${args.duration ?? 10} seconds, Steps: ${args.steps ?? 5}.`);
      if (name === "getTinyImage") return { content: [{ type: "text", text: "This is a tiny image:" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] };
      if (name === "annotatedMessage") return text(args.messageType === "error" ? "Error: Operation failed" : args.messageType === "success" ? "Operation completed successfully" : "Debug: Cache hit ratio 0.95");
      const elicit = caps.elicitation;
      if (name === "startElicitation" || name === "authorizeService") {
        const mode = name === "startElicitation" ? "form" : "url";
        // Servers MUST NOT send a mode the client did not declare: no capability, no request.
        const declared = elicit && typeof elicit === "object" && (mode === "form" ? Object.keys(elicit).length === 0 || "form" in elicit : "url" in elicit);
        if (!declared) return { ...text("This client does not support elicitation."), isError: true };
        const answer = params.inputResponses?.ask;
        if (params.requestState !== undefined && params.requestState !== `state-${mode}-1`) return { ...text("requestState was changed"), isError: true };
        if (!answer) {
          const request =
            mode === "form"
              ? { method: "elicitation/create", params: { mode: "form", message: "Please provide inputs for the following fields:", requestedSchema: obj({ color: { type: "string", title: "Favorite color" }, number: { type: "integer", title: "Favorite number", minimum: 1, maximum: 100 }, pets: { type: "string", title: "Favorite pet", enum: ["cats", "dogs", "birds", "fish", "reptiles"] } }, ["color"]) } }
              : { method: "elicitation/create", params: { mode: "url", message: `Connect ${args.service ?? "the service"} to continue.`, url } };
          return { resultType: "input_required", inputRequests: { ask: request }, requestState: `state-${mode}-1` };
        }
        if (answer.action === "accept") return text(mode === "form" ? `User provided: ${JSON.stringify(answer.content)}` : "Connected.");
        return text(`User ${answer.action === "decline" ? "declined" : "cancelled"} the request.`);
      }
      return { ...text(`no ${name}`), isError: true };
    },
  });
}

/** Shaped like server-filesystem: the tools of its README, confined to the allowed folders. */
export function filesystemServer(roots, o = {}) {
  const allowed = roots.map((r) => resolve(r));
  const inside = (p) => {
    const full = resolve(allowed[0], String(p ?? ""));
    if (!allowed.some((r) => full === r || full.startsWith(r + sep))) throw new Error(`Access denied - path outside allowed directories: ${p}`);
    return full;
  };
  const pathArg = obj({ path: str("Path") }, ["path"]);
  const tools = [
    { name: "read_text_file", description: "Read the complete contents of a file from the file system as text.", inputSchema: obj({ path: str("Path"), head: num("First N lines"), tail: num("Last N lines") }, ["path"]), annotations: { readOnlyHint: true } },
    { name: "read_multiple_files", description: "Read the contents of multiple files simultaneously.", inputSchema: obj({ paths: { type: "array", items: { type: "string" } } }, ["paths"]), annotations: { readOnlyHint: true } },
    { name: "write_file", description: "Create a new file or completely overwrite an existing file with new content.", inputSchema: obj({ path: str("Path"), content: str("Content") }, ["path", "content"]), annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "edit_file", description: "Make line-based edits to a text file.", inputSchema: obj({ path: str("Path"), edits: { type: "array", items: obj({ oldText: str("Text to search for"), newText: str("Text to replace with") }, ["oldText", "newText"]) }, dryRun: { type: "boolean" } }, ["path", "edits"]), annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "create_directory", description: "Create a new directory or ensure a directory exists.", inputSchema: pathArg, annotations: { readOnlyHint: false } },
    { name: "list_directory", description: "Get a detailed listing of all files and directories in a specified path.", inputSchema: pathArg, annotations: { readOnlyHint: true } },
    { name: "directory_tree", description: "Get a recursive tree view of files and directories as a JSON structure.", inputSchema: pathArg, annotations: { readOnlyHint: true } },
    { name: "move_file", description: "Move or rename files and directories.", inputSchema: obj({ source: str("Source"), destination: str("Destination") }, ["source", "destination"]), annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "search_files", description: "Recursively search for files and directories matching a pattern.", inputSchema: obj({ path: str("Path"), pattern: str("Pattern") }, ["path", "pattern"]), annotations: { readOnlyHint: true } },
    { name: "get_file_info", description: "Retrieve detailed metadata about a file or directory.", inputSchema: pathArg, annotations: { readOnlyHint: true } },
    { name: "list_allowed_directories", description: "Returns the list of directories that this server is allowed to access.", inputSchema: obj({}), annotations: { readOnlyHint: true } },
  ];
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? { name: e.name, type: "directory", children: walk(join(dir, e.name)) } : { name: e.name, type: "file" }));
  return server({
    name: "secure-filesystem-server",
    tools,
    log: o.log,
    async call(name, args) {
      switch (name) {
        case "read_text_file": {
          const lines = readFileSync(inside(args.path), "utf8").split("\n");
          return text((args.head ? lines.slice(0, args.head) : args.tail ? lines.slice(-args.tail) : lines).join("\n"));
        }
        case "read_multiple_files":
          return text((args.paths ?? []).map((p) => `${p}:\n${readFileSync(inside(p), "utf8")}`).join("\n---\n"));
        case "write_file":
          writeFileSync(inside(args.path), String(args.content));
          return text(`Successfully wrote to ${args.path}`);
        case "edit_file": {
          const f = inside(args.path);
          let s = readFileSync(f, "utf8");
          for (const e of args.edits ?? []) {
            if (!s.includes(e.oldText)) throw new Error(`Could not find exact match for edit:\n${e.oldText}`);
            s = s.replace(e.oldText, e.newText);
          }
          if (!args.dryRun) writeFileSync(f, s);
          return text(args.dryRun ? "Dry run: edits apply" : `Edited ${args.path}`);
        }
        case "create_directory":
          mkdirSync(inside(args.path), { recursive: true });
          return text(`Successfully created directory ${args.path}`);
        case "list_directory":
          return text(readdirSync(inside(args.path), { withFileTypes: true }).map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n"));
        case "directory_tree":
          return text(JSON.stringify(walk(inside(args.path)), null, 2));
        case "move_file":
          renameSync(inside(args.source), inside(args.destination));
          return text(`Successfully moved ${args.source} to ${args.destination}`);
        case "search_files": {
          const out = [];
          const go = (d) => {
            for (const e of readdirSync(d, { withFileTypes: true })) {
              const full = join(d, e.name);
              if (e.name.toLowerCase().includes(String(args.pattern).toLowerCase())) out.push(relative(allowed[0], full));
              if (e.isDirectory()) go(full);
            }
          };
          go(inside(args.path));
          return text(out.length ? out.join("\n") : "No matches found");
        }
        case "get_file_info": {
          const st = statSync(inside(args.path));
          return text(`size: ${st.size}\nisDirectory: ${st.isDirectory()}\nisFile: ${st.isFile()}`);
        }
        case "list_allowed_directories":
          return text(`Allowed directories:\n${allowed.join("\n")}`);
      }
      return { ...text(`no ${name}`), isError: true };
    },
  });
}
