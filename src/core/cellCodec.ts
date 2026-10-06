import { alphaBounds } from '../model/rect';
import type { Rect } from '../model/types';
import { canvasToBlob, createCanvas, ctx2d } from './canvas';

export interface EncodeResult {
  blob: Blob | null;
  rect: Rect | null;
}

/**
 * Crops `src` (whose top-left sits at `rect.x, rect.y` in project space) to its
 * non-transparent pixels and encodes the result as PNG.
 */
export async function trimAndEncode(src: CanvasImageSource, rect: Rect): Promise<EncodeResult> {
  const c = createCanvas(rect.w, rect.h);
  const ctx = ctx2d(c, true);
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, rect.w, rect.h).data;
  const b = alphaBounds(data, rect.w, rect.h);
  if (!b) return { blob: null, rect: null };
  let out = c;
  if (b.w !== rect.w || b.h !== rect.h) {
    out = createCanvas(b.w, b.h);
    ctx2d(out).drawImage(c, -b.x, -b.y);
  }
  const blob = await canvasToBlob(out, 'image/png');
  return { blob, rect: { x: rect.x + b.x, y: rect.y + b.y, w: b.w, h: b.h } };
}
