# Page Feel Audit

First pass from `origin/main`, excluding `/signal` because it just shipped a focused music pass.

Product direction: keep the site magical, playable, rich, and alive. Prefer embodied interaction over explanatory copy. The water is the template: touch makes tone, dwell makes glow, state is visible/audible/felt.

## Candidate Batches

- Batch A: Reading afterlife. Improve `/kept`, `/compare`, `/reading/[hash]`, and archive entry actions so saved/shared readings feel playable, not static.
- Batch B: Lab instruments. Add audio/tape feedback and stronger pointer readouts to `/sine`, `/circularity`, `/flowers`, `/light`, `/time`, and `/beyond`.
- Batch C: Archive and atlas depth. Improve filter feedback, empty states, drawer affordances, and route continuity for `/archive`, `/archive/[slug]`, and `/atlas/[region]`.
- Batch D: Element scenes. Page-specific polish for `/aphros`, `/clouds`, `/earth`, `/fire`, `/growth`, `/plasma`, `/pulse`, `/stars`, `/storm`, `/tide`, `/watch`, and `/waves`.
- Batch E: Static language pages. Make `/colophon` and utility states carry a small interactive mark without becoming explanatory.

## Route Audit

| Route | What Feels Less Great | Three Improvements | Priority | Candidate Batch |
| --- | --- | --- | --- | --- |
| `/` | Already strong, but the page now has many instruments competing for attention after the threshold. | 1. Add a tiny "last touched" route/tape reflection near the departure chart. 2. Let threshold action buttons leave distinct tape pulses and sea nudges. 3. Tighten mobile vertical rhythm between SeaChart, concern field, and atlas. | High | Later home pass |
| `/aphros` | Very alive, but the sheer density can hide what was just played. | 1. Add a small persistent shell-sequence ledger with replay. 2. Let the nautilus drag velocity visibly score the tuner pad. 3. Give sand/foam impressions a clearer "kept locally" state. | Medium | Batch D |
| `/archive` | Functional and on-brand, but filtering and imagining do not feel as physical as drawers. | 1. Animate filter activation as drawer pulls with tape/audio ticks. 2. Add a richer no-results state with suggested filter release. 3. Show a tiny active-filter sigil built from selected concerns/objects. | High | Batch C |
| `/archive/[slug]` | Beautiful reading surface, but the entry is mostly static once opened. | 1. Add a "play drawer sigil" control using the entry concerns. 2. Let prev/next navigation preview neighboring drawer sigils. 3. Add subtle page-turn feedback on archive navigation links. | High | Batch A |
| `/atlas/[region]` | Deep link opens the atlas, reading, and archive, but arrival could feel more ceremonial. | 1. Pulse the requested region on route load. 2. Add route-arrival tape/audio feedback. 3. Add compact "you arrived at..." state before the drawer if the region is invalid or missing. | High | Batch C |
| `/beyond` | The field is gorgeous, but interaction is mostly visual and not recorded. | 1. Record tape pulses on stir and control changes. 2. Play restrained notes from fold/pull coordinates. 3. Add a "fold memory" snapshot/replay button. | Medium | Batch B |
| `/charts` | Strong instrument already; affordances are dense but readable. | 1. Improve pinned-snapshot comparison with a small ghost overlay toggle. 2. Add mobile-safe tooltip positioning. 3. Let regenerate/reset make visibly different tape marks. | Medium | Batch D |
| `/circularity` | Clear math toy, but quieter than the site standard. | 1. Add pitched ticks from the moving endpoint. 2. Record preset/terms/speed changes to tape. 3. Let users grab the endpoint to scrub theta directly. | High | Batch B |
| `/clouds` | Strong scene, but labels and day-cycle controls are easy to miss. | 1. Make label taps leave visible cloud marks. 2. Add a stronger sun/moon phase readout without extra prose. 3. Let lightning replay from the tape or chart. | Medium | Batch D |
| `/colophon` | Appropriate quietness, but it is the only page that feels almost non-instrumental. | 1. Make the footer sigil playable with a tiny press-room chime. 2. Add an interactive "three registers" mark. 3. Let "kept since 2010" reveal a subtle timeline pulse. | Low | Batch E |
| `/compare` | Useful, but not yet playful enough for such a central saved-reading flow. | 1. Add A/B sigil play buttons. 2. Make the top deltas tappable so they briefly glow their axis in the overlay. 3. Improve empty state with a ghost two-sigil overlay. | High | Batch A |
| `/earth` | Rich and embodied, likely a later polish route. | 1. Add clearer active-stratum persistence. 2. Let quake/rain events annotate the seismograph with tiny labels. 3. Add a low-risk mobile control strip for stratum jump targets. | Medium | Batch D |
| `/fire` | Already highly playable, but control state can be hard to parse after several actions. | 1. Add a compact flame-count/palette readout. 2. Let split/fan/color actions mark the tape with distinct event types. 3. Add mobile affordance hints through iconography rather than copy. | Medium | Batch D |
| `/flowers` | Pleasant but simpler than the rest of the site, with no shared tape/audio feedback. | 1. Play petal notes when planting. 2. Record planting, mirror, and clear events to tape. 3. Add a small "bouquet" replay of recent taps. | High | Batch B |
| `/growth` | Strong multi-zone curve instrument. Some controls feel more like a demo than an altar. | 1. Make zone transitions leave visible phase marks. 2. Add a persistent phase ribbon tying sigmoid, exponential, and life-cycle zones together. 3. Add clearer audio status while the life marker walks. | Medium | Batch D |
| `/kept` | Important product memory state, but empty and selection states are mostly utilitarian. | 1. Replace empty box with a ghost constellation/sigil. 2. Add selection order badges and audio/tape feedback. 3. Add a "play trail" micro-action for kept reading sigils. | High | Batch A |
| `/light` | Good direct instrument, but it uses a separate audio graph and does not touch the tape. | 1. Route tones through the shared field audio where possible. 2. Record note/pad/waveform events to tape. 3. Add a lingering afterimage trail on the light pad. | High | Batch B |
| `/plasma` | Very ambitious and already eventful. Risk is mostly complexity and discoverability. | 1. Add clearer zone focus state as users move between instruments. 2. Give prism/metal/interference saved micro-states. 3. Tighten mobile layout around stacked controls. | Medium | Batch D |
| `/pretext` | Good playable text page; output state could feel more kept and less transient. | 1. Record mode, generate, use-text, and voice actions to tape. 2. Add a saved local phrase tray. 3. Make words under pointer emit soft notes. | High | Batch B |
| `/pulse` | Strong medical/monitor metaphor, with many controls competing. | 1. Make audio-enabled channels visibly pulse in labels. 2. Add better saved-pattern empty and loaded states. 3. Add a compact mobile pattern drawer. | Medium | Batch D |
| `/reading/[hash]` | Shared reading is elegant but mostly read-only despite having a personal sigil. | 1. Add a play-sigil action for the shared concern shape. 2. Record copy/step-into actions to tape when possible. 3. Add a small "this room differs from yours" preview when local state exists. | High | Batch A |
| `/sine` | Clear explorer, but more classroom than living instrument. | 1. Add shared audio notes while dragging the wave. 2. Record parameter changes and play/pause to tape. 3. Add a ghost of the last drag gesture. | High | Batch B |
| `/stars` | Already magical and deep. Main risk is state clarity around saved constellations. | 1. Add a constellation list mini-map for saved shapes. 2. Add stronger delete confirmation visuals. 3. Let zoom changes leave a quiet tape mark. | Medium | Batch D |
| `/storm` | Very strong page. Tuning wheel and maelstrom are great candidates for refinement. | 1. Make the wheel readout more tactile on mobile. 2. Add a replayable "storm event" mark. 3. Improve calm/maelstrom transition feedback in the chart. | Medium | Batch D |
| `/tide` | Already closely matches the water template. | 1. Add more visible territory-enter persistence. 2. Let scrub history draw a faint wake. 3. Make chart candles and tide positions cross-highlight. | Medium | Batch D |
| `/time` | Clear chronograph, but actions are silent and no tape traces are recorded. | 1. Record start/lap/reset and mass/velocity adjustments to tape. 2. Play tiny chronograph ticks on lap/start. 3. Add lap markers onto the manifold. | High | Batch B |
| `/watch` | One of the strongest "room" pages. Mostly needs discoverability polish. | 1. Add hover/tap focus glows that persist a little longer. 2. Add a tiny object legend only after interaction. 3. Make record/book/window states visible in the tape labels. | Medium | Batch D |
| `/waves` | Strong after the prior touch pass. Main issue is re-entry and memory. | 1. Add a phase replay list near the footer. 2. Persist kept poem lines locally. 3. Add mobile progress rail for phase jumps. | Medium | Batch D |

## First Batch Choice

Start with Batch A. The saved/shared reading flow is the social and memory layer of the site, and it currently has the biggest gap between importance and embodied feedback. Keep the PR small:

1. Add sigil playback to `/reading/[hash]`.
2. Add clearer, audible/tape-backed selection and forget states to `/kept`.
3. Add A/B sigil playback and more alive empty state to `/compare`.
