// WebGPU 2D OSM tile renderer
// Renders individual tiles as textured quads in Mercator projection

struct Uniforms {
  // x=centerLon, y=centerLat, z=zoom, w=aspect
  mapParams: vec4<f32>,
  // x=canvasW, y=canvasH, z=time, w=pad
  screenParams: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var tileTexture: texture_2d<f32>;
@group(0) @binding(2) var tileSampler: sampler;

// Per-tile instance data: [tileX, tileY, tileZ, pad, u0, v0, u1, v1]
struct TileInstance {
  // tile coords (x, y, z) + pad
  tileCoords: vec4<f32>,
  // UV rect in atlas: [u0, v0, u1, v1]
  uvRect: vec4<f32>,
}

@group(0) @binding(3) var<storage, read> tiles: array<TileInstance>;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

const QUAD_VERTS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 1.0),
);

// Convert tile coords to lon/lat bounds
fn tileToLon(tileX: f32, z: f32) -> f32 {
  return tileX / pow(2.0, z) * 360.0 - 180.0;
}

fn tileToLat(tileY: f32, z: f32) -> f32 {
  let n = 3.14159265 - 2.0 * 3.14159265 * tileY / pow(2.0, z);
  return degrees(atan(0.5 * (exp(n) - exp(-n))));
}

// Mercator lon/lat to NDC
fn lonLatToNDC(lon: f32, lat: f32, centerLon: f32, centerLat: f32, zoom: f32, aspect: f32) -> vec2<f32> {
  let scale = 360.0 / pow(2.0, zoom);
  let halfW = scale * aspect * 0.5;
  let halfH = scale * 0.5;

  let ndcX = (lon - centerLon) / halfW;
  let ndcY = (lat - centerLat) / halfH;
  return vec2<f32>(ndcX, ndcY);
}

@vertex
fn vs_tile(
  @builtin(vertex_index) vertIdx: u32,
  @builtin(instance_index) instIdx: u32,
) -> VertexOutput {
  var out: VertexOutput;
  let tile = tiles[instIdx];
  let tileX = tile.tileCoords.x;
  let tileY = tile.tileCoords.y;
  let tileZ = tile.tileCoords.z;

  let centerLon = uniforms.mapParams.x;
  let centerLat = uniforms.mapParams.y;
  let zoom = uniforms.mapParams.z;
  let aspect = uniforms.mapParams.w;

  // Tile bounds in lon/lat
  let lon0 = tileToLon(tileX, tileZ);
  let lon1 = tileToLon(tileX + 1.0, tileZ);
  let lat0 = tileToLat(tileY, tileZ);       // top (higher lat)
  let lat1 = tileToLat(tileY + 1.0, tileZ); // bottom (lower lat)

  let quadVert = QUAD_VERTS[vertIdx];

  // Interpolate lon/lat for this vertex
  let lon = mix(lon0, lon1, quadVert.x);
  let lat = mix(lat0, lat1, quadVert.y);

  let ndc = lonLatToNDC(lon, lat, centerLon, centerLat, zoom, aspect);
  out.clipPos = vec4<f32>(ndc.x, ndc.y, 0.0, 1.0);

  // UV within the tile texture
  let u0 = tile.uvRect.x;
  let v0 = tile.uvRect.y;
  let u1 = tile.uvRect.z;
  let v1 = tile.uvRect.w;
  out.uv = vec2<f32>(mix(u0, u1, quadVert.x), mix(v0, v1, quadVert.y));

  return out;
}

@fragment
fn fs_tile(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(tileTexture, tileSampler, in.uv);
  // Tactical dark tint
  let tinted = texColor.rgb * vec3<f32>(0.65, 0.75, 0.85);
  return vec4<f32>(tinted, 1.0);
}
