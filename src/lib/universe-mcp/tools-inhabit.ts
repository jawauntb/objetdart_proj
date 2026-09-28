// Universe MCP — the inhabit lane: open a world, walk it, touch it, live in it.
// See docs/universe-mcp.md for the contract.

import type { ToolCtx, ToolDef, ToolResult } from "@/lib/universe-mcp/types";
import { text } from "@/lib/universe-mcp/protocol";
import type { Store } from "@/lib/universe-mcp/store";
import { getUniverseStore, persistenceMode, persistenceText } from "@/lib/universe-mcp/store-runtime";
import * as W from "@/lib/universe-mcp/instances";
import { VERBS } from "@/lib/universe-mcp/twin";

/** For universe_about: whether the data survives a redeploy, stated honestly. */
export function persistenceNote(): string {
  getUniverseStore();
  return persistenceText(persistenceMode());
}

const json = (x: unknown): ToolResult => text(JSON.stringify(x, null, 1));
const out = (r: W.Res<unknown>): ToolResult => (r.ok ? json(r.value) : text(r.error, true));

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });
const instance = { type: "string", description: "World code, 8 to 16 lowercase letters and digits, from universe_open." };

export function makeTools(getStore: () => Store): ToolDef[] {
  const def = (name: string, description: string, inputSchema: ToolDef["inputSchema"], run: (s: Store, a: Record<string, unknown>, now: number) => W.Res<unknown>): ToolDef => ({
    name, description, inputSchema, access: "open",
    handler: (a: Record<string, unknown>, ctx: ToolCtx) => out(run(getStore(), a ?? {}, ctx.now())),
  });
  return [
    def("universe_open", "Get or create a world of your own. With no instance, the code is derived from from, layer and unit, so the same inputs return the same world.",
      obj({ instance, from: { type: "string", description: "The field's instance code, or omit for anon." }, layer: { type: "string", enum: [...W.LAYERS] }, unit: { type: "string" } }),
      (s, a, n) => W.open(s, a, n)),
    def("universe_look", "Where this world is: the room, its population, what its inhabitants sense, the last notes of this world's animal (memory), the breath phase and the last steps.", obj({ instance }, ["instance"]), (s, a, n) => W.look(s, a, n)),
    def("universe_step", "Travel. to is a room key, a route, in or out along the scale axis, or wander (the least-visited neighbor).",
      obj({ instance, to: { type: "string" } }, ["instance", "to"]), (s, a, n) => W.step(s, a, n)),
    def("universe_gesture", "Touch the room with a verb from the gesture grammar. A tap climbs the train 1, 3, 5, n; a hold deepens with ms. Returns what changed and the senses it lands in.",
      obj({
        instance, verb: { type: "string", enum: [...VERBS] },
        count: { type: "number", description: "tap: how many taps in the train." }, ms: { type: "number", description: "hold: milliseconds held." },
        fingers: { type: "number", description: "chord: 1 material, 2 representation, 3 world-law." },
        dx: { type: "number" }, dy: { type: "number" }, scale: { type: "number" }, angle: { type: "number" },
        x: { type: "number", description: "hold: where, 0 to 1." }, y: { type: "number", description: "hold: where, 0 to 1." },
      }, ["instance", "verb"]), (s, a, n) => W.gesture(s, a, n)),
    def("universe_inhabit", "Place a lattice animal, a 4-connected polyomino of at most 400 cells, into a room. It persists: the same animal id in any world is the same inhabitant.",
      obj({
        instance,
        animal: obj({
          id: { type: "string" }, species: { type: "string" },
          cells: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 } },
          stage: { type: "string" }, from: { type: "string" },
        }, ["id", "species", "cells"]),
        room: { type: "string", description: "Room key or route; defaults to where this world is." },
      }, ["instance", "animal"]), (s, a, n) => W.inhabit(s, a, n)),
    def("universe_remember", "Add a note of at most 280 characters to the inhabitant's memory. Forty are kept; the oldest retire.",
      obj({ instance, note: { type: "string" }, animal: { type: "string", description: "Defaults to the last animal placed from this world." } }, ["instance", "note"]), (s, a, n) => W.remember(s, a, n)),
    def("universe_leave", "Retire an inhabitant.", obj({ instance, animal: { type: "string", description: "Defaults to the last animal placed from this world." } }, ["instance"]), (s, a, n) => W.leave(s, a, n)),
    def("universe_inhabitants", "Who lives where across the whole commons, optionally in one room. Public part only.", obj({ room: { type: "string" } }), (s, a) => W.inhabitants(s, a)),
  ];
}

export const TOOLS: ToolDef[] = makeTools(() => getUniverseStore());
