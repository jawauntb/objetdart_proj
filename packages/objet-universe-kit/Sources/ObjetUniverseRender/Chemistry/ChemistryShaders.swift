/// Scalar material for chemistry routes. It contains no water branch: Wave is
/// a water-only shader.
enum ChemistryShaderSource {
  static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct Uniforms {
    float2 viewport;
    float2 fieldSize;
    // elapsed, exposure, representation, material kind.
    float4 state;
    // frozen elapsed, reduced-motion flag, reserved, reserved.
    float4 presentation;
  };

  struct VertexOut {
    float4 position [[position]];
    float2 uv;
  };

  constant float3 kNight = float3(0.0196, 0.0353, 0.0784);
  constant float3 kSeaGlimmer = float3(0.5451, 0.7608, 0.8980);
  constant float3 kEmber = float3(0.9059, 0.6392, 0.2980);

  vertex VertexOut objet_chemistry_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    VertexOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  fragment float4 objet_chemistry_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> surface [[texture(0)]],
    sampler surfaceSampler [[sampler(0)]],
    constant Uniforms &uniforms [[buffer(0)]]
  ) {
    float longest = max(uniforms.viewport.x, uniforms.viewport.y);
    float2 cover = uniforms.viewport / max(longest, 1.0);
    float2 fieldUV = (in.uv - 0.5) * cover + 0.5;
    float amplitude = surface.sample(surfaceSampler, fieldUV).r * uniforms.state.y;
    float elapsed = uniforms.presentation.y > 0.5 ? uniforms.presentation.x : uniforms.state.x;
    float representation = uniforms.state.z;

    if (uniforms.state.w < 3.5) {
      if (representation < 0.5) {
        float shell = smoothstep(0.02, 0.42, amplitude);
        float orbit = 0.5 + 0.5 * sin(length((in.uv - 0.5) * 2.0) * 34.0 - elapsed * 1.2);
        float3 atom = mix(kNight, float3(0.18, 0.08, 0.28), shell * 0.75);
        atom += float3(0.36, 0.20, 0.82) * shell * orbit * 0.7;
        atom += kSeaGlimmer * smoothstep(0.55, 1.0, amplitude) * 0.4;
        return float4(atom, 1.0);
      }
      if (representation < 1.5) {
        float grid = step(0.88, fract(in.uv.x * 7.0)) + step(0.88, fract(in.uv.y * 6.0));
        float periodic = smoothstep(0.08, 0.55, amplitude);
        float3 table = mix(kNight, float3(0.27, 0.10, 0.18), periodic * 0.65);
        table += kEmber * grid * 0.35;
        table += kSeaGlimmer * smoothstep(0.65, 1.0, amplitude) * 0.28;
        return float4(table, 1.0);
      }
      if (representation < 2.5) {
        float bond = smoothstep(0.18, 0.62, amplitude);
        float strand = 0.5 + 0.5 * sin(in.uv.x * 46.0 + elapsed * 0.8);
        float3 shared = mix(kNight, float3(0.12, 0.32, 0.38), bond);
        shared += kSeaGlimmer * bond * strand * 0.55;
        shared += kEmber * smoothstep(0.72, 1.0, amplitude) * 0.3;
        return float4(shared, 1.0);
      }
      float flash = smoothstep(0.18, 0.9, amplitude);
      float radial = 1.0 - smoothstep(0.0, 0.7, length((in.uv - 0.5) * 2.0));
      float3 fusion = mix(kNight, float3(0.30, 0.05, 0.08), flash);
      fusion += kEmber * flash * radial;
      fusion += kSeaGlimmer * smoothstep(0.78, 1.0, amplitude) * 0.35;
      return float4(fusion, 1.0);
    }

    if (representation < 0.5) {
      float mixture = smoothstep(0.02, 0.48, amplitude);
      float drift = 0.5 + 0.5 * sin(in.uv.x * 9.0 + in.uv.y * 7.0 + elapsed * 0.32);
      float3 field = mix(kNight, float3(0.06, 0.27, 0.30), mixture);
      field += kSeaGlimmer * mixture * drift * 0.35;
      return float4(field, 1.0);
    }
    if (representation < 1.5) {
      float scaffold = smoothstep(0.16, 0.55, amplitude);
      float bond = 1.0 - smoothstep(0.0, 0.06, abs(sin(in.uv.x * 16.0) - sin(in.uv.y * 13.0)));
      float3 structure = mix(kNight, float3(0.08, 0.34, 0.42), scaffold);
      structure += kEmber * bond * scaffold * 0.65;
      return float4(structure, 1.0);
    }
    if (representation < 2.5) {
      float reaction = smoothstep(0.12, 0.82, amplitude);
      float pulse = 0.5 + 0.5 * sin(elapsed * 2.0);
      float3 reactionColour = mix(kNight, float3(0.32, 0.10, 0.06), reaction);
      reactionColour += kEmber * reaction * pulse * 0.7;
      reactionColour += kSeaGlimmer * smoothstep(0.72, 1.0, amplitude) * 0.2;
      return float4(reactionColour, 1.0);
    }
    float vibration = 0.5 + 0.5 * sin(in.uv.y * 32.0 + elapsed * 2.4);
    float3 vibrational = mix(kNight, float3(0.12, 0.24, 0.40), smoothstep(0.1, 0.6, amplitude));
    vibrational += kSeaGlimmer * vibration * smoothstep(0.24, 0.9, amplitude) * 0.5;
    vibrational += kEmber * smoothstep(0.78, 1.0, amplitude) * 0.25;
    return float4(vibrational, 1.0);
  }
  """
}
