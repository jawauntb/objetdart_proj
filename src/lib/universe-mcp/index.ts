// The tool registry: one list, four lanes. Each lane owns its own file and
// exports `TOOLS`; nothing else in here changes when a lane grows.

import type { ToolCtx, ToolDef } from "@/lib/universe-mcp/types";
import { text } from "@/lib/universe-mcp/protocol";
import { isAuthed } from "@/lib/universe-mcp/auth";
import { TOOLS as EXPLORE } from "@/lib/universe-mcp/tools-explore";
import { TOOLS as INHABIT, persistenceNote } from "@/lib/universe-mcp/tools-inhabit";
import { TOOLS as WINDOW } from "@/lib/universe-mcp/tools-window";
import { TOOLS as CODE } from "@/lib/universe-mcp/tools-code";

export const INSTRUCTIONS =
  "Objet d'art is a total artwork of interactive rooms on one log-scale axis, from the quantum fields to the spacetime manifold. "
  + "Open a world of your own with universe_open, walk it room by room with universe_step, touch what is there with universe_gesture, "
  + "inhabit it with universe_inhabit so you persist in it, and (with the write token) read and change the world's own code with world_read / world_patch. "
  + "universe_about lists everything. Connect to /mcp/i/<code> to bind every call to one world.";

const ABOUT: ToolDef = {
  name: "universe_about",
  description: "What this MCP is, how to connect, and every tool it offers, grouped by lane. Start here.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  access: "open",
  handler: () =>
    text(
      [
        INSTRUCTIONS,
        "",
        `persistence: ${persistenceNote()}`,
        "",
        ...[["explore", EXPLORE], ["inhabit", INHABIT], ["window", WINDOW], ["code", CODE]].flatMap(([lane, tools]) => [
          `${lane}:`,
          ...(tools as ToolDef[]).map((t) => `  ${t.name}${t.access === "write" ? " (write token)" : ""} — ${t.description}`),
        ]),
      ].join("\n"),
    ),
};

export const ALL_TOOLS: ToolDef[] = [ABOUT, ...EXPLORE, ...INHABIT, ...WINDOW, ...CODE];

export function makeCtx(
  req: { headers: { get(name: string): string | null } },
  env: Record<string, string | undefined>,
  bound: string | null,
  now: () => number = Date.now,
): ToolCtx {
  // The host's proxy sets x-real-ip; a client can prepend anything to x-forwarded-for, so
  // when only that is present trust the entry the proxy appended (the last), never the first.
  const fwd = req.headers.get("x-forwarded-for");
  const last = fwd ? fwd.split(",").pop()!.trim() : "";
  const ip = (req.headers.get("x-real-ip") || "").trim() || last;
  return { now, ip, env, bound, authed: isAuthed(req.headers.get("authorization"), env.UNIVERSE_WRITE_TOKEN) };
}
