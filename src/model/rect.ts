import type { Rect } from './types';

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Snap to integer pixels (outwards) and clip to [0,0,width,height]. */
export function clip(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function area(r: Rect | null): number {
  return r ? r.w * r.h : 0;
}

/** Bounding box of a flat list of [x, y] points. */
export function boundsOfPoints(pts: ArrayLike<number[]>): Rect | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Tight bounds of non-transparent pixels in RGBA data, or null when fully
 * transparent.
 */
export function alphaBounds(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Rect | null {
  let top = -1;
  for (let y = 0; y < height && top < 0; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        top = y;
        break;
      }
    }
  }
  if (top < 0) return null;
  let bottom = top;
  for (let y = height - 1; y > top; y--) {
    const row = y * width * 4;
    let found = false;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        found = true;
        break;
      }
    }
    if (found) {
      bottom = y;
      break;
    }
  }
  let left = width;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    const row = y * width * 4;
    for (let x = 0; x < left; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        left = x;
        break;
      }
    }
    for (let x = width - 1; x > right; x--) {
      if (data[row + x * 4 + 3] !== 0) {
        right = x;
        break;
      }
    }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
