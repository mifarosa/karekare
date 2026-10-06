import { describe, expect, it } from 'vitest';
import { frameAtTick, frameStartTick, newFrame, totalTicks } from '../src/model/project';
import { alphaBounds, clip, union } from '../src/model/rect';

describe('timeline math', () => {
  const frames = [newFrame(1), newFrame(3), newFrame(2)];

  it('sums holds', () => {
    expect(totalTicks(frames)).toBe(6);
    expect(frameStartTick(frames, 0)).toBe(0);
    expect(frameStartTick(frames, 2)).toBe(4);
  });

  it('maps ticks to frames', () => {
    expect([0, 1, 2, 3, 4, 5].map((t) => frameAtTick(frames, t))).toEqual([0, 1, 1, 1, 2, 2]);
    expect(frameAtTick(frames, 99)).toBe(2);
    expect(frameAtTick([], 0)).toBe(-1);
  });
});

describe('rect helpers', () => {
  it('unions and clips', () => {
    expect(union({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 1, w: 1, h: 4 })).toEqual({ x: 0, y: 0, w: 6, h: 5 });
    expect(union(null, null)).toBeNull();
    expect(clip({ x: -3.5, y: 2.2, w: 10, h: 3 }, 5, 4)).toEqual({ x: 0, y: 2, w: 5, h: 2 });
    expect(clip({ x: 10, y: 0, w: 2, h: 2 }, 5, 5)).toBeNull();
  });

  it('finds alpha bounds', () => {
    const w = 5;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    expect(alphaBounds(data, w, h)).toBeNull();
    data[(1 * w + 1) * 4 + 3] = 1;
    data[(2 * w + 3) * 4 + 3] = 255;
    expect(alphaBounds(data, w, h)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });
});
