import { describe, expect, it } from 'vitest';
import { applyPlacement, fitRect, placementBounds, placementCorners, snapAngle } from '../src/editor/placement';

const close = (a: number[][], b: number[][]) =>
  a.forEach((p, i) => p.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 6)));

describe('placement math', () => {
  it('puts an unrotated object around its center', () => {
    const p = { cx: 100, cy: 50, scale: 2, rotation: 0 };
    close(placementCorners(p, 20, 10), [
      [80, 40],
      [120, 40],
      [120, 60],
      [80, 60],
    ]);
    expect(placementBounds(p, 20, 10)).toEqual({ x: 80, y: 40, w: 40, h: 20 });
  });

  it('rotates clockwise around the center', () => {
    const p = { cx: 0, cy: 0, scale: 1, rotation: Math.PI / 2 };
    // Top-left corner (-10,-5) turns to (5,-10).
    close([placementCorners(p, 20, 10)[0]], [[5, -10]]);
    const b = placementBounds(p, 20, 10);
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(20);
  });

  it('matches what the canvas transform draws', () => {
    // Record the transform calls and apply them to a point by hand.
    const ops: [string, number, number?][] = [];
    applyPlacement(
      {
        translate: (x, y) => ops.push(['t', x, y]),
        rotate: (a) => ops.push(['r', a]),
        scale: (x) => ops.push(['s', x]),
      },
      { cx: 30, cy: 40, scale: 3, rotation: 0.4 },
      8,
      6,
    );
    const map = (x: number, y: number) => {
      for (const [op, a, b] of [...ops].reverse()) {
        if (op === 't') [x, y] = [x + a, y + b!];
        else if (op === 's') [x, y] = [x * a, y * a];
        else [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
      }
      return [x, y];
    };
    const corners = placementCorners({ cx: 30, cy: 40, scale: 3, rotation: 0.4 }, 8, 6);
    close([map(0, 0), map(8, 0), map(8, 6), map(0, 6)], corners);
  });

  it('snaps angles near quarter turns', () => {
    expect(snapAngle(0.03)).toBe(0);
    expect(snapAngle(Math.PI / 2 + 0.05)).toBeCloseTo(Math.PI / 2);
    expect(snapAngle(0.5)).toBe(0.5);
    expect(snapAngle(-Math.PI + 0.02)).toBeCloseTo(-Math.PI);
  });

  it('fits photos by filling or containing', () => {
    // 4:3 photo on a 16:9 canvas.
    expect(fitRect(400, 300, 1600, 900, 'cover')).toEqual({ x: 0, y: -150, w: 1600, h: 1200 });
    expect(fitRect(400, 300, 1600, 900, 'contain')).toEqual({ x: 200, y: 0, w: 1200, h: 900 });
  });
});
