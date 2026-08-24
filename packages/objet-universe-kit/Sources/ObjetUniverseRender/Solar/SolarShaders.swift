/// The solar instrument is a vault, a star, and a small population of actual
/// worlds. The source stays in Swift so SwiftPM and CocoaPods compile the same
/// material, and every animation can freeze at a reduced-motion detent.
public enum SolarShaderSource {
  public static let metal = """
  #include <metal_stdlib>
  using namespace metal;

  struct SolarUniforms {
    float2 viewport;
    float cameraScale;
    float cameraRotation;
    float cameraPitch;
    float interpolation;
    float elapsed;
    float frozenElapsed;
    float centralMass;
    float collisionPulse;
    float2 collisionPosition;
    float2 touchPosition;
    float touchPulse;
    uint touchKind;
    uint representation;
    uint bodyCount;
    uint trailCount;
    uint predictionCount;
    uint reducedMotion;
    float breathSeconds;
  };

  struct SolarBody {
    float4 previousPosition;
    float4 positionRadius;
    float4 colourMass;
    float4 velocityKindSelected;
    float4 materialSeed;
  };

  struct SolarMark {
    float4 positionAge;
    float4 colourSize;
  };

  struct VertexOut {
    float4 position [[position]];
    float2 uv;
  };

  struct PointOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float4 colour;
    float2 velocity;
    float kind;
    float selected;
    float seed;
  };

  struct OrbitOut {
    float4 position [[position]];
    float4 colour;
  };

  constant float kTau = 6.28318530718;
  constant float3 kVoid = float3(0.005, 0.008, 0.020);
  constant float3 kDeep = float3(0.020, 0.038, 0.090);
  constant float3 kCold = float3(0.075, 0.126, 0.236);
  constant float3 kPaper = float3(0.84, 0.83, 0.76);
  constant float3 kSea = float3(0.19, 0.46, 0.66);
  constant float3 kAurora = float3(0.36, 0.90, 0.82);
  constant float3 kCandle = float3(1.0, 0.61, 0.22);
  constant float3 kCoral = float3(0.95, 0.33, 0.24);

  float presentationElapsed(constant SolarUniforms &u) {
    return u.reducedMotion > 0u ? u.frozenElapsed : u.elapsed;
  }

  float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float2 hash22(float2 p) {
    float n = hash21(p);
    return float2(n, hash21(p + n + 19.19));
  }

  float valueNoise(float2 p) {
    float2 cell = floor(p);
    float2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = hash21(cell);
    float b = hash21(cell + float2(1.0, 0.0));
    float c = hash21(cell + float2(0.0, 1.0));
    float d = hash21(cell + float2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  float fbm(float2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (uint octave = 0u; octave < 4u; octave++) {
      total += amplitude * valueNoise(p);
      p = p * 2.03 + 7.1;
      amplitude *= 0.5;
    }
    return total;
  }

  float2 rotate(float2 value, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return float2(c * value.x - s * value.y, s * value.x + c * value.y);
  }

  float2 worldToClip(float2 world, constant SolarUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    float2 turned = rotate(world, u.cameraRotation);
    turned.y *= cos(u.cameraPitch);
    return float2(turned.x, -turned.y) / max(u.cameraScale * cover, float2(0.001));
  }

  float2 clipToWorld(float2 uv, constant SolarUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    float2 turned = float2(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0) * u.cameraScale * cover;
    turned.y /= max(cos(u.cameraPitch), 0.2);
    return rotate(turned, -u.cameraRotation);
  }

  float starLayer(float2 uv, float density, float size, float phase) {
    float2 grid = uv * density;
    float2 cell = floor(grid);
    float2 local = fract(grid);
    float2 phaseVector = float2(phase, phase * 0.713);
    float2 site = hash22(cell + phaseVector);
    float brightness = hash21(cell + phaseVector + 7.77);
    float distanceToSite = length(local - site);
    float radius = size * (0.16 + brightness * brightness * 0.44);
    float core = 1.0 - smoothstep(radius, radius * 1.9, distanceToSite);
    return core * pow(brightness, 3.8);
  }

  vertex VertexOut objet_solar_fullscreen_vertex(uint vertexID [[vertex_id]]) {
    float2 corner = float2(float((vertexID << 1) & 2u), float(vertexID & 2u));
    VertexOut out;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(corner.x, 1.0 - corner.y);
    return out;
  }

  fragment float4 objet_solar_background_fragment(
    VertexOut in [[stage_in]],
    constant SolarUniforms &u [[buffer(0)]]
  ) {
    float time = presentationElapsed(u);
    float2 world = clipToWorld(in.uv, u);
    float2 centred = (in.uv - 0.5) * float2(1.0, 1.68);
    float breath = 0.5 + 0.5 * sin(time * kTau / max(u.breathSeconds, 0.001) + 1.23);
    float3 colour = kVoid + kDeep * (0.12 + 0.22 * exp(-dot(centred, centred) * 1.8));

    // Three deterministic star strata keep the sky dimensional without
    // becoming a generic glitter field.
    float longestViewport = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 skyUV = in.uv * u.viewport / longestViewport;
    float sparse = starLayer(skyUV, 30.0, 0.058, 3.7);
    float middle = starLayer(skyUV + float2(0.17, 0.31), 57.0, 0.043, 13.1);
    float fine = starLayer(skyUV + float2(0.63, 0.11), 104.0, 0.031, 29.4);
    float warmSparse = step(0.92, hash21(floor(skyUV * 30.0) + 11.0));
    float warmMiddle = step(0.95, hash21(floor((skyUV + 0.17) * 57.0) + 5.0));
    colour += mix(kPaper, kCandle, warmSparse * 0.72) * sparse * 0.92;
    colour += mix(kPaper, kCandle, warmMiddle * 0.48) * middle * 0.48;
    colour += kPaper * fine * 0.22;

    // A noisy milky band and the ecliptic dust make the orbital plane feel
    // embedded in a real vault rather than a diagram on black.
    float2 band = rotate(centred, -0.52);
    float milky = exp(-pow(abs(band.y) / 0.25, 2.0));
    if (milky > 0.0005) {
      float cloudy = 0.42 + 0.92 * fbm(band * 9.0 + float2(4.0, 1.0));
      colour += mix(kPaper, kCold, 0.32) * milky * cloudy * 0.072;
    }
    float dustWeight = exp(-abs(world.y) * 4.8);
    if (dustWeight > 0.0005) {
      float dust = dustWeight * (0.030 + 0.070 * fbm(world * 13.0 + 21.0));
      colour += mix(kCandle, kPaper, smoothstep(0.12, 2.8, length(world))) * dust;
    }

    if (u.representation == 1u) {
      float2 coordinate = abs(fract(world * 1.15) - 0.5);
      float guide = 1.0 - smoothstep(0.010, 0.034, min(coordinate.x, coordinate.y));
      float axes = exp(-abs(world.x) * 42.0) + exp(-abs(world.y) * 42.0);
      colour += kCold * guide * 0.13 + kPaper * axes * 0.055;
    }

    // A limb-darkened, granulated star with a striated corona: light that has
    // a body, rather than a blurred orange disc pasted into the middle.
    float starRadius = 0.058 + 0.014 * sqrt(max(u.centralMass, 0.01));
    float fromStar = length(world);
    float disc = 1.0 - smoothstep(starRadius * 0.92, starRadius * 1.035, fromStar);
    float starTouch = u.touchKind == 1u ? u.touchPulse : 0.0;
    float3 starFace = float3(0.0);
    if (disc > 0.0) {
      float normalizedRadius = min(fromStar / max(starRadius, 0.0001), 1.0);
      float limb = sqrt(saturate(1.0 - normalizedRadius * normalizedRadius));
      float granulation = 0.68 + 0.70 * fbm(world * 112.0 + float2(time * 0.028, -time * 0.017));
      float cells = 0.82 + 0.20 * sin((world.x - world.y) * 245.0 + fbm(world * 58.0) * 7.0);
      starFace = mix(float3(0.86, 0.16, 0.035), mix(kCandle, kPaper, 0.62), limb)
        * (0.52 + 0.62 * limb) * granulation * cells;
    }
    float outer = max(0.0, fromStar - starRadius);
    float corona = 0.0;
    if (outer < 1.2) {
      float angle = atan2(world.y, world.x);
      float striation = 0.42 + 0.90 * fbm(float2(angle * 5.4, outer * 36.0 - time * 0.055));
      corona = (exp(-outer * 20.0) * 0.52 + exp(-outer * 5.8) * 0.18) * striation * (1.0 - disc);
    }
    colour += kCandle * corona * (0.64 + starTouch * 0.72 + breath * 0.08);
    colour = mix(colour, starFace, disc);

    if (u.representation == 2u) {
      float muOrbit = 0.0001353876 * max(u.centralMass, 0.01);
      float period = kTau * sqrt(pow(max(fromStar, 0.10), 3.0) / muOrbit);
      float audibleFrequency = 196608.0 / max(period, 0.001);
      float octave = fract(log2(max(audibleFrequency, 1.0)));
      float octaveDistance = min(octave, 1.0 - octave);
      float spectralLine = 1.0 - smoothstep(0.014, 0.052, octaveDistance);
      float rings = 0.5 + 0.5 * sin(fromStar * 26.0 - time * 0.26);
      colour = colour * 0.58 + mix(kAurora, kCandle, octave) * spectralLine * (0.24 + rings * 0.20);
    }

    if (u.touchKind == 2u && u.touchPulse > 0.0) {
      float touchDistance = length(world - u.touchPosition);
      float touchRing = 1.0 - smoothstep(0.010, 0.034, abs(touchDistance - (0.04 + u.touchPulse * 0.14)));
      colour += mix(kPaper, kAurora, 0.34) * touchRing * u.touchPulse * 0.56;
    }

    if (u.collisionPulse > 0.0) {
      float collisionDistance = length(world - u.collisionPosition);
      float collisionRadius = 0.04 + u.collisionPulse * 0.17;
      float collisionWidth = 0.010 + u.collisionPulse * 0.024;
      float collisionRing = 1.0 - smoothstep(collisionWidth, collisionWidth * 2.1,
                                              abs(collisionDistance - collisionRadius));
      float collisionGlow = exp(-collisionDistance * 12.0) * 0.30;
      colour += mix(kCandle, kCoral, 0.52) * (collisionRing + collisionGlow) * u.collisionPulse;
    }

    if (u.representation == 3u) {
      float felt = max(u.collisionPulse, u.touchPulse);
      float luminance = dot(colour, float3(0.2126, 0.7152, 0.0722));
      colour = mix(float3(luminance) * float3(0.68, 0.82, 1.0), colour * (1.16 + breath * 0.14), 0.42 + felt * 0.36);
    }

    float vignette = 1.0 - smoothstep(0.30, 1.48, length((in.uv - 0.5) * 2.0));
    return float4(colour * (0.64 + 0.36 * vignette), 1.0);
  }

  vertex OrbitOut objet_solar_orbit_vertex(
    uint vertexID [[vertex_id]],
    const device SolarMark *marks [[buffer(0)]],
    constant SolarUniforms &u [[buffer(1)]]
  ) {
    SolarMark mark = marks[vertexID];
    OrbitOut out;
    out.position = float4(worldToClip(mark.positionAge.xy, u), 0.0, 1.0);
    float pathAlpha = u.representation == 1u ? 0.60 : 0.24;
    out.colour = float4(mark.colourSize.xyz, saturate(1.0 - mark.positionAge.w) * pathAlpha);
    return out;
  }

  fragment float4 objet_solar_orbit_fragment(OrbitOut in [[stage_in]]) {
    return in.colour;
  }

  vertex PointOut objet_solar_mark_vertex(
    uint vertexID [[vertex_id]],
    const device SolarMark *marks [[buffer(0)]],
    constant SolarUniforms &u [[buffer(1)]]
  ) {
    SolarMark mark = marks[vertexID];
    PointOut out;
    out.position = float4(worldToClip(mark.positionAge.xy, u), 0.0, 1.0);
    out.pointSize = mark.colourSize.w;
    out.colour = float4(mark.colourSize.xyz, saturate(1.0 - mark.positionAge.w));
    out.velocity = float2(0.0);
    out.kind = 2.0;
    out.selected = 0.0;
    out.seed = 0.0;
    return out;
  }

  vertex PointOut objet_solar_body_vertex(
    uint vertexID [[vertex_id]],
    const device SolarBody *bodies [[buffer(0)]],
    constant SolarUniforms &u [[buffer(1)]]
  ) {
    SolarBody body = bodies[vertexID];
    float3 position = mix(body.previousPosition.xyz, body.positionRadius.xyz, u.interpolation);
    PointOut out;
    out.position = float4(worldToClip(position.xy, u), saturate(0.42 - position.z * 0.028), 1.0);
    float bodyScale = 16.0 + body.positionRadius.w * 420.0 + sqrt(max(body.colourMass.w, 0.0)) * 26.0;
    float lensScale = u.representation == 3u ? 1.20 : (u.representation == 2u ? 1.10 : 1.0);
    out.pointSize = clamp(
      (bodyScale + body.velocityKindSelected.w * 10.0) * lensScale,
      16.0,
      body.velocityKindSelected.z > 2.5 ? 96.0 : 74.0
    );
    out.colour = float4(body.colourMass.xyz, 1.0);
    out.velocity = body.velocityKindSelected.xy;
    out.kind = body.velocityKindSelected.z;
    out.selected = body.velocityKindSelected.w;
    out.seed = body.materialSeed.x;
    return out;
  }

  fragment float4 objet_solar_mark_fragment(PointOut in [[stage_in]], float2 point [[point_coord]]) {
    float distanceFromCentre = length(point - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.12, 0.92, distanceFromCentre);
    return float4(in.colour.rgb, in.colour.a * core * 0.66);
  }

  fragment float4 objet_solar_body_fragment(
    PointOut in [[stage_in]],
    float2 point [[point_coord]],
    constant SolarUniforms &u [[buffer(0)]]
  ) {
    float2 p = (point - 0.5) * 2.0;
    float radius = length(p);
    if (radius > 1.35) discard_fragment();
    float time = presentationElapsed(u);
    float disc = 1.0 - smoothstep(0.93, 1.035, radius);
    float atmosphere = exp(-max(radius - 0.82, 0.0) * 7.0) * (1.0 - disc);
    float seed = in.seed * 91.0 + 3.7;

    // A held open-sky body is a condensation, not a counterfeit planet.
    if (in.kind > 2.5) {
      float cell = fbm(p * 5.2 + float2(seed, seed * 0.61) + float2(time * 0.17, -time * 0.11));
      float shell = 1.0 - smoothstep(0.026, 0.094, abs(radius - (0.48 + in.selected * 0.30)));
      float halo = exp(-radius * radius * 2.8);
      float3 forming = mix(in.colour.rgb * (0.36 + cell * 0.34), kAurora, 0.38 + in.selected * 0.30);
      float alpha = halo * (0.18 + in.selected * 0.50) + shell * 0.42;
      return float4(forming + kPaper * shell * 0.26, min(alpha, 0.94));
    }

    float3 colour;
    float alpha;
    if (in.kind > 0.5) {
      float velocityAngle = atan2(in.velocity.y, in.velocity.x);
      float pointAngle = atan2(p.y, p.x);
      float tail = pow(saturate(-cos(pointAngle - velocityAngle)), 6.0) * smoothstep(0.12, 1.0, radius);
      float nucleus = exp(-radius * radius * 3.8);
      float ionVeil = 0.48 + 0.52 * sin(pointAngle * 5.0 + seed + time * 0.48);
      colour = mix(in.colour.rgb, kPaper, 0.46) * (nucleus + tail * 0.54);
      colour += kAurora * tail * ionVeil * 0.72;
      alpha = disc * 0.84 + atmosphere * 0.28 + tail * 0.32;
    } else {
      float sphere = sqrt(saturate(1.0 - min(radius, 1.0) * min(radius, 1.0)));
      float3 normal = normalize(float3(p.x, -p.y, sphere));
      float light = 0.22 + 0.78 * saturate(dot(normal, normalize(float3(-0.54, 0.42, 0.74))));
      float terrain = fbm(p * 5.4 + float2(seed, seed * 0.37));
      float weather = fbm(p * 12.0 + float2(seed * 1.7, -seed));
      float latitude = 0.5 + 0.5 * sin((p.y + terrain * 0.18) * 17.0 + seed * 2.1);
      float land = smoothstep(0.45, 0.70, terrain + weather * 0.34);
      float3 lowland = mix(in.colour.rgb * 0.40, in.colour.rgb * 1.16, latitude);
      float3 highland = mix(in.colour.rgb, kPaper, 0.24 + weather * 0.38);
      colour = mix(lowland, highland, land) * light;
      colour += kSea * (1.0 - land) * (0.05 + weather * 0.10);
      colour += mix(in.colour.rgb, kPaper, 0.48) * atmosphere * 0.22;
      alpha = disc * 0.96 + atmosphere * 0.16;
    }

    if (u.representation == 1u) {
      float longitude = 1.0 - smoothstep(0.020, 0.070, abs(sin(atan2(p.y, p.x) * 4.0 + seed)));
      float latitude = 1.0 - smoothstep(0.020, 0.070, abs(sin(p.y * 13.0 + seed)));
      colour += kPaper * max(longitude, latitude) * disc * 0.18;
    }
    if (u.representation == 2u) {
      float harmonic = 0.5 + 0.5 * sin(radius * 28.0 - time * 1.8 - seed);
      colour += mix(kAurora, kCandle, harmonic) * exp(-radius * 2.3) * 0.20;
    }
    if (u.representation == 3u) {
      float pulse = 0.5 + 0.5 * sin(time * 1.35 + seed);
      colour = mix(colour, mix(kCold, kAurora, pulse), 0.16 + in.selected * 0.16);
      alpha += atmosphere * 0.16;
    }

    float selectedRing = (1.0 - smoothstep(0.038, 0.105, abs(radius - 0.82))) * in.selected;
    colour += kAurora * selectedRing * 0.90;
    alpha = max(alpha, selectedRing * 0.74);
    if (alpha < 0.008) discard_fragment();
    return float4(colour, min(alpha, 0.97));
  }
  """
}
