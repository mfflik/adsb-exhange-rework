// GPU picking shader
// Renders aircraft as solid colored quads with instance ID encoded as color

struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  params: vec4<f32>,
}

struct InstanceData {
  posTrack: vec4<f32>,
  colorCat: vec4<f32>,
  flags: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceData>;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) instanceId: f32,
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
fn vs_pick(
  @builtin(vertex_index) vertIdx: u32,
  @builtin(instance_index) instIdx: u32,
) -> VertexOutput {
  var out: VertexOutput;
  let inst = instances[instIdx];
  let worldPos = inst.posTrack.xyz;

  let clipCenter = uniforms.viewProj * vec4<f32>(worldPos, 1.0);

  if clipCenter.w <= 0.0 {
    out.clipPos = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.instanceId = -1.0;
    return out;
  }

  let pixelSize = 18.0; // slightly larger for easier picking
  let ndcCenter = clipCenter.xy / clipCenter.w;
  let quadVert = QUAD_VERTS[vertIdx];
  let ndcOffset = quadVert * vec2<f32>(pixelSize / 800.0, pixelSize / 600.0);
  let ndcPos = ndcCenter + ndcOffset;

  out.clipPos = vec4<f32>(ndcPos * clipCenter.w, clipCenter.z, clipCenter.w);
  out.instanceId = inst.flags.y;
  return out;
}

@fragment
fn fs_pick(in: VertexOutput) -> @location(0) vec4<f32> {
  // Encode instance ID as RGBA (supports up to 16M instances)
  let id = u32(in.instanceId);
  let r = f32((id >> 16u) & 0xFFu) / 255.0;
  let g = f32((id >> 8u) & 0xFFu) / 255.0;
  let b = f32(id & 0xFFu) / 255.0;
  return vec4<f32>(r, g, b, 1.0);
}
