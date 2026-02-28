// 3D Airplane instanced renderer
// Each instance: position on globe + orientation + color

struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  // x=time, y=selectedId, z=mode, w=aspect
  params: vec4<f32>,
}

// Per-instance data (packed as 4x vec4 = 16 floats)
struct AirplaneInstance {
  // xyz = world position on globe surface, w = track angle (radians)
  posTrack: vec4<f32>,
  // xyz = color, w = selected (0 or 1)
  colorSelected: vec4<f32>,
  // xyz = up vector (radial from globe center), w = instance ID
  upVec: vec4<f32>,
  // xyz = forward vector (track direction on surface), w = scale
  forwardScale: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<AirplaneInstance>;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) selected: f32,
  @location(4) time: f32,
}

@vertex
fn vs_airplane(
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @builtin(instance_index) instIdx: u32,
) -> VertexOutput {
  var out: VertexOutput;
  let inst = instances[instIdx];

  let worldCenter = inst.posTrack.xyz;
  let trackRad = inst.posTrack.w;
  let upVec = normalize(inst.upVec.xyz);
  let fwdVec = normalize(inst.forwardScale.xyz);
  let scale = inst.forwardScale.w;

  // Build right vector (perpendicular to up and forward)
  let rightVec = normalize(cross(fwdVec, upVec));
  // Recompute forward to ensure orthogonality
  let fwd = normalize(cross(upVec, rightVec));

  // Transform local position to world space
  // Local: X=right, Y=up, Z=forward (nose direction)
  let worldPos = worldCenter
    + rightVec * localPos.x * scale
    + upVec * localPos.y * scale
    + fwd * localPos.z * scale;

  // Transform normal
  let worldNormal = normalize(
    rightVec * localNormal.x
    + upVec * localNormal.y
    + fwd * localNormal.z
  );

  out.clipPos = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldNormal = worldNormal;
  out.worldPos = worldPos;
  out.color = inst.colorSelected.rgb;
  out.selected = inst.colorSelected.w;
  out.time = uniforms.params.x;
  return out;
}

@fragment
fn fs_airplane(in: VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(in.worldNormal);
  let viewDir = normalize(uniforms.cameraPos.xyz - in.worldPos);

  // Sun direction
  let sunDir = normalize(vec3<f32>(1.0, 0.5, 0.5));

  // Diffuse lighting
  let diffuse = max(0.0, dot(normal, sunDir));
  let ambient = 0.35;
  let light = ambient + diffuse * 0.65;

  // Specular highlight
  let halfVec = normalize(sunDir + viewDir);
  let spec = pow(max(0.0, dot(normal, halfVec)), 32.0) * 0.4;

  var color = in.color * light + vec3<f32>(spec);

  // Selection glow
  if in.selected > 0.5 {
    let pulse = 0.5 + 0.5 * sin(in.time * 4.0);
    let rim = 1.0 - max(0.0, dot(normal, viewDir));
    let rimGlow = pow(rim, 2.0) * pulse;
    color = mix(color, vec3<f32>(0.0, 1.0, 1.0), rimGlow * 0.7);
    color += vec3<f32>(0.0, 0.15, 0.2) * pulse;
  }

  return vec4<f32>(color, 1.0);
}
