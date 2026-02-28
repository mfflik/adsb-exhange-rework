// Icosphere geometry generator for the 3D globe
// Returns interleaved vertex data: [x, y, z, nx, ny, nz, u, v]

interface IcosphereGeometry {
  readonly vertices: Float32Array; // interleaved: pos(3) + normal(3) + uv(2)
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
}

function addVertex(
  vertices: number[],
  x: number, y: number, z: number
): number {
  const len = Math.sqrt(x * x + y * y + z * z);
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;

  // Spherical UV mapping
  const u = 0.5 + Math.atan2(nx, nz) / (2 * Math.PI);
  const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;

  vertices.push(nx, ny, nz, nx, ny, nz, u, v);
  return vertices.length / 8 - 1;
}

function midpoint(
  vertices: number[],
  cache: Map<string, number>,
  i1: number,
  i2: number
): number {
  const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const v1x = vertices[i1 * 8] ?? 0;
  const v1y = vertices[i1 * 8 + 1] ?? 0;
  const v1z = vertices[i1 * 8 + 2] ?? 0;
  const v2x = vertices[i2 * 8] ?? 0;
  const v2y = vertices[i2 * 8 + 1] ?? 0;
  const v2z = vertices[i2 * 8 + 2] ?? 0;

  const idx = addVertex(
    vertices,
    (v1x + v2x) * 0.5,
    (v1y + v2y) * 0.5,
    (v1z + v2z) * 0.5
  );
  cache.set(key, idx);
  return idx;
}

export function generateIcosphere(subdivisions: number): IcosphereGeometry {
  const vertices: number[] = [];
  let faces: [number, number, number][] = [];

  // Golden ratio
  const t = (1 + Math.sqrt(5)) / 2;

  // 12 initial vertices
  addVertex(vertices, -1, t, 0);
  addVertex(vertices, 1, t, 0);
  addVertex(vertices, -1, -t, 0);
  addVertex(vertices, 1, -t, 0);
  addVertex(vertices, 0, -1, t);
  addVertex(vertices, 0, 1, t);
  addVertex(vertices, 0, -1, -t);
  addVertex(vertices, 0, 1, -t);
  addVertex(vertices, t, 0, -1);
  addVertex(vertices, t, 0, 1);
  addVertex(vertices, -t, 0, -1);
  addVertex(vertices, -t, 0, 1);

  // 20 initial faces
  faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  // Subdivide
  const cache = new Map<string, number>();
  for (let s = 0; s < subdivisions; s++) {
    const newFaces: [number, number, number][] = [];
    for (const [v1, v2, v3] of faces) {
      const a = midpoint(vertices, cache, v1, v2);
      const b = midpoint(vertices, cache, v2, v3);
      const c = midpoint(vertices, cache, v3, v1);
      newFaces.push([v1, a, c], [v2, b, a], [v3, c, b], [a, b, c]);
    }
    faces = newFaces;
  }

  // Fix UV seam: duplicate vertices at seam
  const finalVertices: number[] = [...vertices];
  const indices: number[] = [];

  for (const [v1, v2, v3] of faces) {
    const u1 = finalVertices[v1 * 8 + 6] ?? 0;
    const u2 = finalVertices[v2 * 8 + 6] ?? 0;
    const u3 = finalVertices[v3 * 8 + 6] ?? 0;

    let i1 = v1, i2 = v2, i3 = v3;

    // Fix seam wrapping
    if (Math.abs(u1 - u2) > 0.5 || Math.abs(u1 - u3) > 0.5 || Math.abs(u2 - u3) > 0.5) {
      const avgU = (u1 + u2 + u3) / 3;

      if (u1 < 0.25 && avgU > 0.5) {
        i1 = finalVertices.length / 8;
        finalVertices.push(...finalVertices.slice(v1 * 8, v1 * 8 + 6), u1 + 1, finalVertices[v1 * 8 + 7] ?? 0);
      }
      if (u2 < 0.25 && avgU > 0.5) {
        i2 = finalVertices.length / 8;
        finalVertices.push(...finalVertices.slice(v2 * 8, v2 * 8 + 6), u2 + 1, finalVertices[v2 * 8 + 7] ?? 0);
      }
      if (u3 < 0.25 && avgU > 0.5) {
        i3 = finalVertices.length / 8;
        finalVertices.push(...finalVertices.slice(v3 * 8, v3 * 8 + 6), u3 + 1, finalVertices[v3 * 8 + 7] ?? 0);
      }
    }

    indices.push(i1, i2, i3);
  }

  return {
    vertices: new Float32Array(finalVertices),
    indices: new Uint32Array(indices),
    vertexCount: finalVertices.length / 8,
    indexCount: indices.length,
  };
}
