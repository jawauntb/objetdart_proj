<!-- object-compiler template — docs/plans/object-compiler.md M3 followup.
     Consumes: spec.key, spec.placement.band, spec.placement.kind,
               spec.storage_key, spec.noun, ComponentName.
     A companion to the auto-patcher (scripts/object-compiler/apply-side-patches.py):
     rendered at compile time so a reviewer can see, in prose, what got written
     into the four shared files without diffing the whole PR. -->

# Side-file patches — what the auto-patcher wrote for `/tidepool`

Four files that live outside `src/rooms/<key>/` and `src/components/<Room>.tsx`
carry one small entry each for every new room. `scripts/object-compiler/apply-side-patches.py`
writes them idempotently on compile; this file records what it did so a
reviewer can read it in one place.

## 1. `src/rooms/registry.ts`

Added — one import line and one array entry, both alphabetical.

```ts
import tidepool from "@/rooms/tidepool/room.config";
```

Inside `export const ROOM_MANIFESTS = [ … ] as const;`:

```ts
  tidepool,
```

The array's order is alphabetical by construction. `mergePeerRing` runs
multi-pass over the manifest seats, so a `ringAfter:` that points at a room
declared later than this one still lands in the right place — no manual
ordering required.

## 2. `src/lib/room-registry.ts`

Added — one `RoomEntry` inside `ROOM_REGISTRY`, positioned alphabetically
inside the manifest-spread section that follows the
`// Manifest-spread rooms at the SITE_ROUTES tail` sentinel.

```ts
  {
    key: "tidepool",
    href: "/tidepool",
    kind: "room",
    source: "src/components/Tidepool.tsx",
    page: "src/app/tidepool/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:tidepool:v1",
    creates: "…",
    exempt: {},
  },
```

`keeps` is derived from `spec.storage_key` (null if the room has no
localStorage key). `creates` is `"a <spec.noun>"` (or `"an <spec.noun>"` for
vowel-initial nouns; null if the room grows no countable material).
`exempt` starts empty; a real global-binding exemption is a hand edit.

## 3. `src/lib/scale.ts`

Added — one `LATERAL_ROUTE_BANDS` row when the room is a peer:

```ts
  { prefix: "/tidepool", band: "coast" },
```

Inserted after the last existing row with the same `band`, so the file's
band-grouped ordering is preserved. Skipped entirely when
`spec.placement.kind` is not `peer` (band-primary rooms live in
`SCALE_BANDS`, which the manifest already reaches).

## 4. `scripts/test-routes.mjs`

Added — one string to `expectedKeys`, inside the
`// rooms that arrived through src/rooms/<key>/room.config.ts` section,
alphabetically:

```js
  "tidepool",
```

## Verification

`npm test` covers every one of these:

- `test:rooms` — the manifest round-trips through `SITE_ROUTES`, peer
  circles, the icon config and the guide.
- `test:routes` — every prefix in `LATERAL_ROUTE_BANDS` resolves,
  `expectedKeys` matches the site's actual route set, no drift.
- `test:room-contract` — the `ROOM_REGISTRY` row's binding surface matches
  what the room's component actually implements.

A red row in any of the three is the derivation working; edit the room's
manifest or spec, not the auto-patched files.
