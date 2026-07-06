# A candle inside the command center, facing the sea

A usable symbolic field instrument. You enter a candlelit room facing dark water, handle a small set of objects, calibrate your concerns, route a personal atlas, query an archive, and leave with a saveable **field reading**.

The design goal: meaning emerges through *use*, not through reading a biography. Every object and region carries one poetic inscription (what it means) and one plain function line (what it does), so you are oriented without being lectured.

## Run it

Requires Node 18.17+ (Node 20+ recommended).

```bash
yarn install
yarn dev
```

Then open http://localhost:3000.

To build for production:

```bash
yarn build
yarn start
```

> Using npm instead of yarn? `npm install` then `npm run dev` works identically.

## iOS coin app

The coin also has a hybrid SwiftUI app in `ios/ObjetCoin`. Open
`ios/ObjetCoin/ObjetCoin.xcodeproj` in Xcode and run the `ObjetCoin` scheme.
It wraps `/coin` with native source controls, sharing, settings, launch art, and
haptics.

By default it loads the production `/coin` route full-screen. For local web
development, add this launch argument to the Xcode scheme:

```text
-CoinURL http://localhost:3000/coin?app=ios
```

See `ios/ObjetCoin/README.md` for icon generation, signing, and App Store
archive/export commands.

## Deployment

Production runs on Railway from the GitHub `main` branch. If Railway falls
behind `origin/main` or only deploys when triggered manually, use the
[Railway autodeploy runbook](docs/railway-autodeploy.md).

### Analytics (optional)

Google Analytics 4 is wired in but stays dormant until you give it a Measurement ID. Set an env var (in `.env.local` for dev, or your host's env settings for prod):

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

`NEXT_PUBLIC_GA_ID` is still accepted for older deploys. With neither variable set, no tracking scripts load at all — dev and any un-wired deploy stay clean.

When configured, it tracks:

- **Page views** on first load and on every client-side route or query-string change (watch, signal, beyond, …).
- **Clicks** on interactive elements and playable surfaces via one delegated listener — no per-component wiring. Each click sends a `site_click` event with `click_label`, `element_tag`, `page_path`, and a sanitized `link_url` when relevant. To give a control a clean custom label, add `data-analytics="hold-candle"` to it.

## How to use the instrument

- **Enter field** — step past the threshold into the room.
- **Inspect** — tap any object to read its card (meaning + function).
- **Hold the candle** — press and hold (or focus it and press Space). The candle's light is the primary feedback channel: holding it raises the *attention* field and the glow expands across the whole scene.
- **Drag & combine** — drag an object toward a compatible region. Compatible objects have a `regions` list; dropping the glass on Crash Basin reduces pressure, the flower on House of Loves warms the field, and so on.
- **Console** — calibrate eight concerns with the sliders, or apply a preset (Origin, Builder, Crash, Lover, Prayer, Operator, Return, Horizon). Concern temperature shifts the room's light, not its hue.
- **Atlas** — pan (drag) and zoom (wheel) the map, then route between two territories to surface the objects, archive entries, and inscription that connect them.
- **Archive** — search and filter the drawers by medium.
- **Command (⌘)** — a small command line: try `show risk`, `route love to work`, `reset field`.
- **Field reading** — press `r` or the Atlas button to generate a reading. It's sealed with a generated sigil and saved to your browser (IndexedDB, with a localStorage fallback). Copy it to keep it.

### Keyboard

| Key | Action |
| --- | --- |
| `Enter` | enter the field (from threshold) |
| `c` | open command |
| `a` | open atlas |
| `r` | generate a field reading |
| `1`–`8` | apply concern presets |
| `Esc` | close any overlay |

Honors `prefers-reduced-motion` (stills the tide and candle flicker) and is keyboard-navigable throughout.

## Architecture

```
src/
  app/
    layout.tsx        root layout, fonts, metadata
    page.tsx          mounts <FieldShell/>
  components/
    FieldShell.tsx    client orchestrator: wires scene, panels, dialogs, keyboard
    RoomScene.tsx     Canvas 2D living scene — night, sea, tide, candle glow
    ObjectTable.tsx   draggable / holdable / inspectable object hotspots
    ConcernConsole.tsx  concern sliders + presets
    ConcernAtlas.tsx  pan/zoom atlas canvas + routing
    ArchiveDrawer.tsx searchable / filterable archive
    Chrome.tsx        TopBar (lens), ModeNav, TideScrub, Panel, Scrim, Flash
    Dialogs.tsx       SymbolCard, CommandChapel, FieldReading (+ generated seal)
  store/
    field.ts          single Zustand store — the whole field state machine
  data/
    content.ts        objects, concerns, regions, archive, presets, phases
  lib/
    types.ts          data model
    idb.ts            IndexedDB trace persistence (localStorage fallback)
  styles/
    globals.css       tokens, slider styling, reduced-motion, sr-only
```

## Design notes

- **One bold move:** a single candle whose radial-gradient light *is* the UI feedback. The `attention` field (0..1), driven by holding the candle, expands the glow. Everything else stays quiet.
- **Disciplined palette:** night, candle gold, merlot, parchment, sea-glass teal, plus a few supporting tones — no rainbow. Concern state shifts temperature/glow, never hue.
- **Type as two registers:** serif (Cormorant Garamond / Spectral) for meaning, mono (IBM Plex Mono) for operation.
- **Visual layer is Canvas 2D**, not PixiJS/R3F, so the project installs and runs with zero native build steps. The architecture cleanly isolates `RoomScene` if you later want to swap in WebGL.

## Tech

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind · Zustand.
