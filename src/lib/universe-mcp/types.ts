// Universe MCP — shared types. See docs/universe-mcp.md for the contract.
// Every module in this folder imports through the `@/` alias (no relative
// imports, no extensions) so the node test loader, tsc and Next all agree.

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** What the transport knows about the caller. Never persisted, never logged. */
export type ToolCtx = {
  now: () => number;
  /** bearer matched UNIVERSE_WRITE_TOKEN (constant-time). */
  authed: boolean;
  /** the caller's address, for rate limiting only. */
  ip: string;
  /** injected so tools stay testable; the route passes process.env. */
  env: Record<string, string | undefined>;
  /** set on /mcp/i/<code>: the instance every call is bound to. */
  bound: string | null;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** "write" tools need the bearer token; "open" tools do not. */
  access: "open" | "write";
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult> | ToolResult;
};

export type RpcOutcome = { status: number; body: unknown | null };
