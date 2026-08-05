# room visual — the pixel-density bar, mechanised

`test:room-depth` reads a room's manifest and counts declarations: does the
FRAG carry as many labelled layers as `shader_layers` promised, does the
source hold as many `SceneObjectSpec<>` as `population.objects` named. That
is the whole mechanism, and it has a blind spot: `/tidepool` once scored
5/5 on `test:room-depth` — every declaration answered — while its guide
screenshot still read as empty water and a few dots. A room can pass every
declaration check and still be thin, because a manifest can promise four
shader layers that each paint one flat wash of three colours.

**`test:room-visual`** never opens a manifest. It opens the JPG every
room's guide entry already ships (`public/guide/<key>.jpg`) and measures
the pixels.

## the five checks

1. **`hue_diversity`** — an HSV hue histogram over 24 buckets (15° each);
   pass iff >= 4 buckets hold >= 1% of the frame's pixel mass. Catches a
   frame that reads as one or two colours.
2. **`luminance_range`** — p90 - p10 of Y' = .2126R + .7152G + .0722B over
   255 levels; pass iff >= 60. Catches flat, shadowless lighting.
3. **`edge_density`** — Sobel gradient magnitude over Y'; pass iff >= 6% of
   pixels exceed magnitude 40. Catches soft gradients and empty field with
   nothing textured enough to read as material.
4. **`spatial_entropy`** — Shannon entropy (bits) of a 60x40 luminance
   downsample; pass iff >= 4.5. Catches a coarse layout that is one or two
   repeated patches.
5. **`file_size_floor`** — the JPG itself, >= 30KB at 1200x750/q82. JPEG is
   content-adaptive: a flat scene compresses far smaller than a busy one.

`hue_diversity` skips when a room declares `life.material_2d_only: true` or
`life.visual.monochrome_by_design: true` — everything else applies
universally, with no other exemption.

Voluntary like `test:room-depth`: not wired into `npm test`. Run directly
with `npm run test:room-visual`. When a room goes red here, the fix is
`npm run shoot:guide -- --only=<key>` after the material actually grew —
never a threshold edit.
