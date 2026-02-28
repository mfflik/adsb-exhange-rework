// Aircraft instanced billboard shader
// Each instance: vec3 position, float trackRad, vec3 color, float categoryId, float selected, float instanceId, pad, pad

struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  // x=time, y=selectedId, z=mode(0=3d,1=2d), w=screenHeight
  params: vec4<f32>,
}

struct InstanceData {
  // world position (xyz) + track angle (w)
  posTrack: vec4<f32>,
  // color (rgb) + categoryId (w)
  colorCat: vec4<f32>,
  // selected (x) + instanceId (y) + pad (zw)
  flags: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceData>;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) categoryId: f32,
  @location(3) selected: f32,
  @location(4) instanceId: f32,
  @location(5) trackRad: f32,
}

// Billboard quad vertices (2 triangles)
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
  let worldPos = inst.posTrack.xyz;
  let trackRad = inst.posTrack.w;

  // Project center to clip space
  let clipCenter = uniforms.viewProj * vec4<f32>(worldPos, 1.0);

  // Cull if behind camera
  if clipCenter.w <= 0.0 {
    out.clipPos = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  // Billboard size in pixels (constant screen size)
  let pixelSize = 14.0;
  let ndcCenter = clipCenter.xy / clipCenter.w;

  // Aspect ratio correction
  let aspect = uniforms.params.w; // screenWidth/screenHeight stored in params.w
  let quadVert = QUAD_VERTS[vertIdx];

  // Apply pixel offset in NDC space
  let ndcOffset = quadVert * vec2<f32>(pixelSize / 800.0, pixelSize / 600.0);
  let ndcPos = ndcCenter + ndcOffset;

  out.clipPos = vec4<f32>(ndcPos * clipCenter.w, clipCenter.z, clipCenter.w);
  out.uv = quadVert * 0.5 + 0.5;
  out.color = inst.colorCat.rgb;
  out.categoryId = inst.colorCat.w;
  out.selected = inst.flags.x;
  out.instanceId = inst.flags.y;
  out.trackRad = trackRad;
  return out;
}

// SDF shapes
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

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

fn rotate2D(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // UV in [-1, 1]
  let p = (in.uv - 0.5) * 2.0;
  let catId = i32(in.categoryId);
  let time = uniforms.params.x;

  var dist: f32;

  // Shape by category:
  // 0=friend (rounded rect), 1=hostile (diamond), 2=neutral (square),
  // 3=unknown (circle), 4=civilian (circle)
  if catId == 0 {
    // Friend: rounded rect with heading indicator
    dist = sdRoundedBox(p, vec2<f32>(0.55, 0.45), 0.2);
  } else if catId == 1 {
    // Hostile: diamond
    dist = sdDiamond(p, 0.7);
  } else if catId == 2 {
    // Neutral: square
    dist = sdBox(p, vec2<f32>(0.55, 0.55));
  } else {
    // Unknown/Civilian: circle
    dist = sdCircle(p, 0.6);
  }

  // Anti-aliased edge
  let aa = fwidth(dist);
  let alpha = 1.0 - smoothstep(-aa, aa, dist);

  if alpha < 0.01 {
    discard;
  }

  var color = in.color;

  // Heading arrow (small triangle pointing in track direction)
  let rotP = rotate2D(p, -in.trackRad);
  let arrowDist = sdBox(rotP - vec2<f32>(0.0, 0.7), vec2<f32>(0.08, 0.15));
  let arrowAlpha = 1.0 - smoothstep(-aa, aa, arrowDist);

  // Inner fill (darker)
  let innerDist = dist + 0.15;
  let innerAlpha = 1.0 - smoothstep(-aa, aa, innerDist);
  color = mix(color * 0.3, color, innerAlpha);

  // Selection pulse ring
  if in.selected > 0.5 {
    let pulse = 0.5 + 0.5 * sin(time * 4.0);
    let ringRadius = 0.75 + pulse * 0.15;
    let ringDist = abs(sdCircle(p, ringRadius)) - 0.06;
    let ringAlpha = 1.0 - smoothstep(-aa, aa, ringDist);
    color = mix(color, vec3<f32>(0.0, 1.0, 1.0), ringAlpha * 0.9);
  }

  // Arrow overlay
  color = mix(color, vec3<f32>(1.0), arrowAlpha * 0.8);

  return vec4<f32>(color, alpha);
}
