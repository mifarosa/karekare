import type { Rect } from '../model/types';

/** Position, size and angle of an object being placed, in project pixels. */
export interface Placement {
  /** Center of the object. */
  cx: number;
  cy: number;
  scale: number;
  /** Radians, clockwise. */
  rotation: number;
}

export type FitMode = 'cover' | 'contain';

/** Sets up `ctx` so that drawing at (0,0)-(w,h) lands where the placement says. */
export function applyPlacement(
  ctx: { translate(x: number, y: number): void; rotate(a: number): void; scale(x: number, y: number): void },
  p: Placement,
  w: number,
  h: number,
): void {
  ctx.translate(p.cx, p.cy);
  ctx.rotate(p.rotation);
  ctx.scale(p.scale, p.scale);
  ctx.translate(-w / 2, -h / 2);
}

/** Corners of the placed object (top-left, top-right, bottom-right, bottom-left). */
export function placementCorners(p: Placement, w: number, h: number): [number, number][] {
  const cos = Math.cos(p.rotation) * p.scale;
  const sin = Math.sin(p.rotation) * p.scale;
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [p.cx + x * cos - y * sin, p.cy + x * sin + y * cos]);
}

/** Axis-aligned bounds of the placed object. */
export function placementBounds(p: Placement, w: number, h: number): Rect {
  const pts = placementCorners(p, w, h);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Snaps an angle to the nearest quarter turn when it is within `tolerance`. */
export function snapAngle(a: number, tolerance = 0.07): number {
  const quarter = Math.PI / 2;
  const nearest = Math.round(a / quarter) * quarter;
  return Math.abs(a - nearest) < tolerance ? nearest : a;
}

/** Where an image of size w×h goes on a W×H canvas, filling it or fitting inside it. */
export function fitRect(w: number, h: number, W: number, H: number, mode: FitMode): Rect {
  const s = mode === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  const dw = w * s;
  const dh = h * s;
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
}
