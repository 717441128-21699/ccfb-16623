export type Vec3 = [number, number, number];

export const vec3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  normalize(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  },
};

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export class Mat4 {
  static identity(): Float32Array {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }

  static multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  static perspective(fovyDeg: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1 / Math.tan(degToRad(fovyDeg) / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  }

  static lookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array {
    const z = vec3.normalize(vec3.sub(eye, center));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);
    const out = new Float32Array(16);
    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[3] = 0;
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[7] = 0;
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[11] = 0;
    out[12] = -vec3.dot(x, eye);
    out[13] = -vec3.dot(y, eye);
    out[14] = -vec3.dot(z, eye);
    out[15] = 1;
    return out;
  }
}

export interface OrbitCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

export function cameraPosition(cam: OrbitCamera): Vec3 {
  const cp = Math.cos(cam.pitch);
  return [
    cam.target[0] + cam.distance * Math.sin(cam.yaw) * cp,
    cam.target[1] + cam.distance * Math.sin(cam.pitch),
    cam.target[2] + cam.distance * Math.cos(cam.yaw) * cp,
  ];
}

export function lightDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = degToRad(azimuthDeg);
  const e = degToRad(elevationDeg);
  const ce = Math.cos(e);
  // azimuth 0 and elevation 0 points toward +Z (the maple back).
  return vec3.normalize([ce * Math.sin(a), Math.sin(e), ce * Math.cos(a)]);
}
