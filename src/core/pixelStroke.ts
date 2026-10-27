import type { Rect } from '../model/types';
import type { InputPoint } from './brush';
import type { BrushStroke } from './brushes';
import type { Ctx2D } from './canvas';

type Pixel = [number, number];

/** Top-left pixel of a size×size stamp centered on (x, y). */
export function stampOrigin(x: number, y: number, size: number): Pixel {
  const o = (size - 1) / 2;
  return [Math.floor(x - o), Math.floor(y - o)];
}

/** Pixels from `a` to `b` (both included), each touching the previous one. */
export function pixelLine(a: Pixel, b: Pixel): Pixel[] {
  const out: Pixel[] = [];
  let [x, y] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** True when `b` is the corner of an L made by a, b, c (a and c touch diagonally). */
export function isCorner(a: Pixel, b: Pixel, c: Pixel): boolean {
  return Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1]);
}

/**
 * Pixel art pen and eraser: hard size×size squares along the path, with no
 * pressure, smoothing or anti-aliasing. One-pixel lines are "pixel perfect":
 * the extra corner pixel of every L-shaped step is taken back out, so
 * diagonal and curved lines stay one pixel thin.
 */
export class PixelStroke implements BrushStroke {
  private pending: Pixel[] = [];
  private last: Pixel | null = null;
  /** Drawn pixels a later step may still remove (one-pixel strokes only). */
  private tail: Pixel[] = [];
  /** Pixels of this stroke that are final. */
  private kept = new Set<string>();

  /** `color` null erases. */
  constructor(
    private size: number,
    private color: string | null,
    private width: number,
    private height: number,
  ) {}

  push([x, y]: InputPoint): void {
    const p = stampOrigin(x, y, this.size);
    const from = this.last;
    if (from && from[0] === p[0] && from[1] === p[1]) return;
    this.last = p;
    if (!from) this.pending.push(p);
    else this.pending.push(...pixelLine(from, p).slice(1));
  }

  draw(ctx: Ctx2D, restore: (r: Rect) => void, last: boolean): Rect | null {
    void last;
    if (this.pending.length === 0) return null;
    const n = this.size;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const touch = ([x, y]: Pixel) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + n);
      y1 = Math.max(y1, y + n);
    };
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.color) ctx.fillStyle = this.color;
    for (const p of this.pending) {
      this.stamp(ctx, p);
      touch(p);
      if (n !== 1) continue;
      this.tail.push(p);
      if (this.tail.length < 3) continue;
      const [a, b, c] = this.tail;
      if (isCorner(a, b, c)) {
        // Put back what was under the corner, unless the stroke drew it before.
        if (!this.kept.has(this.key(b)) && !(b[0] === c[0] && b[1] === c[1])) restore({ x: b[0], y: b[1], w: 1, h: 1 });
        this.tail = [a, c];
      } else {
        this.kept.add(this.key(a));
        this.tail = [b, c];
      }
    }
    ctx.restore();
    this.pending = [];
    const x = Math.max(0, x0);
    const y = Math.max(0, y0);
    const w = Math.min(this.width, x1) - x;
    const h = Math.min(this.height, y1) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  private stamp(ctx: Ctx2D, [x, y]: Pixel): void {
    if (this.color) ctx.fillRect(x, y, this.size, this.size);
    else ctx.clearRect(x, y, this.size, this.size);
  }

  private key([x, y]: Pixel): string {
    return `${x},${y}`;
  }
}
