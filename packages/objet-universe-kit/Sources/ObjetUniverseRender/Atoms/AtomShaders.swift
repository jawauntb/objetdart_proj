/// Atomic material shader. The four readings are orbit, periodic register,
/// covalent bond, and fusion. Every luminous structure comes from a supplied
/// atom identity or bond relation; this shader does not synthesize a particle
/// population of its own.
enum AtomShaderSource {
  static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct AtomUniforms {
    float2 viewport;
    float elapsed;
    float frozenElapsed;
    float fusionEnergy;
    uint representation;
    uint bodyCount;
    uint reducedMotion;
    float breathSeconds;
  };

  struct AtomBody {
    float4 positionExcitation;
    float4 shellValenceVelocity;
  };

  struct AtomBond {
    float4 endpoints;
    float4 relation;
  };

  struct FullscreenOut {
    float4 position [[position]];
    float2 uv;
  };

  struct AtomPointOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float4 identity;
    float2 velocity;
  };

  struct BondOut {
    float4 position [[position]];
    float2 local;
    float4 relation;
  };

  constant float3 kNight = float3(0.0118, 0.0157, 0.0392);
  constant float3 kVoid = float3(0.0275, 0.0392, 0.0902);
  constant float3 kSea = float3(0.3569, 0.7333, 0.8588);
  constant float3 kPaleSea = float3(0.6941, 0.8784, 0.9255);
  constant float3 kEmber = float3(0.9059, 0.6392, 0.2980);
  constant float3 kHot = float3(0.9608, 0.3098, 0.2314);

  constant float2 kBondCorners[6] = {
    float2(0.0, -1.0), float2(1.0, -1.0), float2(0.0, 1.0),
    float2(0.0, 1.0), float2(1.0, -1.0), float2(1.0, 1.0)
  };

  float presentationElapsed(constant AtomUniforms &u) {
    return u.reducedMotion > 0u ? u.frozenElapsed : u.elapsed;
  }

  float2 worldToClip(float2 world, constant AtomUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    // Keep the atom instrument circular on a phone instead of stretching
    // shells into ellipses to fill portrait height.
    return float2(world.x * cover.y, -world.y * cover.x);
  }

  float2 periodicPosition(float rawZ) {
    float z = clamp(round(rawZ), 1.0, 26.0);
    float column = 0.0;
    float row = 0.0;
    if (z <= 1.0) {
      column = 0.0;
      row = 0.0;
    } else if (z <= 2.0) {
      column = 17.0;
      row = 0.0;
    } else if (z <= 4.0) {
      column = z - 3.0;
      row = 1.0;
    } else if (z <= 10.0) {
      column = z + 7.0;
      row = 1.0;
    } else if (z <= 12.0) {
      column = z - 11.0;
      row = 2.0;
    } else if (z <= 18.0) {
      column = z - 1.0;
      row = 2.0;
    } else if (z <= 20.0) {
      column = z - 19.0;
      row = 3.0;
    } else {
      column = z - 19.0;
      row = 3.0;
    }
    return float2((column - 8.5) / 9.5, 0.72 - row * 0.48);
  }

  float2 presentationPosition(float2 material, float atomicNumber, constant AtomUniforms &u) {
    return u.representation == 1u ? periodicPosition(atomicNumber) : material;
  }

  float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float3 elementalColour(float atomicNumber) {
    float phase = fract(atomicNumber * 0.38196601125);
    return mix(mix(kSea * 0.62, kPaleSea, phase), kEmber, smoothstep(0.78, 1.0, phase) * 0.42);
  }

  vertex FullscreenOut objet_atoms_fullscreen_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    FullscreenOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  fragment float4 objet_atoms_background_fragment(
    FullscreenOut in [[stage_in]],
    constant AtomUniforms &u [[buffer(0)]]
  ) {
    float time = presentationElapsed(u);
    float2 px = in.uv * u.viewport;
    float2 cell = floor(px / 5.0);
    float dust = hash21(cell);
    float star = step(0.992, dust) * (0.10 + 0.28 * hash21(cell + 4.0));
    float breath = 0.5 + 0.5 * sin(time * (6.28318530718 / max(u.breathSeconds, 0.001)) + 0.7);
    float radial = exp(-dot((in.uv - 0.5) * float2(1.1, 0.8), (in.uv - 0.5) * float2(1.1, 0.8)) * 2.4);
    float3 colour = kNight + kVoid * (0.28 * radial + 0.06 * breath);
    colour += kPaleSea * star;

    if (u.representation == 1u) {
      // A subdued periodic register, not a dashboard grid: the atom records
      // own the bright cells and this only gives their rows a shared measure.
      float2 registerCell = fract(in.uv * float2(18.0, 4.2));
      float hairline = 1.0 - smoothstep(0.014, 0.042, min(registerCell.x, registerCell.y));
      colour += kSea * hairline * 0.045;
    }

    if (u.representation == 3u) {
      float heat = saturate(abs(u.fusionEnergy) * 0.16);
      float origin = exp(-length((in.uv - 0.5) * float2(1.0, 1.6)) * (3.6 - heat * 1.8));
      float rings = 0.5 + 0.5 * sin(length((in.uv - 0.5) * float2(1.0, 1.6)) * 38.0 - time * 2.2);
      colour += mix(kEmber, kHot, heat) * origin * (0.05 + heat * 0.26 + rings * heat * 0.08);
    }

    float vignette = 1.0 - smoothstep(0.26, 1.44, length((in.uv - 0.5) * 2.0));
    colour *= 0.62 + 0.38 * vignette;
    return float4(colour, 1.0);
  }

  vertex BondOut objet_atoms_bond_vertex(
    uint vertexID [[vertex_id]],
    uint instanceID [[instance_id]],
    const device AtomBond *bonds [[buffer(0)]],
    constant AtomUniforms &u [[buffer(1)]]
  ) {
    AtomBond bond = bonds[instanceID];
    float2 first = presentationPosition(bond.endpoints.xy, bond.relation.y, u);
    float2 second = presentationPosition(bond.endpoints.zw, bond.relation.z, u);
    float2 direction = second - first;
    float distance = max(length(direction), 0.0001);
    float2 normal = float2(-direction.y, direction.x) / distance;
    float2 corner = kBondCorners[vertexID];
    float strength = u.representation == 2u ? 1.0 : (u.representation == 3u ? 0.72 : 0.42);
    float thickness = (0.010 + bond.relation.x * 0.005 + bond.relation.w * 0.006) * strength;
    float2 material = mix(first, second, corner.x) + normal * corner.y * thickness;
    BondOut out;
    out.position = float4(worldToClip(material, u), 0.0, 1.0);
    out.local = corner;
    out.relation = bond.relation;
    return out;
  }

  fragment float4 objet_atoms_bond_fragment(
    BondOut in [[stage_in]],
    constant AtomUniforms &u [[buffer(0)]]
  ) {
    float across = 1.0 - smoothstep(0.56, 1.0, abs(in.local.y));
    float orderPulse = 0.5 + 0.5 * sin(presentationElapsed(u) * (0.9 + in.relation.x * 0.18) + in.local.x * 9.0);
    float bondStrength = u.representation == 2u ? 0.86 : (u.representation == 3u ? 0.56 : 0.30);
    float3 colour = mix(elementalColour(in.relation.y), elementalColour(in.relation.z), in.local.x);
    colour = mix(colour, kPaleSea, 0.34 + in.relation.w * 0.28);
    if (u.representation == 3u) {
      colour = mix(colour, kEmber, 0.56 + 0.18 * orderPulse);
    }
    return float4(colour, across * bondStrength * (0.70 + 0.30 * orderPulse));
  }

  vertex AtomPointOut objet_atoms_body_vertex(
    uint vertexID [[vertex_id]],
    const device AtomBody *bodies [[buffer(0)]],
    constant AtomUniforms &u [[buffer(1)]]
  ) {
    AtomBody body = bodies[vertexID];
    float excitation = saturate(body.positionExcitation.z);
    float atomicNumber = body.positionExcitation.w;
    float shellCount = max(body.shellValenceVelocity.x, 1.0);
    float representationScale = u.representation == 1u ? 0.72 : (u.representation == 3u ? 1.18 : 1.0);
    AtomPointOut out;
    out.position = float4(worldToClip(presentationPosition(body.positionExcitation.xy, atomicNumber, u), u), 0.0, 1.0);
    out.pointSize = clamp((46.0 + shellCount * 10.0 + excitation * 28.0) * representationScale, 38.0, 132.0);
    out.identity = float4(excitation, atomicNumber, shellCount, body.shellValenceVelocity.y);
    out.velocity = body.shellValenceVelocity.zw;
    return out;
  }

  fragment float4 objet_atoms_body_fragment(
    AtomPointOut in [[stage_in]],
    float2 point [[point_coord]],
    constant AtomUniforms &u [[buffer(0)]]
  ) {
    float2 centred = (point - 0.5) * 2.0;
    float radius = length(centred);
    float square = max(abs(centred.x), abs(centred.y));
    float time = presentationElapsed(u);
    float excitation = in.identity.x;
    float atomicNumber = in.identity.y;
    float shellCount = max(in.identity.z, 1.0);
    float valence = in.identity.w;
    float3 elemental = elementalColour(atomicNumber);

    if (u.representation == 1u) {
      if (square > 0.92) discard_fragment();
      float cellBorder = 1.0 - smoothstep(0.66, 0.90, square);
      float dotRadius = length(centred - float2(0.33, -0.31));
      float electronMark = 1.0 - smoothstep(0.045, 0.12, dotRadius);
      float rung = 1.0 - smoothstep(0.014, 0.050, abs(centred.y + 0.15));
      float3 colour = mix(kVoid, elemental, cellBorder * (0.44 + excitation * 0.44));
      colour += kPaleSea * electronMark * (0.38 + 0.10 * shellCount);
      colour += kEmber * rung * saturate(valence / 4.0) * 0.24;
      return float4(colour, 0.86 * cellBorder + electronMark * 0.12);
    }

    if (radius > 1.0) discard_fragment();
    float angle = atan2(centred.y, centred.x);
    float orbitalPhase = angle * (2.0 + fmod(shellCount, 3.0)) - time * (0.34 + excitation * 0.88) + atomicNumber * 0.27;
    float lobe = pow(abs(cos(orbitalPhase)), 2.3);
    float halo = exp(-radius * radius * (2.5 + shellCount * 0.48));
    float core = 1.0 - smoothstep(0.0, 0.23 + excitation * 0.05, radius);
    float shellAccumulator = 0.0;
    for (int shell = 1; shell <= 4; shell++) {
      if (float(shell) <= shellCount) {
        float shellRadius = 0.23 + float(shell) * 0.15;
        float ring = 1.0 - smoothstep(0.018, 0.055, abs(radius - shellRadius));
        float electron = pow(saturate(cos(angle * (float(shell) + 1.0) - time * (0.5 + excitation))), 18.0);
        shellAccumulator += ring * (0.34 + electron * 0.66);
      }
    }
    float lobeField = exp(-radius * radius * 2.6) * lobe * (0.26 + excitation * 0.58);
    float edge = smoothstep(1.0, 0.72, radius);
    float3 colour = elemental * (halo * 0.28 + lobeField * 0.82 + shellAccumulator * 0.34);
    colour += kPaleSea * core * (0.44 + excitation * 0.42);

    if (u.representation == 2u) {
      float shared = exp(-radius * radius * 2.0) * (0.26 + valence * 0.09);
      colour += mix(kSea, kPaleSea, lobe) * shared;
      colour += kEmber * shellAccumulator * saturate(valence / 4.0) * 0.26;
    }
    if (u.representation == 3u) {
      float fusion = saturate(abs(u.fusionEnergy) * 0.16 + excitation * 0.35);
      float shock = 1.0 - smoothstep(0.025, 0.095, abs(radius - (0.34 + fusion * 0.28)));
      colour = mix(colour, kHot, fusion * (0.42 + core * 0.32));
      colour += kEmber * shock * (0.28 + fusion * 0.72);
    }
    return float4(colour, edge * (0.40 + halo * 0.28 + shellAccumulator * 0.24 + core * 0.32));
  }
  """
}
