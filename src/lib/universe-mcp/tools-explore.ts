// Universe MCP — tools-explore: the map, one room in full, and what is nearby.
import type { ToolDef } from "@/lib/universe-mcp/types";
import { text } from "@/lib/universe-mcp/protocol";
import { buildMapText, nearKeys, resolveRoom, roomDetail, roomsNear } from "@/lib/universe-mcp/map";

const unknownRoom = (input: unknown) =>
  text(`No room matches "${String(input ?? "")}". Closest keys: ${nearKeys(String(input ?? "")).join(", ")}.`, true);

const universeMap: ToolDef = {
  name: "universe_map",
  description: "Every room of the app, one compact line each (key, route, band, register, creates, interacts, neighbors), and the scale axis in order.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  access: "open",
  handler: () => text(buildMapText()),
};

const universeRoom: ToolDef = {
  name: "universe_room",
  description: "One room in full: registry facts, guide entry in plain words, the gesture verbs it answers and exempts (with reasons), its travel doors, and its place on the axis.",
  inputSchema: {
    type: "object",
    properties: { room: { type: "string", description: "a room key, \"/route\" or \"route\"" } },
    required: ["room"],
    additionalProperties: false,
  },
  access: "open",
  handler: (args) => {
    const r = resolveRoom(args.room);
    return r ? text(JSON.stringify(roomDetail(r.key), null, 1)) : unknownRoom(args.room);
  },
};

const universeRoomsNear: ToolDef = {
  name: "universe_rooms_near",
  description: "Rooms reachable from a room through its travel doors and peer circles, grouped by hop (1 to 3).",
  inputSchema: {
    type: "object",
    properties: {
      room: { type: "string", description: "a room key, \"/route\" or \"route\"" },
      hops: { type: "integer", minimum: 1, maximum: 3, description: "how far to walk, default 1" },
    },
    required: ["room"],
    additionalProperties: false,
  },
  access: "open",
  handler: (args) => {
    const r = resolveRoom(args.room);
    if (!r) return unknownRoom(args.room);
    const n = Number(args.hops);
    const hops = Number.isFinite(n) ? Math.min(3, Math.max(1, Math.trunc(n))) : 1;
    return text(JSON.stringify({ room: r.key, hops, near: roomsNear(r.key, hops) }, null, 1));
  },
};

export const TOOLS: ToolDef[] = [universeMap, universeRoom, universeRoomsNear];
