/// Molecule material shader. The four readings are mixture, structural
/// geometry, reaction ledger, and vibration. A body arrives with a real
/// compound register, geometry family, formula atom count, and vibration;
/// this shader only gives those facts light and motion.
enum MoleculeShaderSource {
  static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct MoleculeUniforms {
    float2 viewport;
    float elapsed;
    float frozenElapsed;
    float reactionEnergy;
    uint representation;
    uint reducedMotion;
    float breathSeconds;
  };

  struct MoleculeBody {
    float4 positionVibration;
    float4 geometryVelocity;
  };

  struct FullscreenOut {
    float4 position [[position]];
    float2 uv;
  };

  struct MoleculePointOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float4 identity;
    float3 tint;
  };

  constant float3 kNight = float3(0.0098, 0.0157, 0.0314);
  constant float3 kDeep = float3(0.0196, 0.0471, 0.0824);
  constant float3 kSea = float3(0.2863, 0.7373, 0.8118);
  constant float3 kPale = float3(0.7098, 0.9059, 0.9176);
  constant float3 kCoral = float3(0.9451, 0.4471, 0.3529);
  constant float3 kGold = float3(0.9294, 0.7216, 0.3569);

  float presentationElapsed(constant MoleculeUniforms &u) {
    return u.reducedMotion > 0u ? u.frozenElapsed : u.elapsed;
  }

  float2 worldToClip(float2 world, constant MoleculeUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    return float2(world.x * cover.y, -world.y * cover.x);
  }

  float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float3 compoundColour(float index) {
    uint compound = uint(clamp(round(index), 0.0, 7.0));
    switch (compound) {
      case 0u: return float3(0.2902, 0.7765, 0.8902); // water
      case 1u: return float3(0.6588, 0.7922, 0.9137); // carbon dioxide
      case 2u: return float3(0.4941, 0.9255, 0.6706); // methane
      case 3u: return float3(0.8039, 0.6510, 0.9804); // ammonia
      case 4u: return float3(0.9608, 0.4549, 0.3804); // oxygen
      case 5u: return float3(0.4392, 0.6627, 0.9686); // nitrogen
      case 6u: return float3(0.9725, 0.8627, 0.5961); // hydrogen
      default: return float3(0.8863, 0.7608, 0.5451); // salt
    }
  }

  float2 peripheralPosition(uint index, uint shape) {
    // bent, linear, tetrahedral, trigonal, diatomic, ionic
    if (shape == 0u) {
      return (index == 0u ? float2(-0.42, 0.21) : float2(0.42, 0.21));
    }
    if (shape == 1u) {
      return (index == 0u ? float2(-0.47, 0.0) : float2(0.47, 0.0));
    }
    if (shape == 2u) {
      if (index == 0u) { return float2(0.3041, 0.3041); }
      if (index == 1u) { return float2(-0.3041, 0.3041); }
      if (index == 2u) { return float2(-0.3041, -0.3041); }
      return float2(0.3041, -0.3041);
    }
    if (shape == 3u) {
      if (index == 0u) { return float2(0.0, -0.44); }
      if (index == 1u) { return float2(0.3811, 0.22); }
      return float2(-0.3811, 0.22);
    }
    if (shape == 5u) {
      return float2(0.49, 0.0);
    }
    return float2(0.47, 0.0);
  }

  float segmentDistance(float2 p, float2 a, float2 b) {
    float2 ab = b - a;
    float span = max(dot(ab, ab), 0.0001);
    float t = clamp(dot(p - a, ab) / span, 0.0, 1.0);
    return length(p - (a + ab * t));
  }

  vertex FullscreenOut objet_molecules_fullscreen_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    FullscreenOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  fragment float4 objet_molecules_background_fragment(
    FullscreenOut in [[stage_in]],
    constant MoleculeUniforms &u [[buffer(0)]]
  ) {
    float time = presentationElapsed(u);
    float2 px = in.uv * u.viewport;
    float2 grainCell = floor(px / 7.0);
    float grain = hash21(grainCell);
    float dust = step(0.985, grain) * (0.014 + 0.038 * hash21(grainCell + 7.0));
    float breath = 0.5 + 0.5 * sin(time * 6.28318530718 / max(u.breathSeconds, 0.001) + 1.3);
    float2 centre = (in.uv - 0.5) * float2(1.05, 1.62);
    float well = exp(-dot(centre, centre) * 2.35);
    float3 colour = kNight + kDeep * (0.34 * well + 0.05 * breath);
    colour += kPale * dust;

    if (u.representation == 1u) {
      float2 lattice = fract(in.uv * float2(9.0, 18.0));
      float guide = 1.0 - smoothstep(0.008, 0.028, min(lattice.x, lattice.y));
      colour += kSea * guide * 0.035;
    }
    if (u.representation == 2u) {
      float energy = saturate(abs(u.reactionEnergy) / 900.0);
      float radius = length(centre);
      float ring = 1.0 - smoothstep(0.014, 0.052, abs(fract(radius * 5.3 - time * 0.17) - 0.5));
      colour += mix(kCoral, kGold, energy) * ring * exp(-radius * 1.85) * (0.04 + energy * 0.18);
    }
    if (u.representation == 3u) {
      float ripple = 0.5 + 0.5 * sin((in.uv.y * 29.0 + in.uv.x * 17.0) - time * 1.35);
      colour += kSea * ripple * well * 0.026;
    }
    float vignette = 1.0 - smoothstep(0.30, 1.45, length((in.uv - 0.5) * 2.0));
    return float4(colour * (0.62 + 0.38 * vignette), 1.0);
  }

  vertex MoleculePointOut objet_molecules_body_vertex(
    uint vertexID [[vertex_id]],
    const device MoleculeBody *bodies [[buffer(0)]],
    constant MoleculeUniforms &u [[buffer(1)]]
  ) {
    MoleculeBody body = bodies[vertexID];
    float time = presentationElapsed(u);
    float vibration = saturate(body.positionVibration.z);
    float2 material = body.positionVibration.xy;
    float drift = (u.representation == 0u ? 0.009 : 0.004) * (0.25 + vibration);
    material += body.geometryVelocity.zw * sin(time * 0.73 + body.positionVibration.w) * drift;
    float readingScale = u.representation == 1u ? 1.18 : (u.representation == 2u ? 1.12 : 1.0);
    MoleculePointOut out;
    out.position = float4(worldToClip(material, u), 0.0, 1.0);
    out.pointSize = clamp((94.0 + body.geometryVelocity.y * 21.0 + vibration * 48.0) * readingScale, 88.0, 216.0);
    out.identity = float4(
      vibration,
      body.positionVibration.w,
      body.geometryVelocity.x,
      body.geometryVelocity.y
    );
    out.tint = compoundColour(body.positionVibration.w);
    return out;
  }

  fragment float4 objet_molecules_body_fragment(
    MoleculePointOut in [[stage_in]],
    float2 point [[point_coord]],
    constant MoleculeUniforms &u [[buffer(0)]]
  ) {
    float2 p = (point - 0.5) * 2.0;
    float time = presentationElapsed(u);
    float vibration = in.identity.x;
    uint shape = uint(clamp(round(in.identity.z), 0.0, 5.0));
    uint peripheralCount = uint(clamp(round(in.identity.w) - 1.0, 1.0, 4.0));
    float3 compound = in.tint;
    float3 peripheral = mix(kPale, compound, shape == 5u ? 0.82 : 0.30);
    float central = 1.0 - smoothstep(0.12, 0.19, length(p));
    float centralGlow = exp(-dot(p, p) * (7.0 - vibration * 2.0));
    float bond = 0.0;
    float sites = central;
    float outerPulse = 0.0;
    for (uint index = 0u; index < 4u; index++) {
      if (index >= peripheralCount) { continue; }
      float2 outer = peripheralPosition(index, shape);
      if (u.representation == 3u) {
        float phase = time * (1.4 + vibration * 2.8) + float(index) * 1.9 + in.identity.y;
        outer *= 1.0 + sin(phase) * (0.05 + vibration * 0.16);
        outerPulse = max(outerPulse, 0.5 + 0.5 * sin(phase));
      }
      float outerSite = 1.0 - smoothstep(0.105, 0.17, length(p - outer));
      float bondWidth = u.representation == 1u ? 0.030 : (u.representation == 2u ? 0.046 : 0.024);
      float path = 1.0 - smoothstep(bondWidth, bondWidth + 0.026, segmentDistance(p, float2(0.0), outer));
      sites = max(sites, outerSite);
      bond = max(bond, path);
    }
    float envelope = 1.0 - smoothstep(0.92, 1.30, length(p));
    float energy = saturate(abs(u.reactionEnergy) / 900.0);
    float reactionRing = 0.0;
    if (u.representation == 2u) {
      float radius = length(p);
      reactionRing = 1.0 - smoothstep(0.028, 0.075, abs(radius - (0.50 + 0.10 * sin(time * 2.4 + in.identity.y))));
      reactionRing *= 0.30 + energy * 0.70;
    }
    float vibrationRing = 0.0;
    if (u.representation == 3u) {
      float wave = 0.5 + 0.5 * sin(length(p) * 25.0 - time * (3.2 + vibration * 3.8));
      vibrationRing = wave * exp(-length(p) * 2.5) * vibration;
    }
    float3 colour = compound * (central * 0.92 + centralGlow * 0.42 + bond * 0.43);
    colour += peripheral * (max(sites - central, 0.0) * 0.90 + bond * 0.22);
    colour += kPale * bond * (u.representation == 1u ? 0.40 : 0.16);
    colour += mix(kCoral, kGold, energy) * reactionRing * (0.46 + energy * 0.54);
    colour += kSea * vibrationRing * (0.32 + outerPulse * 0.44);
    float alpha = (sites * 0.92 + bond * 0.56 + centralGlow * 0.22 + reactionRing * 0.68 + vibrationRing * 0.32) * envelope;
    if (alpha < 0.008) { discard_fragment(); }
    return float4(colour, min(alpha, 0.96));
  }
  """
}
