import { describe, expect, it } from 'vitest';
import { PixelStroke, isCorner, pixelLine, stampOrigin } from '../src/core/pixelStroke';
import type { Rect } from '../src/model/types';

/** Records fills and clears on a tiny fake canvas. */
function fakeCtx(width: number, height: number) {
  const px = new Map<string, string>();
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < width && j < height) px.set(`${i},${j}`, ctx.fillStyle);
    },
    clearRect(x: number, y: number, w: number, h: number) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px.delete(`${i},${j}`);
    },
  };
  const restore = (r: Rect) => ctx.clearRect(r.x, r.y, r.w, r.h);
  return { ctx, px, restore };
}

describe('pixel lines', () => {
  it('centers stamps on the pointer', () => {
    expect(stampOrigin(3.7, 2.2, 1)).toEqual([3, 2]);
    expect(stampOrigin(3.7, 2.2, 2)).toEqual([3, 1]);
    expect(stampOrigin(3.7, 2.2, 3)).toEqual([2, 1]);
  });

  it('walks connected pixels', () => {
    expect(pixelLine([0, 0], [3, 1])).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]]);
    expect(pixelLine([2, 2], [2, 2])).toEqual([[2, 2]]);
    const diag = pixelLine([5, 0], [0, 5]);
    expect(diag).toHaveLength(6);
    for (let i = 1; i < diag.length; i++) {
      expect(Math.max(Math.abs(diag[i][0] - diag[i - 1][0]), Math.abs(diag[i][1] - diag[i - 1][1]))).toBe(1);
    }
  });

  it('spots L-shaped corners', () => {
    expect(isCorner([0, 0], [1, 0], [1, 1])).toBe(true);
    expect(isCorner([0, 0], [1, 0], [2, 0])).toBe(false);
    expect(isCorner([0, 0], [1, 1], [2, 2])).toBe(false);
  });
});

describe('PixelStroke', () => {
  it('draws hard squares and reports the changed area', () => {
    const { ctx, px, restore } = fakeCtx(16, 16);
    const s = new PixelStroke(2, '#ff0000', 16, 16);
    s.push([4.5, 4.5, 1]);
    s.push([8.5, 4.5, 1]);
    const r = s.draw(ctx as never, restore, true);
    expect(r).toEqual({ x: 4, y: 4, w: 6, h: 2 });
    expect(px.size).toBe(12);
  });

  it('keeps one-pixel lines free of L corners', () => {
    const { ctx, px, restore } = fakeCtx(16, 16);
    const s = new PixelStroke(1, '#000', 16, 16);
    // A staircase drawn as right, down, right, down...
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3]]) {
      s.push([x + 0.5, y + 0.5, 1]);
      s.draw(ctx as never, restore, false);
    }
    expect([...px.keys()].sort()).toEqual(['0,0', '1,1', '2,2', '3,3']);
  });

  it('erases', () => {
    const { ctx, px, restore } = fakeCtx(8, 8);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 8, 8);
    const s = new PixelStroke(3, null, 8, 8);
    s.push([1.5, 1.5, 1]);
    s.draw(ctx as never, restore, true);
    expect(px.size).toBe(64 - 9);
    expect(px.has('1,1')).toBe(false);
  });

  it('clips the reported area to the canvas', () => {
    const { ctx, restore } = fakeCtx(8, 8);
    const s = new PixelStroke(4, '#000', 8, 8);
    s.push([0, 0, 1]);
    expect(s.draw(ctx as never, restore, true)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
});
