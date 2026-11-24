import { clamp, smoothstep, vec3, type Vec3 } from './math';
import { fiberPhase } from './woodMath';

export const STRIDE = 9;

export const MAT = {
  tiger: 0,
  spruce: 1,
  ebony: 2,
  metal: 3,
  bridge: 4,
  maple: 5,
} as const;

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

class Builder {
  positions: number[] = [];
  uvs: number[] = [];
  materials: number[] = [];
  indices: number[] = [];

  add(p: Vec3, uv: [number, number], material: number): number {
    const id = this.positions.length / 3;
    this.positions.push(p[0], p[1], p[2]);
    this.uvs.push(uv[0], uv[1]);
    this.materials.push(material);
    return id;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  quadPoints(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, material: number, uv?: [number, number][]): void {
    const u = uv ?? [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const a = this.add(p0, u[0], material);
    const b = this.add(p1, u[1], material);
    const c = this.add(p2, u[2], material);
    const d = this.add(p3, u[3], material);
    this.quad(a, b, c, d);
  }

  computeNormals(): number[] {
    const normals = new Array<number>(this.positions.length).fill(0);
    for (let i = 0; i < this.indices.length; i += 3) {
      const ia = this.indices[i] * 3;
      const ib = this.indices[i + 1] * 3;
      const ic = this.indices[i + 2] * 3;
      const a: Vec3 = [this.positions[ia], this.positions[ia + 1], this.positions[ia + 2]];
      const b: Vec3 = [this.positions[ib], this.positions[ib + 1], this.positions[ib + 2]];
      const c: Vec3 = [this.positions[ic], this.positions[ic + 1], this.positions[ic + 2]];
      const e1 = vec3.sub(b, a);
      const e2 = vec3.sub(c, a);
      const n = vec3.cross(e1, e2);
      for (const id of [ia, ib, ic]) {
        normals[id] += n[0];
        normals[id + 1] += n[1];
        normals[id + 2] += n[2];
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const n = vec3.normalize([normals[i], normals[i + 1], normals[i + 2]]);
      normals[i] = n[0];
      normals[i + 1] = n[1];
      normals[i + 2] = n[2];
    }
    return normals;
  }

  pack(): MeshData {
    const normals = this.computeNormals();
    const count = this.positions.length / 3;
    const vertices = new Float32Array(count * STRIDE);
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      vertices[o] = this.positions[i * 3];
      vertices[o + 1] = this.positions[i * 3 + 1];
      vertices[o + 2] = this.positions[i * 3 + 2];
      vertices[o + 3] = normals[i * 3];
      vertices[o + 4] = normals[i * 3 + 1];
      vertices[o + 5] = normals[i * 3 + 2];
      vertices[o + 6] = this.uvs[i * 2];
      vertices[o + 7] = this.uvs[i * 2 + 1];
      vertices[o + 8] = this.materials[i];
    }
    return { vertices, indices: new Uint32Array(this.indices) };
  }
}

const WIDTH_KEYS: Array<[number, number]> = [
  [-1.0, 0.0],
  [-0.94, 0.2],
  [-0.82, 0.58],
  [-0.58, 0.79],
  [-0.42, 0.82],
  [-0.24, 0.67],
  [-0.08, 0.4],
  [0.06, 0.35],
  [0.2, 0.4],
  [0.38, 0.58],
  [0.56, 0.65],
  [0.74, 0.57],
  [0.9, 0.34],
  [1.02, 0.0],
];

export const BODY_TOP_Y = 1.02;

export function halfWidthAtY(y: number): number {
  if (y <= WIDTH_KEYS[0][0]) return WIDTH_KEYS[0][1];
  for (let i = 0; i < WIDTH_KEYS.length - 1; i++) {
    const [y0, w0] = WIDTH_KEYS[i];
    const [y1, w1] = WIDTH_KEYS[i + 1];
    if (y >= y0 && y <= y1) {
      const t = smoothstep(0, 1, (y - y0) / (y1 - y0));
      return w0 + (w1 - w0) * t;
    }
  }
  return WIDTH_KEYS[WIDTH_KEYS.length - 1][1];
}

function endEnvelope(y: number): number {
  return smoothstep(-1.0, -0.7, y) * (1 - smoothstep(0.76, BODY_TOP_Y, y));
}

function crossArch(u: number): number {
  return Math.pow(Math.max(0, 1 - u * u), 0.72);
}

export function backSurfaceZ(y: number, u: number): number {
  return 0.165 * crossArch(u) * endEnvelope(y);
}

export function frontSurfaceZ(y: number, u: number): number {
  return -0.3 - 0.115 * crossArch(u) * endEnvelope(y);
}

export function backFrame(y: number, u: number): { p: Vec3; n: Vec3; tangent: Vec3 } {
  const hw = halfWidthAtY(y);
  const x = u * hw;
  const p: Vec3 = [x, y, backSurfaceZ(y, u)];
  const ey = 0.003;
  const eu = 0.003;
  const y0 = clamp(y - ey, -0.999, 1.019);
  const y1 = clamp(y + ey, -0.999, 1.019);
  const u0 = clamp(u - eu, -0.999, 0.999);
  const u1 = clamp(u + eu, -0.999, 0.999);
  const pu0: Vec3 = [u0 * hw, y, backSurfaceZ(y, u0)];
  const pu1: Vec3 = [u1 * hw, y, backSurfaceZ(y, u1)];
  const py0: Vec3 = [u * halfWidthAtY(y0), y0, backSurfaceZ(y0, u)];
  const py1: Vec3 = [u * halfWidthAtY(y1), y1, backSurfaceZ(y1, u)];
  const du = vec3.scale(vec3.sub(pu1, pu0), 1 / Math.max(1e-5, u1 - u0));
  const dy = vec3.scale(vec3.sub(py1, py0), 1 / Math.max(1e-5, y1 - y0));
  let n = vec3.normalize(vec3.cross(du, dy));
  if (n[2] < 0) n = vec3.scale(n, -1);
  let t: Vec3 = [0, 1, 0];
  t = vec3.normalize(vec3.sub(t, vec3.scale(n, vec3.dot(t, n))));
  return { p, n, tangent: t };
}

function addBodyPlate(b: Builder, back: boolean, material: number): void {
  const NX = 46;
  const NY = 118;
  const grid: number[][] = [];
  for (let iy = 0; iy <= NY; iy++) {
    const y = -1 + ((BODY_TOP_Y + 1) * iy) / NY;
    const hw = halfWidthAtY(y);
    const row: number[] = [];
    for (let ix = 0; ix <= NX; ix++) {
      const u = -1 + (2 * ix) / NX;
      const x = u * hw;
      const z = back ? backSurfaceZ(y, u) : frontSurfaceZ(y, u);
      row.push(b.add([x, y, z], [(u + 1) / 2, iy / NY], material));
    }
    grid.push(row);
  }
  for (let iy = 0; iy < NY; iy++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = grid[iy][ix];
      const bb = grid[iy][ix + 1];
      const c = grid[iy + 1][ix + 1];
      const d = grid[iy + 1][ix];
      b.quad(a, bb, c, d);
    }
  }
}

function addRibs(b: Builder): void {
  const N = 132;
  const boundary: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= N; i++) {
    const y = -1 + ((BODY_TOP_Y + 1) * i) / N;
    boundary.push({ x: halfWidthAtY(y) * 1.012, y });
  }
  for (let i = 0; i <= N; i++) {
    const y = BODY_TOP_Y - ((BODY_TOP_Y + 1) * i) / N;
    boundary.push({ x: -halfWidthAtY(y) * 1.012, y });
  }
  for (let i = 0; i < boundary.length - 1; i++) {
    const p0 = boundary[i];
    const p1 = boundary[i + 1];
    const zTop0 = backSurfaceZ(p0.y, Math.sign(p0.x) || 1);
    const zTop1 = backSurfaceZ(p1.y, Math.sign(p1.x) || 1);
    b.quadPoints(
      [p0.x, p0.y, zTop0],
      [p1.x, p1.y, zTop1],
      [p1.x, p1.y, -0.305],
      [p0.x, p0.y, -0.305],
      MAT.tiger,
    );
  }
}

function addBox(b: Builder, center: Vec3, size: Vec3, material: number): void {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((v) => v / 2);
  const x0 = cx - sx;
  const x1 = cx + sx;
  const y0 = cy - sy;
  const y1 = cy + sy;
  const z0 = cz - sz;
  const z1 = cz + sz;
  b.quadPoints([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], material);
  b.quadPoints([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], material);
  b.quadPoints([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], material);
  b.quadPoints([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], material);
  b.quadPoints([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], material);
  b.quadPoints([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], material);
}

interface SlabOptions {
  y0: number;
  y1: number;
  w0: number;
  w1: number;
  zOuter0: number;
  zOuter1: number;
  thickness: number;
  material: number;
}

function addTaperedSlab(b: Builder, o: SlabOptions): void {
  const zi0 = o.zOuter0 + o.thickness;
  const zi1 = o.zOuter1 + o.thickness;
  const p: Vec3[] = [
    [-o.w0, o.y0, o.zOuter0],
    [o.w0, o.y0, o.zOuter0],
    [o.w1, o.y1, o.zOuter1],
    [-o.w1, o.y1, o.zOuter1],
    [-o.w0, o.y0, zi0],
    [o.w0, o.y0, zi0],
    [o.w1, o.y1, zi1],
    [-o.w1, o.y1, zi1],
  ];
  b.quadPoints(p[0], p[1], p[2], p[3], o.material); // outer/string face
  b.quadPoints(p[5], p[4], p[7], p[6], o.material);
  b.quadPoints(p[4], p[0], p[3], p[7], o.material);
  b.quadPoints(p[1], p[5], p[6], p[2], o.material);
  b.quadPoints(p[3], p[2], p[6], p[7], o.material);
  b.quadPoints(p[4], p[5], p[1], p[0], o.material);
}

function basisFromAxis(axis: Vec3): { u: Vec3; v: Vec3 } {
  const helper = Math.abs(axis[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const u = vec3.normalize(vec3.cross(axis, helper as Vec3));
  const v = vec3.normalize(vec3.cross(u, axis));
  return { u, v };
}

function addCylinder(
  b: Builder,
  a: Vec3,
  c: Vec3,
  r0: number,
  r1: number,
  segments: number,
  material: number,
): void {
  const axis = vec3.normalize(vec3.sub(c, a));
  const { u, v } = basisFromAxis(axis);
  const ring0: number[] = [];
  const ring1: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const radial = vec3.add(vec3.scale(u, Math.cos(t)), vec3.scale(v, Math.sin(t)));
    ring0.push(b.add(vec3.add(a, vec3.scale(radial, r0)), [i / segments, 0], material));
    ring1.push(b.add(vec3.add(c, vec3.scale(radial, r1)), [i / segments, 1], material));
  }
  for (let i = 0; i < segments; i++) {
    b.quad(ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]);
  }
}

function addEllipsoid(
  b: Builder,
  center: Vec3,
  scale: Vec3,
  material: number,
  lat = 18,
  lon = 28,
): void {
  const grid: number[][] = [];
  for (let i = 0; i <= lat; i++) {
    const theta = (Math.PI * i) / lat;
    const row: number[] = [];
    for (let j = 0; j <= lon; j++) {
      const phi = (Math.PI * 2 * j) / lon;
      const p: Vec3 = [
        center[0] + scale[0] * Math.sin(theta) * Math.cos(phi),
        center[1] + scale[1] * Math.cos(theta),
        center[2] + scale[2] * Math.sin(theta) * Math.sin(phi),
      ];
      row.push(b.add(p, [j / lon, i / lat], material));
    }
    grid.push(row);
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      b.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  }
}

function addStrings(b: Builder): void {
  const bridgeX = [-0.105, -0.035, 0.035, 0.105];
  const nutX = [-0.058, -0.019, 0.019, 0.058];
  for (let i = 0; i < 4; i++) {
    const tail: Vec3 = [bridgeX[i] * 0.72, -0.82, -0.43];
    const bridge: Vec3 = [bridgeX[i], -0.07, -0.585];
    const nut: Vec3 = [nutX[i], 2.17, -0.392];
    addCylinder(b, tail, bridge, 0.0065, 0.0055, 6, MAT.metal);
    addCylinder(b, bridge, nut, 0.0055, 0.0042, 6, MAT.metal);
    const pegSide = i < 2 ? -1 : 1;
    const pegEnd: Vec3 = [pegSide * 0.22, 2.34 + (i % 2) * 0.08, -0.27];
    addCylinder(b, nut, pegEnd, 0.004, 0.003, 6, MAT.metal);
  }
}

export function buildViolin(): MeshData {
  const b = new Builder();
  // Plates and ribs
  addBodyPlate(b, true, MAT.tiger);
  addBodyPlate(b, false, MAT.spruce);
  addRibs(b);

  // Neck, pegbox and scroll (back side remains maple)
  addCylinder(b, [0, 0.78, -0.18], [0, 2.18, -0.2], 0.2, 0.135, 18, MAT.maple);
  addBox(b, [0, 2.28, -0.24], [0.27, 0.34, 0.18], MAT.maple);
  addEllipsoid(b, [0, 2.55, -0.2], [0.13, 0.18, 0.13], MAT.maple, 16, 24);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const y = 2.23 + i * 0.11;
      addCylinder(b, [side * 0.08, y, -0.22], [side * 0.31, y + 0.02, -0.22], 0.025, 0.018, 10, MAT.ebony);
      addEllipsoid(b, [side * 0.34, y + 0.022, -0.22], [0.055, 0.04, 0.04], MAT.ebony, 10, 16);
    }
  }

  // Fingerboard, nut, tailpiece and chin rest on the front (-Z) side
  addTaperedSlab(b, {
    y0: 0.48,
    y1: 2.18,
    w0: 0.215,
    w1: 0.128,
    zOuter0: -0.475,
    zOuter1: -0.345,
    thickness: 0.052,
    material: MAT.ebony,
  });
  addBox(b, [0, 2.18, -0.365], [0.285, 0.045, 0.055], MAT.bridge);
  addTaperedSlab(b, {
    y0: -0.88,
    y1: -0.27,
    w0: 0.12,
    w1: 0.205,
    zOuter0: -0.43,
    zOuter1: -0.405,
    thickness: 0.055,
    material: MAT.ebony,
  });
  addEllipsoid(b, [-0.47, -0.58, -0.43], [0.22, 0.31, 0.075], MAT.ebony, 16, 24);

  // Bridge and strings
  addBox(b, [0, -0.08, -0.505], [0.47, 0.055, 0.19], MAT.bridge);
  addBox(b, [-0.16, -0.08, -0.425], [0.07, 0.07, 0.08], MAT.bridge);
  addBox(b, [0.16, -0.08, -0.425], [0.07, 0.07, 0.08], MAT.bridge);
  addStrings(b);

  // End button
  addEllipsoid(b, [0, -1.03, -0.02], [0.07, 0.06, 0.05], MAT.ebony, 12, 18);

  const mesh = b.pack();
  // The outline keys were authored generously. A shared x squash gives the
  // correct ~210 mm lower-bout width while preserving normals with inverse scale.
  const X_SCALE = 0.72;
  for (let i = 0; i < mesh.vertices.length; i += STRIDE) {
    mesh.vertices[i] *= X_SCALE;
    const nx = mesh.vertices[i + 3] / X_SCALE;
    const ny = mesh.vertices[i + 4];
    const nz = mesh.vertices[i + 5];
    const len = Math.hypot(nx, ny, nz) || 1;
    mesh.vertices[i + 3] = nx / len;
    mesh.vertices[i + 4] = ny / len;
    mesh.vertices[i + 5] = nz / len;
  }
  return mesh;
}

export const FIBER_COLS = 17;
export const FIBER_ROWS = 38;
export const FIBER_SEGMENTS = FIBER_COLS * FIBER_ROWS;
export const FIBER_VERTEX_FLOATS = FIBER_SEGMENTS * 2 * 7;

interface FiberParams {
  woodPeriodMm: number;
  woodTiltDeg: number;
  woodWarp: number;
}

export function fillFiberLines(data: Float32Array, params: FiberParams): number {
  let o = 0;
  const periodWorld = params.woodPeriodMm / 176;
  for (let r = 0; r < FIBER_ROWS; r++) {
    const y = -0.91 + (1.72 * r) / (FIBER_ROWS - 1);
    for (let c = 0; c < FIBER_COLS; c++) {
      const u = -0.84 + (1.68 * c) / (FIBER_COLS - 1);
      const f = backFrame(y, u);
      const scaledX = f.p[0] * 0.72;
      const phase = (Math.PI * 2 * y) / periodWorld
        + params.woodWarp * 1.45 * Math.sin(scaledX * 2.1 + y * 1.3)
        + params.woodWarp * 0.55 * Math.sin(scaledX * 4.7 - y * 2.2);
      const theta = (params.woodTiltDeg * Math.PI) / 180 * Math.sin(phase);
      const fiber = vec3.normalize(
        vec3.add(vec3.scale(f.tangent, Math.cos(theta)), vec3.scale(f.n, Math.sin(theta))),
      );
      const half = 0.031;
      const lift = vec3.scale(f.n, 0.014);
      const p0 = vec3.add(vec3.add(f.p, lift), vec3.scale(fiber, -half));
      const p1 = vec3.add(vec3.add(f.p, lift), vec3.scale(fiber, half));
      const warm = theta >= 0;
      const col = warm ? [1.0, 0.68, 0.26, 0.95] : [0.38, 0.86, 1.0, 0.95];
      for (const source of [p0, p1]) {
        const p: Vec3 = [source[0] * 0.72, source[1], source[2]];
        data[o++] = p[0];
        data[o++] = p[1];
        data[o++] = p[2];
        data[o++] = col[0];
        data[o++] = col[1];
        data[o++] = col[2];
        data[o++] = col[3];
      }
    }
  }
  return o;
}
