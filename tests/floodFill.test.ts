import { describe, expect, it } from 'vitest';
import { expandRegion, floodFill, paintRegion } from '../src/core/floodFill';

/** Builds RGBA data from rows of chars: '#' = opaque black, '.' = transparent. */
function img(rows: string[]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') data[(y * w + x) * 4 + 3] = 255;
    }),
  );
  return { data, w, h };
}

function maskRows(mask: Uint8Array, w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let s = '';
    for (let x = 0; x < w; x++) s += mask[y * w + x] === 1 ? 'o' : mask[y * w + x] === 2 ? '+' : '.';
    out.push(s);
  }
  return out;
}

describe('floodFill', () => {
  const shape = img([
    '.......',
    '.#####.',
    '.#...#.',
    '.#...#.',
    '.#####.',
    '.......',
  ]);

  it('fills an enclosed area only', () => {
    const r = floodFill(shape.data, shape.w, shape.h, 3, 3, 0)!;
    expect(maskRows(r.mask, shape.w, shape.h)).toEqual([
      '.......',
      '.......',
      '..ooo..',
      '..ooo..',
      '.......',
      '.......',
    ]);
    expect(r.bounds).toEqual({ x: 2, y: 2, w: 3, h: 2 });
  });

  it('fills the outside around a closed shape', () => {
    const r = floodFill(shape.data, shape.w, shape.h, 0, 0, 0)!;
    const rows = maskRows(r.mask, shape.w, shape.h);
    expect(rows[0]).toBe('ooooooo');
    expect(rows[2]).toBe('o.....o');
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 7, h: 6 });
  });

  it('leaks through a gap', () => {
    const open = img(['#####', '#...#', '#....', '#####']);
    const r = floodFill(open.data, open.w, open.h, 1, 1, 0)!;
    expect(r.mask[2 * 5 + 4]).toBe(1);
  });

  it('respects tolerance on semi-transparent pixels', () => {
    const { data, w, h } = img(['....']);
    data[1 * 4 + 3] = 20; // faint pixel
    data[2 * 4 + 3] = 200; // strong pixel
    expect(floodFill(data, w, h, 0, 0, 0)!.bounds.w).toBe(1);
    expect(floodFill(data, w, h, 0, 0, 30)!.bounds.w).toBe(2);
  });

  it('returns null outside the canvas', () => {
    expect(floodFill(shape.data, shape.w, shape.h, -1, 0, 0)).toBeNull();
    expect(floodFill(shape.data, shape.w, shape.h, 7, 0, 0)).toBeNull();
  });

  it('expands the region into a ring under lines', () => {
    const r = expandRegion(floodFill(shape.data, shape.w, shape.h, 3, 3, 0)!, shape.w, shape.h, 1);
    expect(maskRows(r.mask, shape.w, shape.h)).toEqual([
      '.......',
      '.+++++.',
      '.+ooo+.',
      '.+ooo+.',
      '.+++++.',
      '.......',
    ]);
    expect(r.bounds).toEqual({ x: 1, y: 1, w: 5, h: 4 });
  });

  it('paints the region and keeps line pixels on top in the ring', () => {
    const r = expandRegion(floodFill(shape.data, shape.w, shape.h, 3, 3, 0)!, shape.w, shape.h, 1);
    const target = new Uint8ClampedArray(shape.data);
    const rect = { x: 0, y: 0, w: shape.w, h: shape.h };
    paintRegion(target, rect, r, shape.w, [255, 0, 0]);
    const px = (x: number, y: number) => Array.from(target.slice((y * shape.w + x) * 4, (y * shape.w + x) * 4 + 4));
    expect(px(3, 3)).toEqual([255, 0, 0, 255]); // filled
    expect(px(1, 1)).toEqual([0, 0, 0, 255]); // line stays black
    expect(px(0, 0)).toEqual([0, 0, 0, 0]); // outside untouched
  });
});
