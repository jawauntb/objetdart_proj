/// The wave material, written in Metal Shading Language.
///
/// It is carried as source and compiled once at `prepare()` rather than
/// shipped as a `.metal` file because the kit is packaged twice — as a Swift
/// package for `swift test` and as a CocoaPod for the Expo prebuild — and only
/// one of those two paths would produce a `default.metallib` the other could
/// find. One embedded string compiles identically under both, at a cost paid
/// once per launch off the frame path.
///
/// The palette is the shared one: `night` is the ground, `sea` is the coherent
/// medium, `ember` is the decisive event. The values are the sRGB hexes in
/// `apps/native/src/design/tokens.ts`; changing one here without changing it
/// there splits the palette in two.
public enum WaveShaderSource {
  public static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct Uniforms {
    float2 viewport;
    float2 fieldSize;
    float elapsed;
    float exposure;
    float representation;
    float materialKind;
    float breathSeconds;
    float pad;
  };

  struct VertexOut {
    float4 position [[position]];
    float2 uv;
  };

  // #050914 night.deep, #0E2A44 sea.deep, #3A88C1 sea.lit,
  // #8BC2E5 sea.glimmer, #E7A34C ember.warm.
  constant float3 kNightDeep = float3(0.0196, 0.0353, 0.0784);
  constant float3 kSeaDeep = float3(0.0549, 0.1647, 0.2667);
  constant float3 kSeaLit = float3(0.2275, 0.5333, 0.7569);
  constant float3 kSeaGlimmer = float3(0.5451, 0.7608, 0.8980);
  constant float3 kEmberWarm = float3(0.9059, 0.6392, 0.2980);

  vertex VertexOut objet_wave_vertex(uint vertexID [[vertex_id]]) {
    // One oversized triangle covering the clip volume: no vertex buffer, no
    // per-frame geometry upload.
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    VertexOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  fragment float4 objet_wave_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> surface [[texture(0)]],
    sampler surfaceSampler [[sampler(0)]],
    constant Uniforms &uniforms [[buffer(0)]]
  ) {
    // Aspect-fill: the tank is square and the screen is not, so the short
    // axis is cropped rather than letterboxed. Wavelength stays isotropic.
    float longest = max(uniforms.viewport.x, uniforms.viewport.y);
    float2 cover = uniforms.viewport / max(longest, 1.0);
    float2 fieldUV = (in.uv - 0.5) * cover + 0.5;

    float amplitude = surface.sample(surfaceSampler, fieldUV).r * uniforms.exposure;

    // Cell and solar scenes share the field transport with waves, but their
    // visual grammar is different. These branches stay on the GPU so the
    // simulation can remain a compact scalar projection without adding a
    // second entity renderer or per-frame geometry allocation.
    if (uniforms.materialKind > 0.5 && uniforms.materialKind < 1.5) {
      if (uniforms.representation > 1.5 && uniforms.representation < 2.5) {
        float phase = in.uv.y * 31.0 + uniforms.elapsed * 0.55;
        float strandA = 1.0 - smoothstep(0.0, 0.045, abs(in.uv.x - (0.5 + 0.18 * sin(phase))));
        float strandB = 1.0 - smoothstep(0.0, 0.045, abs(in.uv.x - (0.5 - 0.18 * sin(phase))));
        float rung = (1.0 - smoothstep(0.0, 0.035, abs(in.uv.x - 0.5))) * (0.35 + 0.65 * abs(sin(phase)));
        float3 genome = mix(kNightDeep, float3(0.10, 0.07, 0.25), 0.45 + 0.35 * amplitude);
        genome += float3(0.36, 0.18, 0.78) * max(strandA, strandB);
        genome += kSeaGlimmer * rung * 0.35;
        return float4(genome, 1.0);
      }
      if (uniforms.representation > 2.5) {
        float fold = abs(sin(in.uv.x * 12.0 + in.uv.y * 8.0 + uniforms.elapsed * 0.18));
        float pocket = 1.0 - smoothstep(0.0, 0.2, abs(fold - 0.62));
        float3 protein = mix(float3(0.025, 0.045, 0.06), float3(0.64, 0.29, 0.12), amplitude * 0.72);
        protein += float3(0.86, 0.63, 0.28) * pocket * 0.45;
        return float4(protein, 1.0);
      }
      float colony = smoothstep(0.04, 0.55, amplitude);
      float edge = smoothstep(0.04, 0.0, abs(amplitude - 0.36));
      float breathing = 0.5 + 0.5 * sin(uniforms.elapsed * 1.7 + in.uv.x * 9.0 + in.uv.y * 7.0);
      float3 cellDeep = float3(0.015, 0.055, 0.060);
      float3 cellTeal = float3(0.10, 0.53, 0.43);
      float3 cellLime = float3(0.62, 0.84, 0.39);
      float3 cellColour = mix(cellDeep, cellTeal, colony);
      cellColour = mix(cellColour, cellLime, edge * (0.72 + 0.2 * breathing));
      cellColour += kSeaGlimmer * smoothstep(0.62, 1.0, amplitude) * 0.18;
      return float4(cellColour, 1.0);
    }

    if (uniforms.materialKind > 1.5) {
      if (uniforms.materialKind > 2.5 && uniforms.materialKind < 3.5) {
        if (uniforms.representation < 0.5) {
          float shell = smoothstep(0.02, 0.42, amplitude);
          float orbit = 0.5 + 0.5 * sin(length((in.uv - 0.5) * 2.0) * 34.0 - uniforms.elapsed * 1.2);
          float3 atom = mix(kNightDeep, float3(0.18, 0.08, 0.28), shell * 0.75);
          atom += float3(0.36, 0.20, 0.82) * shell * orbit * 0.7;
          atom += kSeaGlimmer * smoothstep(0.55, 1.0, amplitude) * 0.4;
          return float4(atom, 1.0);
        }
        if (uniforms.representation < 1.5) {
          float grid = step(0.88, fract(in.uv.x * 7.0)) + step(0.88, fract(in.uv.y * 6.0));
          float periodic = smoothstep(0.08, 0.55, amplitude);
          float3 table = mix(kNightDeep, float3(0.27, 0.10, 0.18), periodic * 0.65);
          table += kEmberWarm * grid * 0.35;
          table += kSeaGlimmer * smoothstep(0.65, 1.0, amplitude) * 0.28;
          return float4(table, 1.0);
        }
        if (uniforms.representation < 2.5) {
          float bond = smoothstep(0.18, 0.62, amplitude);
          float strand = 0.5 + 0.5 * sin(in.uv.x * 46.0 + uniforms.elapsed * 0.8);
          float3 shared = mix(kNightDeep, float3(0.12, 0.32, 0.38), bond);
          shared += kSeaGlimmer * bond * strand * 0.55;
          shared += kEmberWarm * smoothstep(0.72, 1.0, amplitude) * 0.3;
          return float4(shared, 1.0);
        }
        float flash = smoothstep(0.18, 0.9, amplitude);
        float radial = 1.0 - smoothstep(0.0, 0.7, length((in.uv - 0.5) * 2.0));
        float3 fusion = mix(kNightDeep, float3(0.30, 0.05, 0.08), flash);
        fusion += kEmberWarm * flash * radial;
        fusion += kSeaGlimmer * smoothstep(0.78, 1.0, amplitude) * 0.35;
        return float4(fusion, 1.0);
      }

      if (uniforms.materialKind > 3.5) {
        if (uniforms.representation < 0.5) {
          float mixture = smoothstep(0.02, 0.48, amplitude);
          float drift = 0.5 + 0.5 * sin(in.uv.x * 9.0 + in.uv.y * 7.0 + uniforms.elapsed * 0.32);
          float3 field = mix(kNightDeep, float3(0.06, 0.27, 0.30), mixture);
          field += kSeaGlimmer * mixture * drift * 0.35;
          return float4(field, 1.0);
        }
        if (uniforms.representation < 1.5) {
          float scaffold = smoothstep(0.16, 0.55, amplitude);
          float bond = 1.0 - smoothstep(0.0, 0.06, abs(sin(in.uv.x * 16.0) - sin(in.uv.y * 13.0)));
          float3 structure = mix(kNightDeep, float3(0.08, 0.34, 0.42), scaffold);
          structure += kEmberWarm * bond * scaffold * 0.65;
          return float4(structure, 1.0);
        }
        if (uniforms.representation < 2.5) {
          float reaction = smoothstep(0.12, 0.82, amplitude);
          float pulse = 0.5 + 0.5 * sin(uniforms.elapsed * 2.0);
          float3 reactionColour = mix(kNightDeep, float3(0.32, 0.10, 0.06), reaction);
          reactionColour += kEmberWarm * reaction * pulse * 0.7;
          reactionColour += kSeaGlimmer * smoothstep(0.72, 1.0, amplitude) * 0.2;
          return float4(reactionColour, 1.0);
        }
        float vibration = 0.5 + 0.5 * sin(in.uv.y * 32.0 + uniforms.elapsed * 2.4);
        float3 vibrational = mix(kNightDeep, float3(0.12, 0.24, 0.40), smoothstep(0.1, 0.6, amplitude));
        vibrational += kSeaGlimmer * vibration * smoothstep(0.24, 0.9, amplitude) * 0.5;
        vibrational += kEmberWarm * smoothstep(0.78, 1.0, amplitude) * 0.25;
        return float4(vibrational, 1.0);
      }

      if (uniforms.representation < 0.5) {
        float density = smoothstep(0.01, 0.35, amplitude);
        float3 galaxy = mix(kNightDeep, float3(0.08, 0.06, 0.20), density * 0.8);
        galaxy += float3(0.46, 0.24, 0.68) * smoothstep(0.35, 0.9, amplitude);
        galaxy += kSeaGlimmer * smoothstep(0.75, 1.0, amplitude) * 0.4;
        return float4(galaxy, 1.0);
      }
      if (uniforms.representation < 1.5) {
        float core = smoothstep(0.08, 0.75, amplitude);
        float halo = smoothstep(0.02, 0.18, amplitude) * 0.38;
        float3 starColour = mix(kNightDeep, float3(0.28, 0.10, 0.025), halo);
        starColour = mix(starColour, kEmberWarm, core);
        starColour += float3(1.0, 0.75, 0.35) * smoothstep(0.72, 1.0, amplitude) * 0.35;
        return float4(starColour, 1.0);
      }
      if (uniforms.representation < 2.5) {
        float2 centred = (in.uv - 0.5) * 2.0;
        float radius = length(centred);
        float disc = 1.0 - smoothstep(0.78, 0.88, radius);
        float land = smoothstep(0.45, 0.75, amplitude);
        float3 planet = mix(float3(0.02, 0.10, 0.18), float3(0.24, 0.48, 0.22), land);
        planet = mix(kNightDeep, planet, disc);
        planet += kEmberWarm * smoothstep(0.70, 0.95, amplitude) * 0.22;
        return float4(planet, 1.0);
      }
      float2 earthCentre = (in.uv - 0.5) * 2.0;
      float earthRadius = length(earthCentre);
      float earthDisc = 1.0 - smoothstep(0.78, 0.88, earthRadius);
      float ocean = smoothstep(0.12, 0.52, amplitude);
      float cloud = smoothstep(0.62, 0.92, amplitude);
      float3 earth = mix(float3(0.025, 0.14, 0.25), float3(0.18, 0.52, 0.28), ocean);
      earth = mix(earth, kSeaGlimmer, cloud * 0.45);
      earth += float3(0.16, 0.28, 0.52) * (1.0 - smoothstep(0.78, 0.95, earthRadius)) * 0.3;
      earth = mix(kNightDeep, earth, earthDisc);
      return float4(earth, 1.0);
    }

    // Slope of the surface, read from the same texture: the medium lights
    // itself from its own gradient rather than from a decorative gloss.
    float2 texel = 1.0 / max(uniforms.fieldSize, float2(1.0));
    float slopeX = (surface.sample(surfaceSampler, fieldUV + float2(texel.x, 0.0)).r
                  - surface.sample(surfaceSampler, fieldUV - float2(texel.x, 0.0)).r) * uniforms.exposure;
    float slopeY = (surface.sample(surfaceSampler, fieldUV + float2(0.0, texel.y)).r
                  - surface.sample(surfaceSampler, fieldUV - float2(0.0, texel.y)).r) * uniforms.exposure;
    float3 normal = normalize(float3(-slopeX * 6.0, -slopeY * 6.0, 1.0));
    float3 lightDirection = normalize(float3(0.32, 0.56, 0.76));
    float lambert = saturate(dot(normal, lightDirection));
    float specular = pow(lambert, 24.0);

    // The 7 s breath, continued across the frame by the caller's interpolated
    // elapsed time so the ground never steps.
    float breath = 0.55 + 0.45 * sin(6.2831853 * uniforms.elapsed / max(uniforms.breathSeconds, 0.001));

    // The same field can be looked at as a line or as a spectrum. These are
    // projections of the authoritative surface texture, not decorative
    // overlays: every bar and every trace is sampled from the wave state.
    if (uniforms.representation > 0.5 && uniforms.representation < 1.5) {
      float signal = surface.sample(surfaceSampler, float2(fieldUV.x, 0.5)).r * uniforms.exposure;
      float traceY = 0.5 - signal * 0.24;
      float trace = 1.0 - smoothstep(0.004, 0.024, abs(in.uv.y - traceY));
      float3 equation = mix(kNightDeep, kSeaDeep, 0.35 + 0.35 * breath);
      equation += kSeaGlimmer * trace;
      equation += kEmberWarm * smoothstep(0.55, 1.0, abs(signal)) * trace;
      return float4(equation, 1.0);
    }

    if (uniforms.representation > 1.5 && uniforms.representation < 2.5) {
      constexpr sampler spectrumSampler(coord::normalized, address::clamp_to_edge, filter::linear);
      const int sampleCount = 32;
      const int binCount = 12;
      int bin = min(binCount - 1, int(in.uv.x * float(binCount)));
      float realPart = 0.0;
      float imaginaryPart = 0.0;
      for (int k = 0; k < sampleCount; k++) {
        float sampleX = float(k) / float(sampleCount - 1);
        float value = surface.sample(spectrumSampler, float2(sampleX, 0.5)).r * uniforms.exposure;
        float angle = 6.2831853 * float(bin * k) / float(sampleCount);
        realPart += value * cos(angle);
        imaginaryPart -= value * sin(angle);
      }
      float magnitude = sqrt(realPart * realPart + imaginaryPart * imaginaryPart) / float(sampleCount);
      float barHeight = clamp(magnitude * 0.75, 0.015, 0.62);
      float barTop = 0.82 - barHeight;
      float bar = step(barTop, in.uv.y) * step(in.uv.y, 0.82);
      float3 spectrum = mix(kNightDeep, kSeaDeep, 0.25 + 0.4 * breath);
      spectrum += mix(kSeaLit, kEmberWarm, float(bin) / float(binCount - 1)) * bar;
      return float4(spectrum, 1.0);
    }

    float3 colour = mix(kNightDeep, kSeaDeep, 0.55 + 0.45 * breath);
    colour = mix(colour, kSeaLit, smoothstep(-0.35, 0.85, amplitude));
    colour = mix(colour, kSeaGlimmer, smoothstep(0.55, 1.05, amplitude) * 0.7);
    // A crest or trough that reaches the medium's declared range is the
    // decisive event: constructive interference, and it burns.
    colour += kEmberWarm * smoothstep(0.82, 1.15, abs(amplitude)) * 0.55;
    colour += kSeaGlimmer * specular * (0.18 + 0.30 * breath);

    if (uniforms.representation > 2.5) {
      // Felt keeps the water's causal shading but gives the visitor a warmer,
      // slower reading of the same amplitude, matching the web lens's third
      // station without inventing another physical state.
      colour = mix(colour, kEmberWarm, smoothstep(0.15, 0.9, abs(amplitude)) * 0.24);
      colour += kSeaGlimmer * (0.04 + 0.05 * breath);
    }

    // The tank has edges. A soft fall-off says so without drawing a frame.
    float2 fromCentre = (in.uv - 0.5) * 2.0;
    colour *= mix(1.0, 0.68, saturate(dot(fromCentre, fromCentre) * 0.55));

    return float4(colour, 1.0);
  }
  """
}
