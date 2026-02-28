// Procedural 3D airplane geometry
// Creates a simplified but recognizable airplane shape:
// - Fuselage (elongated octagonal prism)
// - Wings (swept delta shape)
// - Horizontal stabilizers (smaller wings at tail)
// - Vertical tail fin
// All in local space, centered at origin, nose pointing +Z

export interface AirplaneGeometry {
  readonly vertices: Float32Array; // interleaved: pos(3) + normal(3) = 6 floats
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly indexCount: number;
}

type Vec3 = [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-8) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

class MeshBuilder {
  private verts: number[] = [];
  private idxs: number[] = [];

  addVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const idx = this.verts.length / 6;
    this.verts.push(x, y, z, nx, ny, nz);
    return idx;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.idxs.push(a, b, c);
  }

  // Add a quad (2 triangles) with auto-computed normal
  addQuad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void {
    const n = normalize(cross(sub(p1, p0), sub(p3, p0)));
    const i0 = this.addVertex(p0[0], p0[1], p0[2], n[0], n[1], n[2]);
    const i1 = this.addVertex(p1[0], p1[1], p1[2], n[0], n[1], n[2]);
    const i2 = this.addVertex(p2[0], p2[1], p2[2], n[0], n[1], n[2]);
    const i3 = this.addVertex(p3[0], p3[1], p3[2], n[0], n[1], n[2]);
    this.addTriangle(i0, i1, i2);
    this.addTriangle(i0, i2, i3);
  }

  // Add a triangle with auto-computed normal
  addTri(p0: Vec3, p1: Vec3, p2: Vec3): void {
    const n = normalize(cross(sub(p1, p0), sub(p2, p0)));
    const i0 = this.addVertex(p0[0], p0[1], p0[2], n[0], n[1], n[2]);
    const i1 = this.addVertex(p1[0], p1[1], p1[2], n[0], n[1], n[2]);
    const i2 = this.addVertex(p2[0], p2[1], p2[2], n[0], n[1], n[2]);
    this.addTriangle(i0, i1, i2);
  }

  build(): AirplaneGeometry {
    return {
      vertices: new Float32Array(this.verts),
      indices: new Uint16Array(this.idxs),
      vertexCount: this.verts.length / 6,
      indexCount: this.idxs.length,
    };
  }
}

export function generateAirplane3D(): AirplaneGeometry {
  const mb = new MeshBuilder();

  // Scale: airplane fits in roughly [-0.5, 0.5] in all axes
  // Nose at +Z, tail at -Z, wings along X axis

  const FL = 0.5;  // fuselage half-length
  const FR = 0.06; // fuselage radius
  const WS = 0.45; // wing half-span
  const WC = 0.18; // wing chord (front-to-back)
  const WT = 0.02; // wing thickness
  const HS = 0.18; // horizontal stabilizer half-span
  const HC = 0.10; // horizontal stabilizer chord
  const VH = 0.12; // vertical fin height
  const VC = 0.12; // vertical fin chord

  // ── Fuselage ──────────────────────────────────────────────────────────────
  // Octagonal cross-section fuselage
  const SIDES = 8;
  const fuselageZ = [-FL, -FL * 0.6, -FL * 0.2, FL * 0.3, FL * 0.7, FL];
  const fuselageR = [FR * 0.3, FR * 0.8, FR, FR * 0.9, FR * 0.5, 0.0];

  for (let s = 0; s < SIDES; s++) {
    const a0 = (s / SIDES) * Math.PI * 2;
    const a1 = ((s + 1) / SIDES) * Math.PI * 2;

    for (let z = 0; z < fuselageZ.length - 1; z++) {
      const z0 = fuselageZ[z] ?? 0;
      const z1 = fuselageZ[z + 1] ?? 0;
      const r0 = fuselageR[z] ?? 0;
      const r1 = fuselageR[z + 1] ?? 0;

      const x00 = Math.cos(a0) * r0;
      const y00 = Math.sin(a0) * r0;
      const x10 = Math.cos(a1) * r0;
      const y10 = Math.sin(a1) * r0;
      const x01 = Math.cos(a0) * r1;
      const y01 = Math.sin(a0) * r1;
      const x11 = Math.cos(a1) * r1;
      const y11 = Math.sin(a1) * r1;

      if (r0 > 0.001 && r1 > 0.001) {
        mb.addQuad(
          [x00, y00, z0],
          [x10, y10, z0],
          [x11, y11, z1],
          [x01, y01, z1]
        );
      } else if (r0 > 0.001) {
        // Nose cone triangle
        mb.addTri([x00, y00, z0], [x10, y10, z0], [x01, y01, z1]);
      } else if (r1 > 0.001) {
        // Tail cone triangle
        mb.addTri([x00, y00, z0], [x11, y11, z1], [x01, y01, z1]);
      }
    }
  }

  // ── Main Wings ────────────────────────────────────────────────────────────
  // Swept wings: root at z=0, tip swept back
  const wingRootZ = FL * 0.1;   // wing root position (z)
  const wingTipZ = -FL * 0.15;  // wing tip swept back
  const wingRootX = FR * 1.1;   // wing root starts at fuselage edge
  const wingTipX = WS;          // wing tip span

  // Right wing (positive X)
  const rwBL: Vec3 = [wingRootX, -WT, wingRootZ];
  const rwBR: Vec3 = [wingTipX, -WT, wingTipZ];
  const rwTL: Vec3 = [wingRootX, WT, wingRootZ];
  const rwTR: Vec3 = [wingTipX, WT, wingTipZ];
  const rwBLe: Vec3 = [wingRootX, -WT, wingRootZ - WC];
  const rwBRe: Vec3 = [wingTipX, -WT, wingTipZ - WC * 0.4];
  const rwTLe: Vec3 = [wingRootX, WT, wingRootZ - WC];
  const rwTRe: Vec3 = [wingTipX, WT, wingTipZ - WC * 0.4];

  // Top surface
  mb.addQuad(rwTL, rwTR, rwTRe, rwTLe);
  // Bottom surface
  mb.addQuad(rwBLe, rwBRe, rwBR, rwBL);
  // Leading edge
  mb.addQuad(rwBL, rwBR, rwTR, rwTL);
  // Trailing edge
  mb.addQuad(rwTLe, rwTRe, rwBRe, rwBLe);
  // Tip
  mb.addQuad(rwTR, rwBR, rwBRe, rwTRe);

  // Left wing (mirror X)
  const lwBL: Vec3 = [-wingRootX, -WT, wingRootZ];
  const lwBR: Vec3 = [-wingTipX, -WT, wingTipZ];
  const lwTL: Vec3 = [-wingRootX, WT, wingRootZ];
  const lwTR: Vec3 = [-wingTipX, WT, wingTipZ];
  const lwBLe: Vec3 = [-wingRootX, -WT, wingRootZ - WC];
  const lwBRe: Vec3 = [-wingTipX, -WT, wingTipZ - WC * 0.4];
  const lwTLe: Vec3 = [-wingRootX, WT, wingRootZ - WC];
  const lwTRe: Vec3 = [-wingTipX, WT, wingTipZ - WC * 0.4];

  mb.addQuad(lwTR, lwTL, lwTLe, lwTRe);
  mb.addQuad(lwBLe, lwBL, lwBR, lwBRe);
  mb.addQuad(lwTL, lwBL, lwBR, lwTR);
  mb.addQuad(lwTRe, lwBRe, lwBLe, lwTLe);
  mb.addQuad(lwBR, lwTR, lwTRe, lwBRe);

  // ── Horizontal Stabilizers ────────────────────────────────────────────────
  const hStabZ = -FL * 0.75;
  const hStabRootX = FR * 0.9;
  const hStabTipX = HS;
  const hStabFront = hStabZ + HC * 0.3;
  const hStabBack = hStabZ - HC * 0.7;
  const hStabTipFront = hStabZ + HC * 0.1;
  const hStabTipBack = hStabZ - HC * 0.5;
  const hWT = WT * 0.7;

  // Right stabilizer
  mb.addQuad(
    [hStabRootX, hWT, hStabFront],
    [hStabTipX, hWT, hStabTipFront],
    [hStabTipX, hWT, hStabTipBack],
    [hStabRootX, hWT, hStabBack]
  );
  mb.addQuad(
    [hStabRootX, -hWT, hStabBack],
    [hStabTipX, -hWT, hStabTipBack],
    [hStabTipX, -hWT, hStabTipFront],
    [hStabRootX, -hWT, hStabFront]
  );
  mb.addQuad(
    [hStabRootX, -hWT, hStabFront],
    [hStabTipX, -hWT, hStabTipFront],
    [hStabTipX, hWT, hStabTipFront],
    [hStabRootX, hWT, hStabFront]
  );
  mb.addTri(
    [hStabTipX, -hWT, hStabTipFront],
    [hStabTipX, -hWT, hStabTipBack],
    [hStabTipX, hWT, hStabTipFront]
  );

  // Left stabilizer (mirror X)
  mb.addQuad(
    [-hStabTipX, hWT, hStabTipFront],
    [-hStabRootX, hWT, hStabFront],
    [-hStabRootX, hWT, hStabBack],
    [-hStabTipX, hWT, hStabTipBack]
  );
  mb.addQuad(
    [-hStabRootX, -hWT, hStabFront],
    [-hStabTipX, -hWT, hStabTipFront],
    [-hStabTipX, -hWT, hStabTipBack],
    [-hStabRootX, -hWT, hStabBack]
  );
  mb.addQuad(
    [-hStabRootX, hWT, hStabFront],
    [-hStabRootX, -hWT, hStabFront],
    [-hStabTipX, -hWT, hStabTipFront],
    [-hStabTipX, hWT, hStabTipFront]
  );
  mb.addTri(
    [-hStabTipX, hWT, hStabTipFront],
    [-hStabTipX, -hWT, hStabTipBack],
    [-hStabTipX, -hWT, hStabTipFront]
  );

  // ── Vertical Tail Fin ─────────────────────────────────────────────────────
  const vFinZ = -FL * 0.65;
  const vFinFront = vFinZ + VC * 0.4;
  const vFinBack = vFinZ - VC * 0.6;
  const vFinBase = FR * 0.8;
  const vFinTop = VH;
  const vFinTopZ = vFinZ - VC * 0.2;
  const vFT = WT * 0.8;

  // Right face
  mb.addQuad(
    [vFT, vFinBase, vFinFront],
    [vFT, vFinBase, vFinBack],
    [vFT * 0.3, vFinTop, vFinTopZ],
    [vFT * 0.3, vFinTop, vFinFront]
  );
  // Left face
  mb.addQuad(
    [-vFT, vFinBase, vFinBack],
    [-vFT, vFinBase, vFinFront],
    [-vFT * 0.3, vFinTop, vFinFront],
    [-vFT * 0.3, vFinTop, vFinTopZ]
  );
  // Leading edge
  mb.addQuad(
    [-vFT, vFinBase, vFinFront],
    [vFT, vFinBase, vFinFront],
    [vFT * 0.3, vFinTop, vFinFront],
    [-vFT * 0.3, vFinTop, vFinFront]
  );
  // Trailing edge
  mb.addQuad(
    [vFT, vFinBase, vFinBack],
    [-vFT, vFinBase, vFinBack],
    [-vFT * 0.3, vFinTop, vFinTopZ],
    [vFT * 0.3, vFinTop, vFinTopZ]
  );
  // Top edge
  mb.addQuad(
    [vFT * 0.3, vFinTop, vFinFront],
    [vFT * 0.3, vFinTop, vFinTopZ],
    [-vFT * 0.3, vFinTop, vFinTopZ],
    [-vFT * 0.3, vFinTop, vFinFront]
  );

  return mb.build();
}
