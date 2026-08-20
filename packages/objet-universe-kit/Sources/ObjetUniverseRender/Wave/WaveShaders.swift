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

    float3 colour = mix(kNightDeep, kSeaDeep, 0.55 + 0.45 * breath);
    colour = mix(colour, kSeaLit, smoothstep(-0.35, 0.85, amplitude));
    colour = mix(colour, kSeaGlimmer, smoothstep(0.55, 1.05, amplitude) * 0.7);
    // A crest or trough that reaches the medium's declared range is the
    // decisive event: constructive interference, and it burns.
    colour += kEmberWarm * smoothstep(0.82, 1.15, abs(amplitude)) * 0.55;
    colour += kSeaGlimmer * specular * (0.18 + 0.30 * breath);

    // The tank has edges. A soft fall-off says so without drawing a frame.
    float2 fromCentre = (in.uv - 0.5) * 2.0;
    colour *= mix(1.0, 0.68, saturate(dot(fromCentre, fromCentre) * 0.55));

    return float4(colour, 1.0);
  }
  """
}
