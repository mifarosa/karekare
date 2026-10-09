import { canvasToBlob, createCanvas, ctx2d, releaseCanvas } from '../core/canvas';
import { uid } from '../model/ids';
import { newCell } from '../model/project';
import { clip } from '../model/rect';
import type { Frame } from '../model/types';
import { fitRect, type FitMode } from './placement';

export const MAX_PHOTO_FRAMES = 300;

/**
 * Turns photos into frames whose `layerId` cell holds the photo, filling the
 * canvas or fitting inside it. Cells are encoded right away so a large batch
 * does not keep many full-size canvases in memory.
 */
export async function photosToFrames(
  files: Blob[],
  size: { width: number; height: number },
  layerId: string,
  mode: FitMode,
  onProgress: (done: number, total: number) => void,
): Promise<{ frames: Frame[]; failed: number }> {
  const { width, height } = size;
  const frames: Frame[] = [];
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const bmp = await createImageBitmap(files[i]);
      const fit = fitRect(bmp.width, bmp.height, width, height, mode);
      const rect = clip(fit, width, height);
      if (!rect) throw new Error('Empty image');
      const c = createCanvas(rect.w, rect.h);
      const ctx = ctx2d(c);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, fit.x - rect.x, fit.y - rect.y, fit.w, fit.h);
      bmp.close();
      const blob = await canvasToBlob(c, 'image/png');
      releaseCanvas(c);
      const cell = newCell();
      cell.enc = { blob, rect, version: cell.version };
      frames.push({ id: uid(), hold: 1, cells: { [layerId]: cell } });
    } catch (err) {
      console.warn('Photo import failed', err);
      failed++;
    }
    onProgress(i + 1, files.length);
  }
  return { frames, failed };
}
