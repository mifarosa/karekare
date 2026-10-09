import { describe, expect, it } from 'vitest';
import { BRUSHES, brushDef, createStroke, isBrushKind, mulberry32, type StrokeParams } from '../src/core/brushes';
import type { Ctx2D } from '../src/core/canvas';

/** Records drawing calls; accepts any property assignment. */
function fakeCtx() {
  const calls: { name: string; args: number[] }[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: number[]) => {
        calls.push({ name: key, args });
        return key === 'createPattern' ? {} : undefined;
      };
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, calls };
}

const base: StrokeParams = {
  kind: 'pen',
  color: '#ff0000',
  size: 10,
  opacity: 1,
  smoothing: 0,
  pressure: false,
  width: 400,
  height: 300,
  seed: 1,
};

function line(stroke: ReturnType<typeof createStroke>, x0: number, x1: number, y = 100, step = 5) {
  for (let x = x0; x <= x1; x += step) stroke.push([x, y, 0.5]);
}

describe('brushes', () => {
  it('knows its brushes', () => {
    expect(BRUSHES).toHaveLength(16);
    expect(new Set(BRUSHES.map((b) => b.kind)).size).toBe(16);
    expect(isBrushKind('stars')).toBe(true);
    expect(isBrushKind('laser')).toBe(false);
    expect(brushDef('nope').kind).toBe('pen');
  });

  it('spaces dotted marks evenly', () => {
    const { ctx, calls } = fakeCtx();
    const stroke = createStroke({ ...base, kind: 'dots' }, ctx);
    line(stroke, 0, 170);
    const r = stroke.draw(ctx, () => {}, true)!;
    // Spacing is 1.7 × size = 17px: one dot at the start plus one every 17px.
    const arcs = calls.filter((c) => c.name === 'arc');
    expect(arcs).toHaveLength(11);
    expect(arcs[1].args[0]).toBeCloseTo(17);
    expect(r.x).toBe(0);
    expect(r.x + r.w).toBeGreaterThanOrEqual(170);
  });

  it('draws only new marks on each call', () => {
    const { ctx, calls } = fakeCtx();
    const stroke = createStroke({ ...base, kind: 'dots' }, ctx);
    line(stroke, 0, 85);
    stroke.draw(ctx, () => {}, false);
    const first = calls.filter((c) => c.name === 'arc').length;
    line(stroke, 90, 170);
    stroke.draw(ctx, () => {}, true);
    expect(calls.filter((c) => c.name === 'arc').length).toBe(11);
    expect(first).toBe(6);
  });

  it('keeps spray inside its radius', () => {
    const { ctx, calls } = fakeCtx();
    const stroke = createStroke({ ...base, kind: 'spray', size: 40 }, ctx);
    stroke.push([200, 150, 0.5]);
    stroke.draw(ctx, () => {}, false);
    const dots = calls.filter((c) => c.name === 'fillRect');
    expect(dots.length).toBeGreaterThan(20);
    for (const d of dots) expect(Math.hypot(d.args[0] - 200, d.args[1] - 150)).toBeLessThan(20 + 2);
  });

  it('is reproducible with the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('every brush draws inside the canvas', () => {
    // Textured brushes need a real canvas for their pattern; they share the outline path tested via pen.
    const kinds = BRUSHES.map((b) => b.kind).filter((k) => !['pencil', 'crayon', 'chalk'].includes(k));
    for (const kind of kinds) {
      const { ctx } = fakeCtx();
      const restored: unknown[] = [];
      const stroke = createStroke({ ...base, kind, size: 30 }, ctx);
      // A stroke that runs off the left edge.
      line(stroke, -50, 150, 120, 4);
      const r = stroke.draw(ctx, (rect) => restored.push(rect), true);
      expect(r, kind).not.toBeNull();
      expect(r!.x, kind).toBeGreaterThanOrEqual(0);
      expect(r!.y, kind).toBeGreaterThanOrEqual(0);
      expect(r!.x + r!.w, kind).toBeLessThanOrEqual(400);
      expect(r!.y + r!.h, kind).toBeLessThanOrEqual(300);
    }
  });
});
