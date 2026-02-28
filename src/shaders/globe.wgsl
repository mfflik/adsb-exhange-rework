// Globe vertex/fragment shader
// Renders an icosphere with OSM tile texture sampling

struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  // x=time, y=selectedId, z=mode(0=3d,1=2d), w=pad
  params: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var globeTexture: texture_2d<f32>;
@group(0) @binding(2) var globeSampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clipPos = uniforms.viewProj * vec4<f32>(in.position, 1.0);
  out.worldPos = in.position;
  out.normal = in.normal;
  out.uv = in.uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(globeTexture, globeSampler, in.uv);

  // Atmospheric rim lighting
  let viewDir = normalize(uniforms.cameraPos.xyz - in.worldPos);
  let rim = 1.0 - max(0.0, dot(normalize(in.normal), viewDir));
  let rimPow = pow(rim, 3.0);

  // Sun direction (fixed)
  let sunDir = normalize(vec3<f32>(1.0, 0.5, 0.5));
  let diffuse = max(0.0, dot(normalize(in.normal), sunDir));
  let ambient = 0.3;
  let light = ambient + diffuse * 0.7;

  var color = texColor.rgb * light;

  // Atmospheric glow (cyan tint on rim)
  let atmColor = vec3<f32>(0.1, 0.6, 0.9);
  color = mix(color, atmColor, rimPow * 0.4);

  // Night side darkening
  let nightFactor = 1.0 - max(0.0, dot(normalize(in.normal), sunDir));
  color = mix(color, color * 0.15, nightFactor * 0.7);

  return vec4<f32>(color, 1.0);
}
