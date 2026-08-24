/// The cellular-colony material, written in Metal Shading Language.
///
/// The shader reads the authoritative Gray–Scott B concentration directly.
/// It finds membrane loops from concentration contours and local gradients,
/// then lets the same reaction field light the nutrient space between them.
/// There is no particle layer, texture atlas, or renderer-owned colony state.
enum CellShaderSource {
  static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct Uniforms {
    float2 viewport;
    float2 fieldSize;
    float elapsed;
    float exposure;
    uint representation;
    uint reducedMotion;
    float frozenElapsed;
  };

  struct VertexOut {
    float4 position [[position]];
    float2 uv;
  };

  constant float3 kNight = float3(0.012, 0.025, 0.043);
  constant float3 kCytoplasm = float3(0.025, 0.142, 0.160);
  constant float3 kNutrient = float3(0.082, 0.395, 0.365);
  constant float3 kMembrane = float3(0.375, 0.855, 0.660);
  constant float3 kLumen = float3(0.600, 0.900, 0.835);
  constant float3 kEmber = float3(0.925, 0.462, 0.205);

  vertex VertexOut objet_cell_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    VertexOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  float contour(float value, float level, float halfWidth) {
    return 1.0 - smoothstep(halfWidth, halfWidth * 2.2, abs(value - level));
  }

  fragment float4 objet_cell_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> surface [[texture(0)]],
    sampler surfaceSampler [[sampler(0)]],
    constant Uniforms &uniforms [[buffer(0)]]
  ) {
    // Aspect-fill the square field so membranes retain their physical scale on
    // both iPhone portrait and iPad landscape.
    float longest = max(uniforms.viewport.x, uniforms.viewport.y);
    float2 cover = uniforms.viewport / max(longest, 1.0);
    float2 fieldUV = (in.uv - 0.5) * cover + 0.5;
    float2 texel = 1.0 / max(uniforms.fieldSize, float2(1.0));

    float b = max(0.0, surface.sample(surfaceSampler, fieldUV).r * uniforms.exposure);
    float left = max(0.0, surface.sample(surfaceSampler, fieldUV - float2(texel.x, 0.0)).r * uniforms.exposure);
    float right = max(0.0, surface.sample(surfaceSampler, fieldUV + float2(texel.x, 0.0)).r * uniforms.exposure);
    float up = max(0.0, surface.sample(surfaceSampler, fieldUV - float2(0.0, texel.y)).r * uniforms.exposure);
    float down = max(0.0, surface.sample(surfaceSampler, fieldUV + float2(0.0, texel.y)).r * uniforms.exposure);
    float gradient = length(float2(right - left, down - up));
    float laplacian = abs(left + right + up + down - 4.0 * b);

    // Four contours keep the reaction field continuous while making a visitor
    // read each bounded lobe as membrane rather than as a scalar heat map.
    float rim = max(
      contour(b, 0.110, 0.012),
      max(contour(b, 0.250, 0.018), contour(b, 0.430, 0.024))
    );
    float edge = smoothstep(0.026, 0.140, gradient) * smoothstep(0.040, 0.64, b);
    float membrane = saturate(max(rim, edge * 0.58));
    float nutrient = smoothstep(0.045, 0.480, b);
    float activeReaction = smoothstep(0.020, 0.130, laplacian);
    float breathElapsed = uniforms.reducedMotion == 1u ? uniforms.frozenElapsed : uniforms.elapsed;
    float breath = 0.72 + 0.28 * sin(breathElapsed * 0.8975979);
    float2 fromCentre = (in.uv - 0.5) * 2.0;
    float vignette = 1.0 - 0.34 * saturate(dot(fromCentre, fromCentre));

    if (uniforms.representation == 1u) {
      // Reaction field: nutrient is the medium and its derivative makes the
      // travelling boundary visible, without a second model or an overlay.
      // Keep the nutrient medium near night so this lens reads fronts and
      // pockets rather than turning the entire colony into a scalar wash.
      float3 colour = mix(kNight, kCytoplasm, nutrient * 0.18);
      colour += kNutrient * activeReaction * (0.20 + 0.08 * breath);
      colour += kLumen * activeReaction * 0.52;
      colour += kMembrane * membrane * 0.84;
      return float4(colour * vignette, 1.0);
    }

    if (uniforms.representation == 2u) {
      // The same concentration bands turn into a lineage-like edge register:
      // local chemistry chooses the hue; no renderer-owned identity is added.
      float bands = max(
        max(contour(b, 0.080, 0.006), contour(b, 0.175, 0.010)),
        max(contour(b, 0.300, 0.014), contour(b, 0.455, 0.018))
      );
      float3 colour = mix(kNight, float3(0.055, 0.070, 0.190), nutrient * 0.46);
      colour += mix(kNutrient, kLumen, smoothstep(0.12, 0.46, b)) * bands;
      colour += kMembrane * edge * 0.34;
      colour += kEmber * activeReaction * bands * 0.23;
      return float4(colour * vignette, 1.0);
    }

    if (uniforms.representation == 3u) {
      // Felt: the same membrane is warmer at a reaction front, so a decisive
      // local change arrives as ember without inventing a decorative flare.
      float ember = activeReaction * smoothstep(0.075, 0.360, b);
      float3 colour = mix(kNight, kCytoplasm, nutrient * 0.45);
      colour += kMembrane * membrane * (0.54 + 0.22 * breath);
      colour += kLumen * edge * 0.34;
      colour += kEmber * ember * 0.72;
      return float4(colour * vignette, 1.0);
    }

    // Colony: a dark nutrient ground, bounded membrane loops, and the light
    // of an active reaction only where the field itself says it is happening.
    float3 colour = mix(kNight, kCytoplasm, nutrient * 0.48);
    colour = mix(colour, kNutrient, nutrient * 0.24);
    colour += kMembrane * membrane * (0.62 + 0.20 * breath);
    colour += kLumen * edge * 0.38;
    colour += kEmber * activeReaction * membrane * 0.20;
    return float4(colour * vignette, 1.0);
  }
  """
}
