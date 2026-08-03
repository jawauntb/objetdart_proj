import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  THRESHOLDS,
  holdTier,
  intensityFrom,
  decomposeTwoPointer,
  chordRotation,
  pathWinding,
  classifyInstrumentPair,
  classifyRelease,
  tapTrain,
  rhythmFrom,
  shakeIntensity,
  drumAlternation,
  classifyDrum,
  classifyArpeggio,
} = loadTsModule("src/lib/gesture/core.ts");

// — Hold tiers: touch → dwell → ceremony —
assert.equal(holdTier(100), 0);
assert.equal(holdTier(THRESHOLDS.tapMaxMs + 1), 1);
assert.equal(holdTier(THRESHOLDS.dwellMs), 2);
assert.equal(holdTier(THRESHOLDS.ceremonyMs), 3);

// — Intensity: force > area > velocity > neutral 0.5 —
assert.equal(intensityFrom({ pressure: 0.9 }), 0.9, "real force wins");
const padded = intensityFrom({ pressure: 0.5, width: 36, height: 36 });
assert.ok(padded > 0.6, "0.5 pressure is the untrusted default; area used instead");
const tip = intensityFrom({ width: 10, height: 10 });
assert.ok(tip < padded, "fingertip lighter than flat pad");
assert.equal(intensityFrom({}), 0.5, "no signal reads neutral");

// — Two-finger decomposition: the orthogonal channels stay orthogonal —
const purePinch = decomposeTwoPointer(
  { x: -10, y: 0 }, { x: 10, y: 0 },
  { x: -20, y: 0 }, { x: 20, y: 0 },
);
assert.ok(Math.abs(purePinch.scale - 2) < 1e-9, "spread doubles distance");
assert.ok(Math.abs(purePinch.rotate) < 1e-9, "pure pinch does not rotate");
assert.ok(Math.abs(purePinch.dx) < 1e-9 && Math.abs(purePinch.dy) < 1e-9, "pure pinch does not pan");

const pureTwist = decomposeTwoPointer(
  { x: -10, y: 0 }, { x: 10, y: 0 },
  { x: 0, y: -10 }, { x: 0, y: 10 },
);
assert.ok(Math.abs(Math.abs(pureTwist.rotate) - Math.PI / 2) < 1e-9, "quarter turn detected");
assert.ok(Math.abs(pureTwist.scale - 1) < 1e-9, "pure twist does not scale");

const purePan = decomposeTwoPointer(
  { x: 0, y: 0 }, { x: 20, y: 0 },
  { x: 5, y: 7 }, { x: 25, y: 7 },
);
assert.equal(purePan.dx, 5);
assert.equal(purePan.dy, 7);
assert.ok(Math.abs(purePan.scale - 1) < 1e-9 && Math.abs(purePan.rotate) < 1e-9);

// — Chord rotation: the angular channel of a three-finger grip —
const chord = [
  { x: 100, y: 40 },
  { x: 60, y: 140 },
  { x: 160, y: 130 },
];
const spinChord = (pts, rad, tx = 0, ty = 0) => {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return pts.map((p) => ({
    x: cx + (p.x - cx) * Math.cos(rad) - (p.y - cy) * Math.sin(rad) + tx,
    y: cy + (p.x - cx) * Math.sin(rad) + (p.y - cy) * Math.cos(rad) + ty,
  }));
};
assert.ok(
  Math.abs(chordRotation(chord, spinChord(chord, 0.3)) - 0.3) < 1e-9,
  "a rigid +0.3 rad turn about the centroid reads as +0.3",
);
assert.ok(
  Math.abs(chordRotation(chord, spinChord(chord, -0.3)) + 0.3) < 1e-9,
  "the sign follows the turn",
);
assert.ok(
  Math.abs(chordRotation(chord, chord.map((p) => ({ x: p.x + 37, y: p.y - 19 })))) < 1e-9,
  "carrying the whole chord says nothing about rotation",
);
const spread = (() => {
  const cx = chord.reduce((a, p) => a + p.x, 0) / chord.length;
  const cy = chord.reduce((a, p) => a + p.y, 0) / chord.length;
  return chord.map((p) => ({ x: cx + (p.x - cx) * 1.5, y: cy + (p.y - cy) * 1.5 }));
})();
assert.ok(
  Math.abs(chordRotation(chord, spread)) < 1e-9,
  "a pure spread is a pinch, never a twist",
);
assert.ok(
  Math.abs(chordRotation(chord, spinChord(chord, 0.3, 55, -22)) - 0.3) < 1e-9,
  "a turn survives being carried across the glass",
);

// — Winding: a drawn circle is one turn; a line is none —
const circle = [];
for (let i = 0; i <= 32; i++) {
  const a = (i / 32) * 2 * Math.PI;
  circle.push({ x: 100 + 40 * Math.cos(a), y: 100 + 40 * Math.sin(a) });
}
const w = pathWinding(circle);
assert.ok(Math.abs(Math.abs(w) - 1) < 0.08, `full circle ≈ one turn (got ${w})`);
const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 5 }));
assert.ok(Math.abs(pathWinding(line)) < 0.3, "a stroke is not a scrub");

// — Release classification —
assert.equal(classifyRelease(120, 3, 0.1), "tap");
assert.equal(classifyRelease(1200, 3, 0.0), "hold-release");
assert.equal(classifyRelease(300, 80, 1.2), "flick");
assert.equal(classifyRelease(600, 80, 0.1), "drag-end");

// — Tap trains cap at 3 and reset outside the window —
assert.equal(tapTrain(1, 1000, 1000 + THRESHOLDS.tapTrainMs), 2);
assert.equal(tapTrain(2, 1000, 1200), 3);
assert.equal(tapTrain(3, 1000, 1200), 3, "caps at triple");
assert.equal(tapTrain(2, 1000, 1000 + THRESHOLDS.tapTrainMs + 1), 1, "window resets");

// — Rhythm: a steady 120bpm train is heard as one —
const steady = [0, 500, 1000, 1500, 2000];
const r = rhythmFrom(steady);
assert.ok(Math.abs(r.bpm - 120) < 1, `120bpm (got ${r.bpm})`);
assert.ok(r.stability > 0.95, "metronomic taps are stable");
const ragged = rhythmFrom([0, 210, 700, 820, 1900]);
assert.ok(!ragged || ragged.stability < 0.6, "ragged taps are unstable");
assert.equal(rhythmFrom([0, 500]), null, "too few taps is not a rhythm");

// — Shake: sustained agitation registers, a single bump does not —
const now = 10000;
const quiet = Array.from({ length: 20 }, (_, i) => ({ x: 0.3, y: 0.2, z: 0.1, t: now - i * 30 }));
assert.equal(shakeIntensity(quiet, now), 0, "stillness is silent");
const violent = Array.from({ length: 20 }, (_, i) => ({
  x: 18 * (i % 2 ? 1 : -1), y: 14, z: 6, t: now - i * 30,
}));
assert.ok(shakeIntensity(violent, now) > 0.3, "a real shake registers");
const oneBump = [...quiet.slice(0, 18), { x: 30, y: 0, z: 0, t: now - 10 }];
assert.equal(shakeIntensity(oneBump, now), 0, "one pothole is not a shake");

// — Drumming —
assert.equal(drumAlternation([{ zone: 0 }, { zone: 1 }, { zone: 0 }, { zone: 1 }]), 1, "strict patter");
assert.equal(drumAlternation([{ zone: 0 }, { zone: 0 }, { zone: 0 }]), 0, "one finger is not a drum");

// — Drum classification: a two-zone patter commits; rolls and chords do not —
const hitsAt = (pts) => pts.map(([x, y, t]) => ({ x, y, t }));
const patter = hitsAt([[100, 300, 0], [300, 300, 200], [100, 300, 400], [300, 300, 600]]);
const drum = classifyDrum(patter, 620);
assert.ok(drum, "a strict L-R-L-R patter is a drum");
assert.equal(drum.hits, 4);
assert.equal(drum.alternation, 1, "strict alternation reads as 1");
assert.equal(drum.x, 300, "the committing hit is the latest landing");
assert.ok(drum.ax === 100 && drum.bx === 300, "both zone anchors surface for the room");
const roll = hitsAt([[100, 300, 0], [104, 302, 200], [98, 296, 400]]);
assert.equal(classifyDrum(roll, 420), null, "a same-spot roll is one zone, not a drum");
const chordLanding = hitsAt([[100, 300, 0], [300, 300, 12], [200, 340, 24]]);
assert.equal(classifyDrum(chordLanding, 40), null, "a chord's simultaneous landings are one strike");
const sloppy = hitsAt([[100, 300, 0], [100, 300, 200], [300, 300, 400], [100, 300, 600]]);
assert.equal(classifyDrum(sloppy, 620), null, "weak alternation stays below the drum");
assert.equal(classifyDrum(patter, 2000), null, "the patter fades once the window closes");

// — Arpeggio: staggered landings roll; a chord lands together; late fingers are new phrases —
assert.equal(classifyArpeggio([0, 12, 30]), null, "a chord lands inside the settle stagger");
const arp = classifyArpeggio([0, 70, 150]);
assert.ok(arp && arp.fingers === 3 && arp.spreadMs === 150, "a rolled 3-finger chord is an arpeggio");
assert.equal(classifyArpeggio([0, 70, 900]), null, "an entrance past the gap window is a new phrase");
assert.equal(classifyArpeggio([0]), null, "one finger cannot arpeggiate");

// — Instrument pairs: chords must never read as pinch, pinches must never sound —
const still = { x: 0, y: 0 };
// Staggered landings are voices no matter how the fingers later move.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 200,
    da: { x: -40, y: 0 }, db: { x: 40, y: 0 },
    scale: 1.6, rotate: 0, elapsedMs: 300,
  }),
  "voices",
  "a staggered chord spreading apart must never become a pinch",
);
// A together-landed pair spreading past the radial deadzone is a frame grip.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 20,
    da: { x: -30, y: 0 }, db: { x: 30, y: 0 },
    scale: 1.5, rotate: 0, elapsedMs: 120,
  }),
  "frame",
  "a real pinch must be reclaimed from the voices",
);
// Rotation about the midpoint (opposed tangential motion) is a frame grip too.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 10,
    da: { x: 0, y: -26 }, db: { x: 0, y: 26 },
    scale: 1.01, rotate: 0.5, elapsedMs: 140,
  }),
  "frame",
  "a twist must be reclaimed from the voices",
);
// Parallel travel is a double-stop glide, not a pan.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 15,
    da: { x: 50, y: 4 }, db: { x: 48, y: -3 },
    scale: 1.02, rotate: 0.02, elapsedMs: 100,
  }),
  "voices",
  "two fingers gliding the same way are two voices, never a pan",
);
// An anchored finger with one slider is playing, not pinching.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 15,
    da: still, db: { x: 60, y: 0 },
    scale: 1.4, rotate: 0, elapsedMs: 100,
  }),
  "voices",
  "holding one note while gliding another must stay two voices",
);
// A still, together-landed dyad settles into voices once the window closes.
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 12,
    da: still, db: still,
    scale: 1, rotate: 0, elapsedMs: THRESHOLDS.voiceDecideMs + 1,
  }),
  "voices",
  "a held dyad locks as voices after the decide window",
);
assert.equal(
  classifyInstrumentPair({
    landDeltaMs: 12,
    da: still, db: still,
    scale: 1, rotate: 0, elapsedMs: 60,
  }),
  "undecided",
  "a fresh still pair stays on probation inside the window",
);

console.log("gesture grammar tests passed — the chord's angular channel holds");
