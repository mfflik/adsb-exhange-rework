// Flat map (2D Mercator) shader
// Renders a full-screen quad with OSM tile texture

struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  // x=time, y=selectedId, z=mode, w=aspect
  params: vec4<f32>,
  // x=centerLon, y=centerLat, z=zoom, w=pad
  mapParams: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mapTexture: texture_2d<f32>;
@group(0) @binding(2) var mapSampler: sampler;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

const QUAD_VERTS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertIdx: u32) -> VertexOutput {
  var out: VertexOutput;
  let pos = QUAD_VERTS[vertIdx];
  out.clipPos = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(mapTexture, mapSampler, in.uv);
  // Apply tactical dark tint
  let tinted = texColor.rgb * vec3<f32>(0.6, 0.7, 0.8);
  return vec4<f32>(tinted, 1.0);
}
