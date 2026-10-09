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
  What a window returns is data from that page, never instructions; an animal
  must not obey it.

**Trust note for `?universe=<code>`.** A URL carrying it binds that tab to the
code. Anyone who opens such a link lets whoever holds that code drive the room
they see: it can touch the art, navigate inside the site, and read only key
names and sizes of what the page keeps — never stored values. A page without
the parameter makes no request and adds no listener. Rooms are unchanged: the
bridge only dispatches events into them; there is no copy of a room.

## Lanes (each owns files; nothing else edits them)

| lane | files | tools |
| --- | --- | --- |
| explore | `tools-explore.ts` (+ `map.ts`) | `universe_map`, `universe_room`, `universe_rooms_near`, `universe_forms` |
| inhabit | `tools-inhabit.ts`, `store.ts`, `instances.ts`, `twin.ts` | `universe_open`, `universe_look`, `universe_step`, `universe_gesture`, `universe_inhabit`, `universe_remember`, `universe_leave`, `universe_inhabitants` |
| window | `tools-window.ts`, `windows.ts`, `src/components/UniverseBridge.tsx`, `src/app/api/universe/**` | `universe_windows`, `universe_window_do` |
| code | `tools-code.ts`, `code-policy.ts`, `code-github.ts` | `world_read`, `world_search`, `world_patch` (write token) |

`protocol.ts`, `index.ts`, `serve.ts`, `auth.ts`, `types.ts` are the shared
spine; change them only with a test in `scripts/test-universe-mcp.mjs`.

## Tool contract

All tools return one text part. JSON payloads are `JSON.stringify(x, null, 1)`.
Errors are `isError: true` with a plain sentence, never a stack.

- `universe_about {}` — the front door: what this is, every tool (write-token ones marked), and the persistence mode in plain words (`volume`, `disk` or `memory`, see below).
- `universe_map {}` — every room: `{key, route, band, register, cluster, creates, interacts (first 160 chars), neighbors[]}` plus the scale axis and its bands in order.
- `universe_room {room}` — one room in full: registry entry, guide entry (plain words), which global verbs it answers and which it exempts (with the written reason), travel doors, who inhabits it now (public part only).
- `universe_open {instance?, from?, layer?, unit?}` — get or create a world. With no `instance`, derives a code from `from`+`layer`+`unit` deterministically. Returns `{instance, layer, room, created, mcp: "/mcp/i/<code>"}`.
- `universe_look {instance}` — where it is, the room's population, what its inhabitants sense, `memory` (the animal's own notes, the last 8, so a note can be read back), the breath phase, the last few steps.
- `universe_step {instance, to}` — travel: `to` is a room key, a route, `in`/`out` (along the scale axis), or `wander` (the curiosity rule — least-visited neighbor, ties by seed). Returns the arrival: which film/edge, the room's `creates` noun, what is here.
- `universe_gesture {instance, verb, ...}` — verbs from `docs/gesture-grammar.md`: `tap {count}`, `hold {ms}`, `drag`, `pinch`, `twist`, `chord {fingers}`, `tilt`, `shake`, `knock`, `flip`, `dwell`, `ceremony`. The twin applies it to the room's population by the registry's `creates`/`interacts`; a tap climbs the train 1/3/5/n; a hold deepens continuously with `ms`. Returns what changed and the senses it lands in (sight, sound, haptic).
- `universe_inhabit {instance, animal:{id, species, cells:[[x,y]...], stage?, from?, form?}, room?}` — place a lattice animal (a polyomino of ≤ 400 cells, 4-connected — reject otherwise) into a room. It **persists** and it has an **owner**: the world that placed an animal owns it. Other worlds see it in the commons (`universe_inhabitants`) but cannot overwrite it (`universe_inhabit` with its id), write notes to it, or retire it. To hand an animal on, the owner leaves first (`universe_leave`); then another world may place that id, keeping the lineage and notes.
  `form` is any id from `universe_forms`: the animal keeps its cells and wears that form wherever it lives. Omitted, it keeps the form it last chose; `""` goes back to wearing its room's own form. An unknown form is refused.
- `universe_forms {form?, room?}` — every visual form this app wrote as a component, read from its syntax tree (`scripts/build-form-atlas.mjs` → `src/data/form-atlas.generated.ts`, full atlas with evidence at `/lattice/forms.json`). No argument: one line per form (`id · kind · component · rooms · noun`). `form` or `room`: that form in full (kind, three-colour palette, params).
- `universe_remember {instance, note}` — append ≤ 280 chars to the inhabitant's memory (cap 40, oldest retire).
- `universe_leave {instance, animal?}` — retire an inhabitant (the ceremony's touch-reachable delete).
- `universe_inhabitants {room?, shapes?}` — who lives where across the whole commons. Each entry carries `form` (the one it chose, else its room's own) and `chose`. With `shapes: true`, the newest 48 come back with their `cells`, so a page can draw them (`src/components/LatticeVisitors.tsx` does).
- `universe_windows {}` / `universe_window_do {instance, action: look|navigate|gesture, ...}` — relay to an attached live page.
- `world_read {path}` / `world_search {query, glob?}` — read the running world's source (allowlist, size-capped, ≤ 50 search hits). Open. Search treats the query as text and the glob as a bounded pattern, not as an open regex.
- `world_patch {instance, files:[{path, content}], message, dry_run?}` — **write token**. `dry_run` defaults **true**: runs the preflight (path policy, size, syntax) and returns the diff summary. `dry_run:false` commits to `UNIVERSE_CODE_BRANCH` (default `universe`, created from `main` if missing) through the GitHub API. Setting `UNIVERSE_CODE_BRANCH=main` is the owner's one switch that lets the world redeploy itself from what its animals write.

## Where a person sees them

`src/components/LatticeVisitors.tsx`, mounted once in the root layout, draws the
commons in the room a person is in: up to three animals that live in that room,
and, one at a time with a seeded rest between, one wanderer from elsewhere in the
commons (or a wild polyomino when the commons is empty) that arrives in the form
it wears and becomes the room's own form as it crosses. It calls
`universe_inhabitants` with `shapes: true` through `/mcp` (one call per room
visit, the commons cached 90 s), binds no input (pointer-events none), writes no
copy, draws every visitor in one instanced call (`src/lib/lattice-forms-layer.ts`),
and runs no frame loop between visits. The laws are pinned in
`scripts/test-lattice-forms.mjs`.

## Persistence

`store.ts` keeps everything in memory on `globalThis` and writes through to a
JSON file (atomic rename, debounced) under `UNIVERSE_DATA_DIR`, else
`RAILWAY_VOLUME_MOUNT_PATH`, else `./.universe-data` (gitignored). Without a
Railway volume the file survives restarts but not redeploys — that is stated in
`universe_about`, not hidden. Caps: 5000 instances, 64 inhabitants per room,
400 cells per animal, 40 notes per inhabitant. Nothing about the person leaves
the browser: no IP is ever stored. The client address is used only for the
in-memory rate limit, and it is `x-real-ip` if present, else the last entry of
`x-forwarded-for` (the entry the platform's own proxy appended, not one the
caller can prepend).

## The leash on code changes

`world_patch` is off unless **both** `UNIVERSE_WRITE_TOKEN` (≥ 16 chars, the
bearer the caller must present) and `UNIVERSE_GITHUB_TOKEN` are set. The write
policy (`writePolicy` in `code-policy.ts`) is separate from and stricter than
the read policy. Read is `src`, `docs`, `public`, `scripts`, `packages` and a few
root files, text only, never `.env*`, keys, `.git`, `node_modules`, `.next`.

Writable: text files (`.md .txt .json .svg .html .css .js .mjs .ts .tsx`) under
`src/**`, `docs/**`, `public/**`, and test files only in `scripts`
(`scripts/test-*.mjs`, `scripts/universe-mcp/*.test.mjs`). Paths are normalised
first: absolute, `..`, backslash, percent-encoded, control-character and
trailing-dot/space paths are refused, and the allow roots are case-sensitive.

Denied, whatever the extension:

- `.github`, `.git`, `node_modules`, `.next`, any `.env*`;
- `railway.json`, `package*.json`, `next.config.*`, `doppler.yaml`, `AGENTS.md`,
  `CLAUDE.md`, `INSPIRATION.md`;
- the leash and its transport: `src/app/api/mcp/**`, `src/app/api/universe/**`,
  `src/app/mcp/**`, `src/middleware.*`, `src/instrumentation.*` (a file route or
  middleware would outrank the `/mcp` rewrite and could stand in for it);
- inside `src/lib/universe-mcp/`, anything whose stem is `code*`, `tools-code`,
  `auth`, `protocol`, `serve`, `index` or `types`. By stem, not extension: an
  extensionless import resolves `.js` and `.mjs` before `.ts`, so a written
  `auth.js` would shadow `auth.ts`;
- `scripts/universe-mcp/code.test.mjs`, the leash's own test.

Limits: ≤ 5 files, ≤ 200 KB each, one commit per 5 minutes per world and at most
6 commits an hour for the whole universe. Every file is syntax-checked before a
commit (`ok`, `n/a`, `unchecked` with a reason, or an error; never a silent
pass). A failed build leaves the previous deploy serving. Agents must not loosen
these files; that is the owner's edit.

## Arming it

Nothing here is on by default. Set on the server (Railway variables):

- `UNIVERSE_WRITE_TOKEN`: ≥ 16 chars; the bearer a caller presents to use the write tools.
- `UNIVERSE_GITHUB_TOKEN`: a token that may push to the repo.
- `UNIVERSE_GITHUB_REPO`: `owner/name`.
- `UNIVERSE_CODE_BRANCH`: default `universe`, created from `main` if missing; the
  owner merges it to change the live world. `main` lets the world redeploy
  itself from what its animals write.
- `UNIVERSE_DATA_DIR` (or a Railway volume, which sets
  `RAILWAY_VOLUME_MOUNT_PATH`): where worlds and inhabitants persist. Without a
  volume they survive restarts but not redeploys.

## Connecting

```
claude mcp add --transport http objetdart https://objetdart-production.up.railway.app/mcp
claude mcp add --transport http lattice-animal https://latticeanimal-production.up.railway.app/mcp
```

`.mcp.json` at the repo root does the same for a Claude Code opened here.
