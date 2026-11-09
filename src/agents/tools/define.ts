import type { AgentTool, JsonSchema, ToolContext, ToolScope } from "../types";

export class ToolError extends Error {
  constructor(
    public code: "denied" | "not-found" | "bad-args" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Typed helper so each tool file stays declarative. */
export function defineTool<A extends Record<string, unknown>, R>(spec: {
  name: string;
  description: string;
  parameters: JsonSchema;
  scope?: ToolScope;
  run: (args: A, ctx: ToolContext) => Promise<R>;
}): AgentTool<A, R> {
  return { scope: "read", ...spec };
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new ToolError("bad-args", `"${key}" must be a non-empty string`);
  return v;
}

export function optionalNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** A workspace path must stay inside the workspace. */
export function safeWorkspacePath(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.split("/").some((seg) => seg === "..")) throw new ToolError("bad-args", `Invalid workspace path: ${path}`);
  return p;
}
