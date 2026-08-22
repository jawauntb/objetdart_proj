/// The solar room is drawn as paths written by bodies, not a generic particle
/// cloud. The source lives in Swift for parity between SwiftPM and CocoaPods.
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
  };

  struct SolarBody {
    float4 previousPosition;
    float4 positionRadius;
    float4 colourMass;
    float4 velocityKindSelected;
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
  };

  struct OrbitOut {
    float4 position [[position]];
    float4 colour;
  };

  constant float3 kVoid = float3(0.006, 0.009, 0.022);
  constant float3 kCold = float3(0.055, 0.095, 0.175);
  constant float3 kPaper = float3(0.76, 0.72, 0.62);
  constant float3 kAurora = float3(0.36, 0.90, 0.82);
  constant float3 kCandle = float3(1.0, 0.67, 0.29);

  float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float2 worldToClip(float2 world, constant SolarUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    float c = cos(u.cameraRotation);
    float s = sin(u.cameraRotation);
    float2 turned = float2(c * world.x - s * world.y, s * world.x + c * world.y);
    turned.y *= cos(u.cameraPitch);
    return float2(turned.x, -turned.y) / max(u.cameraScale * cover, float2(0.001));
  }

  float2 clipToWorld(float2 uv, constant SolarUniforms &u) {
    float longest = max(max(u.viewport.x, u.viewport.y), 1.0);
    float2 cover = u.viewport / longest;
    float2 turned = float2(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0) * u.cameraScale * cover;
    turned.y /= max(cos(u.cameraPitch), 0.2);
    float c = cos(-u.cameraRotation);
    float s = sin(-u.cameraRotation);
    return float2(c * turned.x - s * turned.y, s * turned.x + c * turned.y);
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
    float2 world = clipToWorld(in.uv, u);
    float3 colour = kVoid;

    // A deterministic star vault, quiet enough that orbital causality remains
    // the figure. Nothing twinkles without a change in authoritative time.
    float2 starCell = floor(in.uv * u.viewport / 5.0);
    float star = step(0.986, hash21(starCell));
    colour += float3(0.55, 0.63, 0.82) * star * (0.12 + 0.32 * hash21(starCell + 7.0));

    // The ecliptic is dust, not a grid: it gives the body paths a shared plane.
    float dustNoise = hash21(float2(floor(world.x * 34.0), floor(world.y * 95.0)));
    float ecliptic = exp(-abs(world.y) * 5.5) * (0.025 + 0.038 * dustNoise);
    colour += float3(0.20, 0.15, 0.24) * ecliptic;

    if (u.representation == 1u) {
      float axes = exp(-abs(world.x) * 95.0) + exp(-abs(world.y) * 95.0);
      colour = colour * 0.58 + kCold * axes * 0.10;
    }

    // Limb-darkened candle star and restrained corona.
    float starRadius = 0.055 + 0.012 * sqrt(max(u.centralMass, 0.01));
    float fromStar = length(world);
    float disc = 1.0 - smoothstep(starRadius * 0.92, starRadius, fromStar);
    float mu = sqrt(saturate(1.0 - (fromStar * fromStar) / max(starRadius * starRadius, 0.0001)));
    float limb = 0.38 + 0.62 * mu;
    float corona = exp(-max(0.0, fromStar - starRadius) * 28.0) * (1.0 - disc);
    float starTouch = u.touchKind == 1u ? u.touchPulse : 0.0;
    colour += kCandle * corona * (0.23 + starTouch * 0.72);
    colour = mix(colour, mix(float3(0.70, 0.20, 0.045), float3(1.0, 0.90, 0.58), limb), disc);

    if (u.representation == 2u) {
      float muOrbit = 0.0001353876 * max(u.centralMass, 0.01);
      float period = 6.2831853 * sqrt(pow(max(fromStar, 0.10), 3.0) / muOrbit);
      float audibleFrequency = 196608.0 / max(period, 0.001);
      float octavePhase = fract(log2(max(audibleFrequency, 1.0)));
      float octaveDistance = min(octavePhase, 1.0 - octavePhase);
      float octaveLine = 1.0 - smoothstep(0.014, 0.050, octaveDistance);
      colour = colour * 0.54 + mix(kAurora, kCandle, octavePhase) * octaveLine * 0.34;
    }

    float touchDistance = length(world - u.touchPosition);
    float dustTouch = u.touchKind == 2u ? u.touchPulse : 0.0;
    float touchRing = 1.0 - smoothstep(0.012, 0.035, abs(touchDistance - (0.04 + dustTouch * 0.13)));
    colour += mix(kPaper, kAurora, 0.35) * touchRing * dustTouch * 0.42;

    // A collision is located by the kernel and fades on the kernel's clock.
    float collisionDistance = length(world - u.collisionPosition);
    float collisionRadius = 0.04 + u.collisionPulse * 0.16;
    float collisionWidth = 0.010 + u.collisionPulse * 0.022;
    float collisionRing = 1.0 - smoothstep(collisionWidth, collisionWidth * 2.2,
                                           abs(collisionDistance - collisionRadius));
    float collisionGlow = exp(-collisionDistance * 13.0) * 0.28;
    colour += mix(kCandle, float3(0.94, 0.40, 0.30), 0.5)
              * (collisionRing + collisionGlow) * u.collisionPulse;

    if (u.representation == 3u) {
      float felt = max(u.collisionPulse, u.touchPulse);
      float luminance = dot(colour, float3(0.2126, 0.7152, 0.0722));
      colour = mix(float3(luminance) * float3(0.72, 0.84, 1.0), colour * 1.34, 0.38 + felt * 0.42);
    }

    float vignette = 1.0 - smoothstep(0.28, 1.45, length((in.uv - 0.5) * 2.0));
    colour *= 0.72 + 0.28 * vignette;
    return float4(colour, 1.0);
  }

  vertex OrbitOut objet_solar_orbit_vertex(
    uint vertexID [[vertex_id]],
    const device SolarMark *marks [[buffer(0)]],
    constant SolarUniforms &u [[buffer(1)]]
  ) {
    SolarMark mark = marks[vertexID];
    OrbitOut out;
    out.position = float4(worldToClip(mark.positionAge.xy, u), 0.0, 1.0);
    float pathAlpha = u.representation == 1u ? 0.58 : 0.18;
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
    out.position = float4(worldToClip(position.xy, u), saturate(0.4 - position.z * 0.02), 1.0);
    out.pointSize = clamp(
      4.0 + body.positionRadius.w * 110.0 + sqrt(max(body.colourMass.w, 0.0)) * 5.0
      + body.velocityKindSelected.w * 7.0
      + (u.representation == 3u ? 5.0 : (u.representation == 2u ? 2.0 : 0.0)),
      8.0,
      body.velocityKindSelected.z > 2.5 ? 64.0 : 48.0
    );
    out.colour = float4(body.colourMass.xyz, 1.0);
    out.velocity = body.velocityKindSelected.xy;
    out.kind = body.velocityKindSelected.z;
    out.selected = body.velocityKindSelected.w;
    return out;
  }

  fragment float4 objet_solar_mark_fragment(PointOut in [[stage_in]], float2 point [[point_coord]]) {
    float distanceFromCentre = length(point - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.16, 0.92, distanceFromCentre);
    return float4(in.colour.rgb, in.colour.a * core * 0.62);
  }

  fragment float4 objet_solar_body_fragment(PointOut in [[stage_in]], float2 point [[point_coord]]) {
    float2 centred = (point - 0.5) * 2.0;
    float radius = length(centred);
    if (radius > 1.0) discard_fragment();
    float sphere = sqrt(saturate(1.0 - radius * radius));
    float light = 0.22 + 0.78 * saturate(dot(normalize(float3(centred.x, -centred.y, sphere)),
                                             normalize(float3(-0.55, 0.38, 0.74))));
    float3 colour = in.colour.rgb * light;
    if (in.kind > 2.5) {
      float halo = 1.0 - smoothstep(0.18, 1.0, radius);
      float shell = 1.0 - smoothstep(0.035, 0.11, abs(radius - (0.42 + in.selected * 0.34)));
      float3 forming = mix(in.colour.rgb * 0.45, kAurora, 0.32 + in.selected * 0.28);
      return float4(forming + kPaper * shell * 0.22, halo * (0.12 + in.selected * 0.42));
    }
    if (in.kind > 0.5) {
      float velocityAngle = atan2(in.velocity.y, in.velocity.x);
      float pointAngle = atan2(centred.y, centred.x);
      float tail = pow(saturate(-cos(pointAngle - velocityAngle)), 8.0) * smoothstep(0.18, 1.0, radius);
      colour += float3(0.36, 0.68, 0.92) * tail * 0.72;
    }
    float ring = (1.0 - smoothstep(0.045, 0.10, abs(radius - 0.83))) * in.selected;
    colour += kAurora * ring * 0.85;
    return float4(colour, smoothstep(1.0, 0.82, radius));
  }
  """
}
