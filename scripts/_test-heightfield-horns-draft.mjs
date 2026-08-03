// Paste into scripts/test-heightfield.mjs once horns, cornices, and glacier land in
// src/lib/heightfield.ts. Assumes F is already loaded from heightfield.ts and rng
// exists. Do not run standalone — assert fragments only.

// —— horns are a fact about the seed ———————————————————————————————
// The bug: horns re-drawn every tap, or a cache that freezes the first seed's
// horns into every later mountain.
{
  const hornsA = F.hornsForSeed(0xbeef);
  const hornsB = F.hornsForSeed(0xbeef);
  assert.deepEqual(hornsA, hornsB, "the same seed always yields the same horns");
  const hornsC = F.hornsForSeed(0xbeee);
  const same =
    hornsA.length === hornsC.length &&
    hornsA.every((h, i) => {
      const c = hornsC[i];
      return (
        Math.abs(h.cx - c.cx) < 1e-12 &&
        Math.abs(h.cz - c.cz) < 1e-12 &&
        Math.abs(h.amp - c.amp) < 1e-12
      );
    });
  assert.ok(!same, "a different seed is a different horn set — centres or amps move");
  assert.equal(hornsA.length, F.HORN_COUNT, "the seed places exactly the designed horn count");
  for (const h of hornsA) {
    const r = Math.hypot(h.cx, h.cz);
    assert.ok(
      r >= F.HORN_RING_INNER_KM && r <= F.HORN_RING_OUTER_KM,
      `each horn sits on the ring (${r} km from origin)`,
    );
  }
  for (let i = 0; i < hornsA.length; i++) {
    for (let j = i + 1; j < hornsA.length; j++) {
      const sep = Math.hypot(hornsA[i].cx - hornsA[j].cx, hornsA[i].cz - hornsA[j].cz);
      assert.ok(
        sep >= F.HORN_MIN_SEP_KM - 1e-9,
        `horns do not stack on each other (${sep} km apart)`,
      );
    }
  }
  assert.ok(F.HORN_AMP_KM <= F.SUMMIT_KM, "horn amplitude stays inside the summit cone's scale");
}

// —— the horn field is smooth: its gradient matches finite differences ————
// The bug: a horn term copied without the chain rule, or a max-fold skip that
// makes the analytic ∂h_horn disagree with the height — invisible until light
// catches a needle peak wrong.
{
  const H = 1e-4;
  for (const seed of [1, 0xbeef, 0x5eed]) {
    let checked = 0;
    let worst = 0;
    for (let i = 0; i < 800; i++) {
      const x = (rng() - 0.5) * 40;
      const z = (rng() - 0.5) * 40;
      const g = F.hornsAt(x, z, seed);
      checked++;
      const fdx = (F.hornField(x + H, z, seed) - F.hornField(x - H, z, seed)) / (2 * H);
      const fdz = (F.hornField(x, z + H, seed) - F.hornField(x, z - H, seed)) / (2 * H);
      worst = Math.max(worst, Math.abs(fdx - g.dhdx), Math.abs(fdz - g.dhdz));
    }
    assert.ok(
      worst < 5e-3,
      `seed ${seed}: horn ∂h agrees with finite differences (worst ${worst})`,
    );
    assert.ok(checked > 750, "the horn field was actually sampled");
  }
  // Path integral of the analytic horn gradient — horns are C∞, no crease skip.
  for (const seed of [1, 0xbeef]) {
    let worstRel = 0;
    for (let k = 0; k < 20; k++) {
      const x0 = (rng() - 0.5) * 30;
      const z0 = (rng() - 0.5) * 30;
      const a = rng() * Math.PI * 2;
      const L = 0.5 + rng() * 1.2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const N = 3000;
      const ds = L / N;
      let integral = 0;
      for (let i = 0; i < N; i++) {
        const s = (i + 0.5) * ds;
        const g = F.hornsAt(x0 + dx * s, z0 + dz * s, seed);
        integral += (g.dhdx * dx + g.dhdz * dz) * ds;
      }
      const delta =
        F.hornField(x0 + dx * L, z0 + dz * L, seed) - F.hornField(x0, z0, seed);
      const travel = Math.max(0.02, Math.abs(delta));
      worstRel = Math.max(worstRel, Math.abs(integral - delta) / travel);
    }
    assert.ok(
      worstRel < 0.02,
      `seed ${seed}: ∫∇h_horn·dl equals the horn height climbed (worst relative ${worstRel})`,
    );
  }
}

// —— full groundAt integral still holds with horns —————————————————————
// The existing ∫∇h·dl block (4 seeds, 40 paths, 1% relative bound) already
// exercises groundAt once horns are folded into heightAt. Re-run that suite
// after merge — if it fails, the bug is horns breaking the closed-form chain
// rule on the combined field, not a missing horn-only check.
// (No duplicate block here — extend the existing headline assertion's comment
// to name horns when pasting.)

// —— HEIGHT_MAX still upper-bounds the field with horns ————————————————
// The bug: horns stacked on top of HEIGHT_MAX_KM instead of inside the cone
// budget, so the marcher's ceiling exit lies below real peaks.
for (const seed of [1, 0xbeef, 42, 0x5eed]) {
  let hi = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const h = F.heightAt((rng() - 0.5) * 90, (rng() - 0.5) * 90, seed);
    hi = Math.max(hi, h);
  }
  assert.ok(hi <= F.HEIGHT_MAX_KM, `seed ${seed}: horns included, nothing above the ceiling (${hi})`);
}

// —— corniceStrength: lee/windward asymmetry on a knife edge ————————————
// The bug: cornices on both sides of a ridge, or strength that ignores wind —
// the room's snow shelves would face the wrong way.
{
  const windE = F.windVector(0xbeef);
  assert.ok(Math.hypot(windE[0], windE[1]) > 0.9, "wind is a unit vector in the horizontal plane");
  assert.deepEqual(F.windVector(0xbeef), F.windVector(0xbeef), "wind is a fact about the seed");

  const windward = F.corniceStrength(0, 1, 0, [1, 0]);
  const lee = F.corniceStrength(0, 1, 0, [-1, 0]);
  assert.ok(windward < 0.05, `windward face is bare (${windward})`);
  assert.ok(lee > 0.95, `lee face holds snow (${lee})`);
  assert.equal(F.corniceStrength(1, 1, 0, [-1, 0]), 0, "a rounded ridge has no cornice");
  assert.equal(F.corniceStrength(0, 0, 0, [-1, 0]), 0, "a flat summit has no cornice");
  assert.ok(F.corniceStrength(0, 0.3, 0.3, [-1, 0]) < 0.05, "gentle slopes do not cornice");
}

// —— materialFromGround: snow, rock, glacier, cornice ——————————————————
// The bug: materials that do not partition the surface, cornice leaking above
// crease hi, or glacier/snow fighting on the same slope band.
{
  const season = 0.42;
  const snowline = F.snowlineKm(season);

  const snowDom = F.materialFromGround(
    { h: snowline + 0.25, dhdx: 0.05, dhdz: 0.05, crease: 0.35, foldMargin: 0.2 },
    season,
  );
  assert.ok(snowDom.snow > snowDom.rock && snowDom.snow > snowDom.glacier, "high flat ridge → snow");

  const rockDom = F.materialFromGround(
    { h: snowline + 0.3, dhdx: 1.2, dhdz: 0.4, crease: 0.5, foldMargin: 0.15 },
    season,
  );
  assert.ok(rockDom.rock > rockDom.snow && rockDom.rock > rockDom.glacier, "steep high face → rock");

  const tongueMid = (F.GLACIER_TONGUE_LO_KM + F.GLACIER_TONGUE_HI_KM) / 2;
  const glacierDom = F.materialFromGround(
    { h: tongueMid, dhdx: 0.15, dhdz: 0.1, crease: 0.3, foldMargin: 0.25 },
    season,
  );
  assert.ok(
    glacierDom.glacier > glacierDom.rock && glacierDom.glacier > glacierDom.snow,
    "glacier tongue band → glacier",
  );

  for (let s = 0; s <= 2; s += 0.13) {
    const m0 = F.materialAt(3.1, -2.4, 0xbeef, s);
    const m1 = F.materialAt(3.1, -2.4, 0xbeef, s + 1);
    assert.deepEqual(m0, m1, "materialAt is periodic in season (period 1)");
  }

  for (let i = 0; i < 200; i++) {
    const x = (rng() - 0.5) * 20;
    const z = (rng() - 0.5) * 20;
    const m = F.materialAt(x, z, 0xbeef, season);
    assert.ok(m.cornice >= 0 && m.cornice <= 1, "cornice stays in [0,1]");
    const sum = m.rock + m.snow + m.glacier;
    assert.ok(Math.abs(sum - 1) < 1e-6, `rock+snow+glacier partition the face (${sum})`);
    const g = F.groundAt(x, z, 0xbeef);
    if (g.crease > F.CORNICE_CREASE_HI) {
      assert.ok(m.cornice < 0.05, "rounded ridges shed cornice");
    }
  }
}

// —— summit fraction after horn retune —————————————————————————————————
// Measure before loosening: eyeAltitude > HEIGHT_MAX * 0.55 was the bound
// before horns. If retune raises the ceiling, only then drop to 0.50 —
// taller summits occupy a smaller fraction of a taller range.
for (const seed of [1, 0xbeef, 42]) {
  const eye = F.eyeAltitude(seed);
  const frac = eye / F.HEIGHT_MAX_KM;
  // If this fails after horn merge, measure frac across seeds first; loosen
  // to 0.50 only when summit fraction of the taller ceiling genuinely dips.
  assert.ok(
    frac > 0.55,
    `seed ${seed}: the summit is still a summit (eye at ${frac.toFixed(3)} of ceiling)`,
  );
}

// —— replace the final console.log summary with ————————————————————————
// console.log(
//   "heightfield ok: analytic ∂h agreeing with finite differences off the creases over 4 seeds, horn ∂h smooth and path-integrable, horns deterministic on the ring with separation, the ridge fold C⁰ but not C¹, the range bounded including horns so the marcher's ceiling exit is sound, cornice lee/windward asymmetry and glacier tongue classification, fog optical depth matching both hand-computable cases and monotone in path length, raising the fog only ever drowning more land, 64 steps never exceeded with a vertical hit landing where the height says, the sun palette continuous and never darkening as it climbs, and every echo bounded in time",
// );
