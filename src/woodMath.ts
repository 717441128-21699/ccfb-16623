import { MM_PER_WORLD_UNIT } from './state';

export interface FiberLike {
  woodPeriodMm: number;
  woodTiltDeg: number;
  woodSharpness: number;
  woodWarp: number;
}

export const DEG = Math.PI / 180;

export function periodWorld(p: Pick<FiberLike, 'woodPeriodMm'>): number {
  return p.woodPeriodMm / MM_PER_WORLD_UNIT;
}

/** Slow phase warp keeps the stripes organic without changing their mean period. */
export function phaseWarp(x: number, y: number, warp: number): number {
  return (
    warp * 0.8 * Math.sin(x * 2.1 + y * 1.3) +
    warp * 0.35 * Math.sin(x * 4.7 - y * 2.2)
  );
}

export function fiberPhase(x: number, y: number, p: FiberLike): number {
  return (Math.PI * 2 * y) / periodWorld(p) + phaseWarp(x, y, p.woodWarp);
}

/** Signed local fiber tilt in the longitudinal-tangent / surface-normal plane. */
export function fiberTiltRad(x: number, y: number, p: FiberLike): number {
  return p.woodTiltDeg * DEG * Math.sin(fiberPhase(x, y, p));
}

/**
 * Angle of L+V in the same plane. Angles are measured from the surface normal.
 * For a normal view this is exactly lightAngle / 2.
 */
export function halfVectorAngleRad(lightAngleRad: number, viewAngleRad = 0): number {
  return Math.atan2(
    Math.sin(lightAngleRad) + Math.sin(viewAngleRad),
    Math.cos(lightAngleRad) + Math.cos(viewAngleRad),
  );
}

/**
 * Scalar version of the WGSL Kajiya-Kay orientation lobe:
 * F = T cos(theta) + N sin(theta), H = N cos(h) + T sin(h),
 * so dot(F,H) = sin(h + theta) and 1-dot(F,H)^2 = cos^2(h + theta).
 */
export function orientationLobe(
  yWorld: number,
  lightAngleDeg: number,
  p: FiberLike,
  xWorld = 0,
  viewAngleDeg = 0,
): number {
  const theta = fiberTiltRad(xWorld, yWorld, p);
  const h = halfVectorAngleRad(lightAngleDeg * DEG, viewAngleDeg * DEG);
  const dotFH = Math.sin(h + theta);
  return Math.pow(Math.max(0, 1 - dotFH * dotFH), p.woodSharpness);
}

export interface StripePrediction {
  halfAngleDeg: number;
  rootPhases: [number, number];
  rootMm: [number, number];
  shiftMm: number;
  amplitudeMm: number;
  swapLightDeg: number;
  crossed: boolean;
}

function normalizePhase(a: number): number {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

/** Analytic n=0 bright-band solutions theta(phi) = -h. */
export function predictStripeCenters(
  lightAngleDeg: number,
  p: FiberLike,
  viewAngleDeg = 0,
): StripePrediction {
  const A = p.woodTiltDeg * DEG;
  const h = halfVectorAngleRad(lightAngleDeg * DEG, viewAngleDeg * DEG);
  const c = Math.max(-1, Math.min(1, -h / A));
  const a = Math.asin(c);
  let r1 = normalizePhase(a);
  let r2 = normalizePhase(Math.PI - a);
  if (r2 < r1) [r1, r2] = [r2, r1];

  const periodMm = p.woodPeriodMm;
  const rootMm: [number, number] = [(r1 * periodMm) / (Math.PI * 2), (r2 * periodMm) / (Math.PI * 2)];
  const smallAngleShift = -(periodMm * h) / (Math.PI * 2 * A);
  const amplitudeMm = (periodMm / (Math.PI * 2)) * Math.asin(Math.min(1, Math.abs(h) / A));

  return {
    halfAngleDeg: h / DEG,
    rootPhases: [r1, r2],
    rootMm,
    shiftMm: smallAngleShift,
    amplitudeMm,
    swapLightDeg: 2 * p.woodTiltDeg,
    crossed: Math.abs(h) >= A,
  };
}

export interface ProfileSample {
  yMm: number;
  intensity: number;
}

export function intensityProfile(
  lightAngleDeg: number,
  p: FiberLike,
  samples = 240,
  spanMm?: number,
): ProfileSample[] {
  const span = spanMm ?? p.woodPeriodMm * 2.2;
  const out: ProfileSample[] = [];
  for (let i = 0; i < samples; i++) {
    const yMm = -span / 2 + (span * i) / (samples - 1);
    const yWorld = yMm / MM_PER_WORLD_UNIT;
    out.push({ yMm, intensity: orientationLobe(yWorld, lightAngleDeg, p) });
  }
  return out;
}

export interface SelfCheckResult {
  ok: boolean;
  initialPeakMm: number;
  movedPeakMm: number;
  displacementMm: number;
  oldPeakAtSwap: number;
  oldTroughAtSwap: number;
  message: string;
}

/** Numerical assertion used by the Wood page badge. */
export function stripeSelfCheck(p: FiberLike): SelfCheckResult {
  const findPeak = (angle: number) => {
    const profile = intensityProfile(angle, p, 360, p.woodPeriodMm * 1.8);
    let best = profile[0];
    for (const s of profile) if (s.intensity > best.intensity) best = s;
    return best;
  };
  const p0 = findPeak(0);
  const small = predictStripeCenters(p.woodTiltDeg * 0.45, p);
  const moved = findPeak(p.woodTiltDeg * 0.9);
  const swapAngle = 2 * p.woodTiltDeg * 1.05;
  const oldPeakAtSwap = orientationLobe(p0.yMm / MM_PER_WORLD_UNIT, swapAngle, p);
  const oldTroughY = p.woodPeriodMm * 0.75; // phi = 3pi/2 -> maximal negative tilt
  const oldTroughAtSwap = orientationLobe(oldTroughY / MM_PER_WORLD_UNIT, swapAngle, p);
  const displacement = small.shiftMm;
  const directionCorrect = displacement < 0;
  const inverted = oldTroughAtSwap > oldPeakAtSwap * 1.25;
  return {
    ok: directionCorrect && inverted,
    initialPeakMm: p0.yMm,
    movedPeakMm: moved.yMm,
    displacementMm: displacement,
    oldPeakAtSwap,
    oldTroughAtSwap,
    message: inverted
      ? '扫光后原亮带变暗、原暗带升为亮带，极性反转成立。'
      : '当前锐度/倾角下反转对比偏弱，可提高锐度或扫光角度。',
  };
}
