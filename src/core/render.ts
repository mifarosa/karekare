import type { Frame, Project } from '../model/types';
import type { Ctx2D } from './canvas';
import type { CellStore } from './cellStore';

export interface DrawFrameOptions {
  /** Draw only layers in [from, to) (indices into project.layers). */
  from?: number;
  to?: number;
  /** Fill with the project background first. */
  background?: boolean;
}

/**
 * Composites a frame's visible layers into `ctx` (in project coordinates).
 * Returns false when some cell was not decoded and got skipped.
 */
export function drawFrame(ctx: Ctx2D, project: Project, frame: Frame, store: CellStore, opts: DrawFrameOptions = {}): boolean {
  const from = opts.from ?? 0;
  const to = opts.to ?? project.layers.length;
  if (opts.background) {
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  let complete = true;
  for (let i = from; i < to; i++) {
    const layer = project.layers[i];
    if (!layer.visible || layer.opacity <= 0) continue;
    const cell = frame.cells[layer.id];
    if (!cell) continue;
    const s = store.source(cell);
    if (!s) {
      if (!store.isReady(cell)) complete = false;
      continue;
    }
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(s.src, s.rect.x, s.rect.y);
  }
  ctx.globalAlpha = 1;
  return complete;
}
