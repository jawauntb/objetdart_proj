/// The native water material, written in Metal Shading Language.
///
/// It is carried as source because SwiftPM and the Expo CocoaPod package the
/// renderer differently. One embedded source gives both paths the same water,
/// compiled once away from the display link.
public enum WaveShaderSource {
  public static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct Uniforms {
    float2 viewport;
    float2 fieldSize;
    // elapsed, exposure, representation, reduced-motion flag.
    float4 state;
    // frozen elapsed, breath seconds, reserved, reserved.
    float4 presentation;
    float4 spectrum0;
    float4 spectrum1;
    float4 spectrum2;
  };

  struct VertexOut {
    float4 position [[position]];
    float2 uv;
  };

  constant float3 kNight = float3(0.0196, 0.0353, 0.0784);
  constant float3 kAbyss = float3(0.027, 0.097, 0.178);
  constant float3 kTrough = float3(0.047, 0.185, 0.286);
  constant float3 kWater = float3(0.090, 0.365, 0.505);
  constant float3 kShallow = float3(0.318, 0.725, 0.782);
  constant float3 kFoam = float3(0.725, 0.918, 0.902);
  constant float3 kEmber = float3(0.9059, 0.6392, 0.2980);

  vertex VertexOut objet_wave_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    VertexOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  float spectrumValue(int bin, constant Uniforms &uniforms) {
    if (bin < 4) { return uniforms.spectrum0[bin]; }
    if (bin < 8) { return uniforms.spectrum1[bin - 4]; }
    return uniforms.spectrum2[bin - 8];
  }

  float3 surfaceMaterial(
    VertexOut in,
    float amplitude,
    float slopeX,
    float slopeY,
    float curvature,
    float steepness,
    float breath
  ) {
    float3 normal = normalize(float3(-slopeX * 5.8, -slopeY * 5.8, 1.0));
    float3 light = normalize(float3(-0.46, 0.36, 0.81));
    float3 eye = normalize(float3(0.0, 0.20, 1.0));
    float lambert = saturate(dot(normal, light));
    float glint = pow(saturate(dot(reflect(-light, normal), eye)), 42.0);

    // Rest is visible structure before a visitor ever makes a crest. This is
    // not auto-gain: it maps the field's declared amplitude to a quiet sea.
    float restingContrast = smoothstep(0.008, 0.12, abs(amplitude));
    float trough = smoothstep(-0.78, -0.04, amplitude);
    float crest = smoothstep(0.10, 0.82, amplitude);
    float breaker = smoothstep(0.26, 0.98, abs(amplitude) + steepness * 0.34);
    float caustic = pow(saturate(1.0 - steepness * 0.62 + abs(curvature) * 0.48), 10.0)
      * smoothstep(0.10, 0.55, abs(amplitude) + abs(curvature) * 1.5);

    float3 colour = mix(kNight, kAbyss, 0.22 + 0.12 * breath);
    colour = mix(colour, kTrough, trough * 0.66 + restingContrast * 0.13);
    colour = mix(colour, kWater, crest * (0.38 + 0.22 * lambert));
    colour += kShallow * lambert * (0.018 + 0.09 * restingContrast);
    colour += kFoam * (caustic * (0.025 + 0.08 * breath) + glint * 0.38);
    colour += kFoam * breaker * (0.08 + 0.18 * breath);
    colour += kEmber * smoothstep(0.72, 1.16, abs(amplitude)) * 0.36;

    float2 fromCentre = (in.uv - 0.5) * 2.0;
    float vignette = 1.0 - 0.34 * smoothstep(0.20, 1.48, dot(fromCentre, fromCentre));
    return colour * vignette;
  }

  fragment float4 objet_wave_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> surface [[texture(0)]],
    sampler surfaceSampler [[sampler(0)]],
    constant Uniforms &uniforms [[buffer(0)]]
  ) {
    // Aspect-fill agrees with MaterialProjection: portrait crops the short
    // axis instead of stretching a physical wavelength into an oval.
    float longest = max(uniforms.viewport.x, uniforms.viewport.y);
    float2 cover = uniforms.viewport / max(longest, 1.0);
    float2 fieldUV = (in.uv - 0.5) * cover + 0.5;
    float2 texel = 1.0 / max(uniforms.fieldSize, float2(1.0));
    float exposure = uniforms.state.y;
    float phaseElapsed = uniforms.state.w > 0.5 ? uniforms.presentation.x : uniforms.state.x;
    float breath = 0.58 + 0.42 * sin(6.2831853 * phaseElapsed / max(uniforms.presentation.y, 0.001));
    float representation = uniforms.state.z;

    if (representation > 0.5 && representation < 1.5) {
      // Equation is a reading of the same water: a centre-line signal and its
      // local zero crossings, not a generic chart placed over the tank.
      float amplitude = surface.sample(surfaceSampler, fieldUV).r * exposure;
      float signal = surface.sample(surfaceSampler, float2(fieldUV.x, 0.5)).r * exposure;
      float signalLeft = surface.sample(surfaceSampler, float2(max(fieldUV.x - texel.x, 0.0), 0.5)).r * exposure;
      float signalRight = surface.sample(surfaceSampler, float2(min(fieldUV.x + texel.x, 1.0), 0.5)).r * exposure;
      float traceY = 0.52 - signal * 0.24;
      float trace = 1.0 - smoothstep(0.0035, 0.018, abs(in.uv.y - traceY));
      float turning = smoothstep(0.005, 0.085, abs(signalRight - signalLeft));
      float contour = 1.0 - smoothstep(0.010, 0.030, abs(amplitude));
      float3 colour = mix(kNight, kAbyss, 0.36 + 0.22 * breath);
      colour += kWater * contour * 0.18;
      colour += kShallow * trace * (0.68 + 0.18 * turning);
      colour += kEmber * trace * smoothstep(0.58, 1.0, abs(signal)) * 0.42;
      float2 fromCentre = (in.uv - 0.5) * 2.0;
      return float4(colour * (1.0 - 0.28 * dot(fromCentre, fromCentre)), 1.0);
    }

    if (representation > 1.5 && representation < 2.5) {
      // Twelve bins arrive pre-reduced from the authoritative surface. The
      // field costs one small CPU sum per submission, never a DFT per pixel.
      const int binCount = 12;
      int bin = min(binCount - 1, int(in.uv.x * float(binCount)));
      float magnitude = spectrumValue(bin, uniforms);
      float barHeight = 0.055 + magnitude * 0.58;
      float withinBin = fract(in.uv.x * float(binCount));
      float column = smoothstep(0.06, 0.14, withinBin) * (1.0 - smoothstep(0.82, 0.94, withinBin));
      float bar = column * step(0.86 - barHeight, in.uv.y) * step(in.uv.y, 0.86);
      float glow = column * (1.0 - smoothstep(0.0, 0.10, abs(in.uv.y - (0.86 - barHeight))));
      float baseline = 1.0 - smoothstep(0.006, 0.018, abs(in.uv.y - 0.86));
      float hue = float(bin) / float(binCount - 1);
      float3 binColour = mix(kShallow, kEmber, hue * 0.72);
      float3 colour = mix(kNight, kAbyss, 0.30 + 0.22 * breath);
      colour += kWater * baseline * 0.24;
      colour += binColour * (bar * 0.88 + glow * 0.24);
      float2 fromCentre = (in.uv - 0.5) * 2.0;
      return float4(colour * (1.0 - 0.26 * dot(fromCentre, fromCentre)), 1.0);
    }

    float amplitude = surface.sample(surfaceSampler, fieldUV).r * exposure;
    float left = surface.sample(surfaceSampler, fieldUV - float2(texel.x, 0.0)).r * exposure;
    float right = surface.sample(surfaceSampler, fieldUV + float2(texel.x, 0.0)).r * exposure;
    float up = surface.sample(surfaceSampler, fieldUV - float2(0.0, texel.y)).r * exposure;
    float down = surface.sample(surfaceSampler, fieldUV + float2(0.0, texel.y)).r * exposure;
    float slopeX = right - left;
    float slopeY = down - up;
    float curvature = left + right + up + down - 4.0 * amplitude;
    float steepness = length(float2(slopeX, slopeY));
    float3 colour = surfaceMaterial(
      in, amplitude, slopeX, slopeY, curvature, steepness, breath
    );
    if (representation > 2.5) {
      // Felt remains causally tied to the field, but lets a decisive crest
      // keep its warmth longer than the analytical surface station does.
      float felt = smoothstep(0.025, 0.48, abs(amplitude) + steepness * 0.62);
      colour = mix(colour, kEmber, felt * 0.38);
      colour += kFoam * felt * (0.055 + 0.080 * breath);
    }
    return float4(colour, 1.0);
  }
  """
}
