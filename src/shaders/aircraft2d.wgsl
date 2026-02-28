// Aircraft 2D screen-space billboard shader
// Positions are in screen pixels (NDC computed from pixel coords)

struct Uniforms {
  // x=canvasW, y=canvasH, z=time, w=dpr
  screen: vec4<f32>,
}

// Per-instance: [screenX, screenY, trackRad, categoryId, colorR, colorG, colorB, selected, instanceId, pad, pad, pad]
struct AircraftInstance {
  // screen position (x,y) + track + category
  posTrackCat: vec4<f32>,
  // color (rgb) + selected
  colorSelected: vec4<f32>,
  // instanceId + pad
  idPad: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<AircraftInstance>;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) categoryId: f32,
  @location(3) selected: f32,
  @location(4) trackRad: f32,
  @location(5) time: f32,
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
fn vs_main(
  @builtin(vertex_index) vertIdx: u32,
  @builtin(instance_index) instIdx: u32,
) -> VertexOutput {
  var out: VertexOutput;
  let inst = instances[instIdx];

  let screenX = inst.posTrackCat.x;
  let screenY = inst.posTrackCat.y;
  let trackRad = inst.posTrackCat.z;
  let canvasW = uniforms.screen.x;
  let canvasH = uniforms.screen.y;

  // Convert screen pixels to NDC
  let ndcX = (screenX / canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (screenY / canvasH) * 2.0;

  // Billboard size in pixels
  let pixelSize = 10.0;
  let quadVert = QUAD_VERTS[vertIdx];
  let ndcOffset = quadVert * vec2<f32>(pixelSize / canvasW, pixelSize / canvasH);

  out.clipPos = vec4<f32>(ndcX + ndcOffset.x, ndcY + ndcOffset.y, 0.0, 1.0);
  out.uv = quadVert * 0.5 + 0.5;
  out.color = inst.colorSelected.rgb;
  out.categoryId = inst.posTrackCat.w;
  out.selected = inst.colorSelected.w;
  out.trackRad = trackRad;
  out.time = uniforms.screen.z;
  return out;
}

// SDF shapes
fn sdCircle(p: vec2<f32>, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let d = abs(p) - b + vec2<f32>(r);
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - r;
}
fn sdDiamond(p: vec2<f32>, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y - s) / sqrt(2.0);
}
fn rotate2D(p: vec2<f32>, a: f32) -> vec2<f32> {
  return vec2<f32>(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let p = (in.uv - 0.5) * 2.0;
  let catId = i32(in.categoryId);

  var dist: f32;
  if catId == 0 { dist = sdRoundedBox(p, vec2<f32>(0.55, 0.45), 0.2); }
  else if catId == 1 { dist = sdDiamond(p, 0.7); }
  else if catId == 2 { dist = sdBox(p, vec2<f32>(0.55, 0.55)); }
  else { dist = sdCircle(p, 0.6); }

  let aa = fwidth(dist);
  let alpha = 1.0 - smoothstep(-aa, aa, dist);
  if alpha < 0.01 { discard; }

  var color = in.color;

  // Heading arrow
  let rotP = rotate2D(p, -in.trackRad);
  let arrowDist = sdBox(rotP - vec2<f32>(0.0, 0.7), vec2<f32>(0.08, 0.15));
  let arrowAlpha = 1.0 - smoothstep(-aa, aa, arrowDist);

  // Inner fill
  let innerAlpha = 1.0 - smoothstep(-aa, aa, dist + 0.15);
  color = mix(color * 0.3, color, innerAlpha);

  // Selection ring
  if in.selected > 0.5 {
    let pulse = 0.5 + 0.5 * sin(in.time * 4.0);
    let ringDist = abs(sdCircle(p, 0.75 + pulse * 0.15)) - 0.06;
    let ringAlpha = 1.0 - smoothstep(-aa, aa, ringDist);
    color = mix(color, vec3<f32>(0.22, 0.65, 1.0), ringAlpha * 0.9);
  }

  color = mix(color, vec3<f32>(1.0), arrowAlpha * 0.8);
  return vec4<f32>(color, alpha);
}
