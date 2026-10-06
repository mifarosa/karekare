import type { Rect } from '../model/types';

export interface FillRegion {
  /** One byte per canvas pixel: 1 = filled region, 2 = expansion ring. */
  mask: Uint8Array;
  bounds: Rect;
}

/**
 * Scanline flood fill. Pixels join the region when every premultiplied RGBA
 * channel is within `tolerance` (0..255) of the seed pixel.
 */
export function floodFill(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number,
): FillRegion | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;

  const s = (sy * width + sx) * 4;
  const sa = data[s + 3];
  const sr = (data[s] * sa) / 255;
  const sg = (data[s + 1] * sa) / 255;
  const sb = (data[s + 2] * sa) / 255;
  const tol = Math.max(0, tolerance);

  const match = (p: number): boolean => {
    const i = p * 4;
    const a = data[i + 3];
    if (Math.abs(a - sa) > tol) return false;
    if (Math.abs((data[i] * a) / 255 - sr) > tol) return false;
    if (Math.abs((data[i + 1] * a) / 255 - sg) > tol) return false;
    return Math.abs((data[i + 2] * a) / 255 - sb) <= tol;
  };

  const mask = new Uint8Array(width * height);
  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  const stack: number[] = [sx, sy];

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * width;
    if (mask[row + x] || !match(row + x)) continue;

    let lx = x;
    while (lx > 0 && !mask[row + lx - 1] && match(row + lx - 1)) lx--;
    let rx = x;
    while (rx < width - 1 && !mask[row + rx + 1] && match(row + rx + 1)) rx++;

    mask.fill(1, row + lx, row + rx + 1);
    if (lx < minX) minX = lx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    for (let ny = y - 1; ny <= y + 1; ny += 2) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let inRun = false;
      for (let nx = lx; nx <= rx; nx++) {
        const ok = !mask[nrow + nx] && match(nrow + nx);
        if (ok && !inRun) {
          stack.push(nx, ny);
          inRun = true;
        } else if (!ok) {
          inRun = false;
        }
      }
    }
  }

  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Grows the region by `radius` pixels (8-connected), marking new pixels with 2. */
export function expandRegion(region: FillRegion, width: number, height: number, radius: number): FillRegion {
  const { mask } = region;
  let { x: x0, y: y0 } = region.bounds;
  let x1 = x0 + region.bounds.w - 1;
  let y1 = y0 + region.bounds.h - 1;
  for (let step = 0; step < radius; step++) {
    const nx0 = Math.max(0, x0 - 1);
    const ny0 = Math.max(0, y0 - 1);
    const nx1 = Math.min(width - 1, x1 + 1);
    const ny1 = Math.min(height - 1, y1 + 1);
    const marker = 3; // temporary: added during this step
    for (let y = ny0; y <= ny1; y++) {
      for (let x = nx0; x <= nx1; x++) {
        const p = y * width + x;
        if (mask[p]) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const m = mask[yy * width + xx];
            if (m === 1 || m === 2) {
              near = true;
              break;
            }
          }
        }
        if (near) mask[p] = marker;
      }
    }
    for (let y = ny0; y <= ny1; y++) {
      for (let x = nx0; x <= nx1; x++) {
        const p = y * width + x;
        if (mask[p] === marker) mask[p] = 2;
      }
    }
    x0 = nx0;
    y0 = ny0;
    x1 = nx1;
    y1 = ny1;
  }
  return { mask, bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/**
 * Paints `color` into `target` (RGBA pixels of `rect`, a sub-area of the
 * canvas). Region pixels are replaced; ring pixels get the color underneath
 * the existing pixel so antialiased line edges stay on top.
 */
export function paintRegion(
  target: Uint8ClampedArray,
  rect: Rect,
  region: FillRegion,
  canvasWidth: number,
  color: [number, number, number],
): void {
  const [cr, cg, cb] = color;
  for (let y = 0; y < rect.h; y++) {
    const mrow = (rect.y + y) * canvasWidth + rect.x;
    const trow = y * rect.w * 4;
    for (let x = 0; x < rect.w; x++) {
      const m = region.mask[mrow + x];
      if (!m) continue;
      const i = trow + x * 4;
      if (m === 1) {
        target[i] = cr;
        target[i + 1] = cg;
        target[i + 2] = cb;
        target[i + 3] = 255;
      } else {
        const a = target[i + 3] / 255;
        if (a >= 1) continue;
        // Existing pixel over an opaque fill.
        target[i] = target[i] * a + cr * (1 - a);
        target[i + 1] = target[i + 1] * a + cg * (1 - a);
        target[i + 2] = target[i + 2] * a + cb * (1 - a);
        target[i + 3] = 255;
      }
    }
  }
}
