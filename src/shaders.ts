export const MAIN_SHADER = /* wgsl */ `
struct U {
  vp: mat4x4f,
  cameraPos: vec4f,
  keyDir: vec4f,
  keyColor: vec4f,
  fillDir: vec4f,
  fillColor: vec4f,
  rimDir: vec4f,
  rimColor: vec4f,
  oe: vec4f,
  wood: vec4f,
  woodDeep: vec4f,
  woodLight: vec4f,
  woodSheen: vec4f,
  absorb: vec4f,
  scatter: vec4f,
  varnish: vec4f,
  primer: vec4f,
  options: vec4f,
};

@group(0) @binding(0) var<uniform> u: U;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) material: f32,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) material: f32,
};

@vertex
fn vs(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = u.vp * vec4f(in.position, 1.0);
  out.worldPos = in.position;
  out.normal = in.normal;
  out.uv = in.uv;
  out.material = in.material;
  return out;
}

fn srgb_to_linear(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i + vec3f(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, w.x);
  let x10 = mix(n010, n110, w.x);
  let x01 = mix(n001, n101, w.x);
  let x11 = mix(n011, n111, w.x);
  let y0 = mix(x00, x10, w.y);
  let y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z);
}

fn wear_mask(p: vec3f, uv: vec2f) -> f32 {
  let sideEdge = smoothstep(0.68, 0.99, abs(uv.x * 2.0 - 1.0));
  let endEdge = max(
    1.0 - smoothstep(0.0, 0.09, uv.y),
    smoothstep(0.91, 1.0, uv.y)
  );
  let lowerContact = exp(-pow((p.x + 0.48) / 0.25, 2.0) - pow((p.y + 0.56) / 0.34, 2.0));
  let upperArm = exp(-pow((p.x - 0.43) / 0.22, 2.0) - pow((p.y - 0.48) / 0.30, 2.0));
  let rings = noise3(vec3f(p.x * 7.0, p.y * 7.0, 4.2));
  return clamp(sideEdge * 0.9 + endEdge * 0.55 + lowerContact * 0.75 + upperArm * 0.45 + rings * 0.18, 0.0, 1.0);
}

struct LayerResult {
  trans: vec3f,
  glow: vec3f,
}

/* Beer-Lambert absorption over the down+up path, plus in-layer scattering. */
fn varnish_layers(phase: f32, thicknessMm: f32, ndl: f32, ndv: f32) -> LayerResult {
  let pathLength = clamp(1.0 / max(ndl, 0.16) + 1.0 / max(ndv, 0.16), 1.7, 10.0);
  let count = i32(u.varnish.x + 0.5);
  var trans = vec3f(1.0);
  var glow = vec3f(0.0);
  for (var i = 0; i < 6; i++) {
    if (i < count) {
      let variation = 0.82 + 0.32 * hash31(vec3f(f32(i) * 1.7, phase, 9.1));
      let layerThickness = max(0.004, thicknessMm / f32(count)) * variation;
      let tau = u.absorb.rgb * u.absorb.w * layerThickness * pathLength;
      let oneLayer = exp(-tau);
      trans = trans * oneLayer;
      let depthWeight = 0.35 + 0.65 * f32(i + 1) / f32(count);
      glow = glow + u.scatter.rgb * u.scatter.w * (1.0 - oneLayer) * depthWeight;
    }
  }
  var result: LayerResult;
  result.trans = trans;
  result.glow = glow;
  return result;
}

fn d_ggx(ndh: f32, roughness: f32) -> f32 {
  var a = roughness * roughness;
  a = max(a, 0.025);
  let a2 = a * a;
  let d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 0.0001);
}

fn g_schlick(nd: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return nd / max(nd * (1.0 - k) + k, 0.0001);
}

fn specular_ggx(n: vec3f, h: vec3f, v: vec3f, l: vec3f, f0: vec3f, roughness: f32) -> vec3f {
  let ndh = max(dot(n, h), 0.0);
  let ndv = max(dot(n, v), 0.001);
  let ndl = max(dot(n, l), 0.001);
  let d = d_ggx(ndh, roughness);
  let g = g_schlick(ndv, roughness) * g_schlick(ndl, roughness);
  let fh = max(dot(h, v), 0.0);
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - fh, 5.0);
  return (d * g * f) / max(4.0 * ndv * ndl, 0.001);
}

fn studio_environment(r: vec3f) -> vec3f {
  let base = mix(vec3f(0.045, 0.032, 0.025), vec3f(0.30, 0.38, 0.50), smoothstep(-0.45, 0.85, r.y));
  let softboxA = pow(max(dot(r, normalize(vec3f(-0.38, 0.52, 0.76))), 0.0), 80.0);
  let strip = pow(max(dot(r, normalize(vec3f(0.76, 0.16, 0.63))), 0.0), 150.0);
  let warmTop = pow(max(dot(r, normalize(vec3f(0.08, 0.86, 0.34))), 0.0), 55.0);
  return base
    + softboxA * vec3f(3.4, 2.75, 1.95)
    + strip * vec3f(2.0, 2.35, 3.25)
    + warmTop * vec3f(1.15, 0.78, 0.42);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

struct FragOut {
  @location(0) color: vec4f,
};

@fragment
fn fs(in: VertexOut, @builtin(front_facing) facing: bool) -> FragOut {
  var n = normalize(in.normal);
  if (!facing) { n = -n; }
  let v = normalize(u.cameraPos.xyz - in.worldPos);
  let p = in.worldPos;
  let matId = i32(in.material + 0.5);

  var longitudinal = vec3f(0.0, 1.0, 0.0);
  var tangent = normalize(longitudinal - n * dot(longitudinal, n) + vec3f(0.0001, 0.0, 0.0));
  if (length(longitudinal - n * dot(longitudinal, n)) < 0.02) {
    tangent = normalize(vec3f(1.0, 0.0, 0.0) - n * n.x);
  }
  let bitangent = normalize(cross(n, tangent));

  let period = max(u.wood.x, 0.025);
  let warpAmount = u.options.y;
  let phase = 6.2831853 * p.y / period
    + warpAmount * 1.45 * sin(p.x * 2.1 + p.y * 1.3)
    + warpAmount * 0.55 * sin(p.x * 4.7 - p.y * 2.2);
  let theta = u.wood.y * sin(phase);
  let fiber = normalize(tangent * cos(theta) + n * sin(theta));

  let coarseGrain = noise3(vec3f(p.x * 24.0, p.y * 34.0, p.z * 18.0));
  let finePore = noise3(vec3f(p.x * 115.0 + coarseGrain * 2.0, p.y * 16.0, p.z * 28.0));
  let poreLine = smoothstep(0.66, 0.96, finePore);

  var albedo = vec3f(0.5);
  var roughness = 0.45;
  var metallic = 0.0;
  var woodKind = 0; // 0 none, 1 tiger, 2 spruce/maple
  var coatAmount = 0.65;

  if (matId == 0) {
    woodKind = 1;
    let mixValue = clamp(0.18 + 0.24 * coarseGrain + 0.06 * sin(phase * 0.5), 0.0, 1.0);
    albedo = mix(srgb_to_linear(u.woodDeep.rgb), srgb_to_linear(u.woodLight.rgb) * 0.82, mixValue);
    albedo *= (0.76 + 0.14 * finePore - 0.10 * poreLine) * u.wood.w;
    roughness = 0.34;
  } else if (matId == 1) {
    woodKind = 2;
    let straight = noise3(vec3f(p.x * 95.0, p.y * 11.0, 5.0));
    albedo = srgb_to_linear(vec3f(0.86, 0.63, 0.31));
    albedo *= 0.82 + 0.24 * straight - 0.12 * poreLine;
    roughness = 0.42;
  } else if (matId == 5) {
    woodKind = 2;
    albedo = srgb_to_linear(vec3f(0.58, 0.31, 0.12));
    albedo *= 0.84 + 0.2 * coarseGrain;
    roughness = 0.36;
  } else if (matId == 2) {
    albedo = srgb_to_linear(vec3f(0.035, 0.024, 0.018));
    roughness = 0.28;
    coatAmount = 0.9;
  } else if (matId == 3) {
    albedo = srgb_to_linear(vec3f(0.78, 0.75, 0.68));
    metallic = 1.0;
    roughness = 0.2;
    coatAmount = 0.0;
  } else if (matId == 4) {
    albedo = srgb_to_linear(vec3f(0.72, 0.49, 0.24));
    albedo *= 0.86 + 0.16 * finePore;
    roughness = 0.72;
    coatAmount = 0.08;
  } else {
    albedo = srgb_to_linear(vec3f(0.4, 0.2, 0.08));
    roughness = 0.5;
  }

  let wear = wear_mask(p, in.uv);
  let wornAmount = clamp(u.varnish.w * wear, 0.0, 0.94);
  if (woodKind > 0) {
    albedo = mix(albedo, srgb_to_linear(u.primer.rgb), wornAmount * 0.82);
  }

  var varnishThickness = u.varnish.y;
  var coatRoughness = u.varnish.z;
  if (woodKind > 0) {
    varnishThickness = max(0.006, u.varnish.y * mix(1.0, 0.075, wornAmount));
    coatRoughness = mix(u.varnish.z, 0.46, wornAmount);
  } else {
    varnishThickness = 0.0;
    coatAmount = 0.0;
  }

  if (u.options.x > 0.5) {
    var heatColor = vec3f(0.075, 0.085, 0.095);
    if (woodKind > 0) {
      let heat = clamp(varnishThickness / max(u.varnish.y, 0.001), 0.0, 1.0);
      heatColor = mix(vec3f(0.55, 0.88, 1.0), vec3f(1.0, 0.34, 0.06), heat);
    }
    var heatOut: FragOut;
    heatOut.color = vec4f(linear_to_srgb(heatColor), 1.0);
    return heatOut;
  }

  let ndv = max(dot(n, v), 0.001);
  var color = vec3f(0.0);

  if (woodKind > 0) {
    let ambientLayer = varnish_layers(phase, varnishThickness, 1.0, ndv);
    let ambientBounce = ambientLayer.trans + ambientLayer.trans * ambientLayer.trans * 0.25;
    color += albedo * u.oe.x * vec3f(0.72, 0.78, 1.05) * ambientBounce;
    color += ambientLayer.glow * u.oe.x * 0.55;
  } else {
    color += albedo * u.oe.x * vec3f(0.72, 0.78, 1.05);
  }

  for (var li = 0; li < 3; li++) {
    var dir4 = u.keyDir;
    var color4 = u.keyColor;
    if (li == 1) {
      dir4 = u.fillDir;
      color4 = u.fillColor;
    } else if (li == 2) {
      dir4 = u.rimDir;
      color4 = u.rimColor;
    }
    let l = normalize(dir4.xyz);
    let radiance = srgb_to_linear(color4.rgb) * color4.a;
    let ndl = max(dot(n, l), 0.0);
    let h = normalize(l + v + vec3f(0.00001, 0.00001, 0.00001));

    var litAlbedo = albedo;
    var layer = LayerResult(vec3f(1.0), vec3f(0.0));
    var diffuseAngle = ndl;
    if (woodKind > 0) {
      layer = varnish_layers(phase, varnishThickness, ndl, ndv);
      let multipleBounce = layer.trans
        + layer.trans * layer.trans * 0.30
        + layer.trans * layer.trans * layer.trans * 0.08;
      litAlbedo = albedo * multipleBounce;
      let microNormal = normalize(n * cos(theta) - tangent * sin(theta));
      let oriented = clamp((dot(microNormal, l) + 0.16) / 1.16, 0.0, 1.0);
      let orientationWeight = select(0.22, 0.72, woodKind == 1);
      diffuseAngle = mix(ndl, oriented, orientationWeight);
    }

    let diffuse = litAlbedo * diffuseAngle * radiance;
    color += diffuse;

    if (woodKind == 1) {
      /* Kajiya-Kay orientation lobe: bright when H is perpendicular to F. */
      let fh = dot(fiber, h);
      let aniso = pow(clamp(1.0 - fh * fh, 0.0, 1.0), u.wood.z);
      let broad = pow(clamp(1.0 - fh * fh, 0.0, 1.0), max(2.0, u.wood.z * 0.16));
      let grazingGate = 0.22 + 0.78 * ndl;
      let sheenTransport = layer.trans * 0.75 + 0.25;
      color += srgb_to_linear(u.woodSheen.rgb)
        * radiance
        * grazingGate
        * sheenTransport
        * (aniso * 0.34 * u.wood.w + broad * 0.05);
    }

    let f0 = mix(vec3f(0.04), albedo, metallic);
    let ggSpec = specular_ggx(n, h, v, l, f0, roughness);
    color += ggSpec * radiance * ndl * mix(0.35, 1.0, metallic);

    if (coatAmount > 0.0 && woodKind > 0) {
      let coat = specular_ggx(n, h, v, l, vec3f(0.04), coatRoughness);
      color += coat * radiance * ndl * coatAmount;
    } else if (coatAmount > 0.0) {
      let coat = specular_ggx(n, h, v, l, vec3f(0.04), roughness * 0.7);
      color += coat * radiance * ndl * coatAmount * 0.35;
    }

    if (woodKind > 0) {
      color += layer.glow * radiance * (0.25 + 0.75 * ndl);
    }
  }

  let fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  let reflected = reflect(-v, n);
  if (woodKind > 0) {
    let env = studio_environment(reflected);
    color += env * fresnel * (1.0 - u.varnish.z * 1.8) * 0.16;
  } else if (metallic > 0.5) {
    color += studio_environment(reflected) * fresnel * 0.55 * albedo;
  } else {
    color += studio_environment(reflected) * fresnel * 0.08;
  }

  color *= u.oe.y;
  color = aces(color);
  var out: FragOut;
  out.color = vec4f(linear_to_srgb(color), 1.0);
  return out;
}
`;

export const LINE_SHADER = /* wgsl */ `
struct U {
  vp: mat4x4f,
};
@group(0) @binding(0) var<uniform> u: U;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) color: vec4f,
};
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = u.vp * vec4f(in.position, 1.0);
  out.color = in.color;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
`;
