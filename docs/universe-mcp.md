# Universe MCP — objet d'art as a server a lattice animal can live in

*The contract every lane builds against. Change this file in the same commit as
any change to what a tool does.*

## What it is

`https://objetdart-production.up.railway.app/mcp` (POST JSON-RPC, stateless
Streamable HTTP — no session, no stream; GET is 405). It is the whole app, not
the index: every room on the log-scale axis, from the quantum fields to the
spacetime manifold, is reachable and touchable. `/mcp/i/<code>` binds every call
to one world (`instance` is implied and hidden from the schemas).

An **instance** is a *world of one's own*: a private walk through the universe
with a position, a path, per-room state, and inhabitants, addressed by a code
(`^[a-z0-9]{8,16}$`). Instances are created lazily by `universe_open`. The
lattice animal derives one code per unit and per rung of its ladder (mind,
body, connectome, tissue, field, pattern) so each explores its own.

### World codes (both repos compute this identically)

```js
const fnv1a = (s, seed) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const worldCode = (from, layer, unit) => {
  const key = `${from}|${layer}|${unit}`;                       // from = the field's instance code, or "anon"
  return "w" + [0x811c9dc5, 0x9e3779b1].map((sd) => fnv1a(key, sd).toString(36).padStart(7, "0")).join("").slice(0, 13);
};
```

Golden vectors (pin them in tests on both sides):
`("abcd1234","mind","7") → w18sdely0a62ke`, `("abcd1234","body","frog") → w0riwarz1cq1mp`,
`("abcd1234","field","") → w1puy7wr08av8b`, `("anon","pattern","0") → w1dglo291beunb`.
`layer` is one of `mind body connectome tissue field pattern visitor`. The server
accepts any code that matches the pattern; `universe_open` without `instance`
derives it this way.

Two honest kinds of "being in a room":

- **the headless twin** — the server holds each instance's room state and applies
  the gesture grammar's verbs to it deterministically (a function of the code's
  seed and the verb history; never `Math.random()`, never a wall clock read as
  state). It follows the room's registry facts (`creates`, `interacts`, scale
  address, travel edges), not its pixels.
- **a live window** — a real browser on the real room (`/?universe=<code>` or
  any route with that query) attaches to the same code; window tools relay to it,
  so an animal can navigate, gesture and look at the page a person is seeing.

## Lanes (each owns files; nothing else edits them)

| lane | files | tools |
| --- | --- | --- |
| explore | `tools-explore.ts` (+ `map.ts`) | `universe_map`, `universe_room`, `universe_rooms_near` |
| inhabit | `tools-inhabit.ts`, `store.ts`, `instances.ts`, `twin.ts` | `universe_open`, `universe_look`, `universe_step`, `universe_gesture`, `universe_inhabit`, `universe_remember`, `universe_leave`, `universe_inhabitants` |
| window | `tools-window.ts`, `windows.ts`, `src/components/UniverseBridge.tsx`, `src/app/api/universe/**` | `universe_windows`, `universe_window_do` |
| code | `tools-code.ts`, `code-policy.ts`, `code-github.ts` | `world_read`, `world_search`, `world_patch` (write token) |

`protocol.ts`, `index.ts`, `serve.ts`, `auth.ts`, `types.ts` are the shared
spine; change them only with a test in `scripts/test-universe-mcp.mjs`.

## Tool contract

All tools return one text part. JSON payloads are `JSON.stringify(x, null, 1)`.
Errors are `isError: true` with a plain sentence, never a stack.

- `universe_about {}` — the front door (exists).
- `universe_map {}` — every room: `{key, route, band, register, cluster, creates, interacts (first 160 chars), neighbors[]}` plus the scale axis and its bands in order.
- `universe_room {room}` — one room in full: registry entry, guide entry (plain words), which global verbs it answers and which it exempts (with the written reason), travel doors, who inhabits it now (public part only).
- `universe_open {instance?, from?, layer?, unit?}` — get or create a world. With no `instance`, derives a code from `from`+`layer`+`unit` deterministically. Returns `{instance, layer, room, created, mcp: "/mcp/i/<code>"}`.
- `universe_look {instance}` — where it is, the room's population, what its inhabitants sense, the breath phase, the last few steps.
- `universe_step {instance, to}` — travel: `to` is a room key, a route, `in`/`out` (along the scale axis), or `wander` (the curiosity rule — least-visited neighbor, ties by seed). Returns the arrival: which film/edge, the room's `creates` noun, what is here.
- `universe_gesture {instance, verb, ...}` — verbs from `docs/gesture-grammar.md`: `tap {count}`, `hold {ms}`, `drag`, `pinch`, `twist`, `chord {fingers}`, `tilt`, `shake`, `knock`, `flip`, `dwell`, `ceremony`. The twin applies it to the room's population by the registry's `creates`/`interacts`; a tap climbs the train 1/3/5/n; a hold deepens continuously with `ms`. Returns what changed and the senses it lands in (sight, sound, haptic).
- `universe_inhabit {instance, animal:{id, species, cells:[[x,y]...], stage?, from?}, room?}` — place a lattice animal (a polyomino of ≤ 400 cells, 4-connected — reject otherwise) into a room. It **persists**: the same `animal.id` in any instance is the same inhabitant; it keeps its lineage and notes.
- `universe_remember {instance, note}` — append ≤ 280 chars to the inhabitant's memory (cap 40, oldest retire).
- `universe_leave {instance, animal?}` — retire an inhabitant (the ceremony's touch-reachable delete).
- `universe_inhabitants {room?}` — who lives where across the whole commons.
- `universe_windows {}` / `universe_window_do {instance, action: look|navigate|gesture, ...}` — relay to an attached live page.
- `world_read {path}` / `world_search {query, glob?}` — read the running world's source (allowlist, size-capped). Open.
- `world_patch {instance, files:[{path, content}], message, dry_run?}` — **write token**. `dry_run` defaults **true**: runs the preflight (path policy, size, syntax) and returns the diff summary. `dry_run:false` commits to `UNIVERSE_CODE_BRANCH` (default `universe`, created from `main` if missing) through the GitHub API. Setting `UNIVERSE_CODE_BRANCH=main` is the owner's one switch that lets the world redeploy itself from what its animals write.

## Persistence

`store.ts` keeps everything in memory on `globalThis` and writes through to a
JSON file (atomic rename, debounced) under `UNIVERSE_DATA_DIR`, else
`RAILWAY_VOLUME_MOUNT_PATH`, else `./.universe-data` (gitignored). Without a
Railway volume the file survives restarts but not redeploys — that is stated in
`universe_about`, not hidden. Caps: 5000 instances, 64 inhabitants per room,
400 cells per animal, 40 notes per inhabitant. Nothing about the person leaves
the browser: no IP is ever stored.

## The leash on code changes

`world_patch` is off unless **both** `UNIVERSE_WRITE_TOKEN` (≥ 16 chars, the
bearer the caller must present) and `UNIVERSE_GITHUB_TOKEN` are set. Allowed
paths: `src/**`, `docs/**`, `public/**` (text only), `scripts/test-*.mjs`.
Never: `.github/**`, `railway.json`, `package*.json`, `next.config.*`,
`doppler.yaml`, `.env*`, `AGENTS.md`, `CLAUDE.md`, `INSPIRATION.md`, and the
leash itself (`src/lib/universe-mcp/code*.ts`, `src/lib/universe-mcp/auth.ts`,
`src/app/api/mcp/**`). ≤ 5 files, ≤ 200 KB each, one commit per 5 minutes per
instance. A failed build leaves the previous deploy serving.

## Connecting

```
claude mcp add --transport http objetdart https://objetdart-production.up.railway.app/mcp
claude mcp add --transport http lattice-animal https://latticeanimal-production.up.railway.app/mcp
```

`.mcp.json` at the repo root does the same for a Claude Code opened here.
