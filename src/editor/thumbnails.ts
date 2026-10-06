import { createCanvas, ctx2d } from '../core/canvas';
import { drawFrame } from '../core/render';
import { visibleCells } from '../model/project';
import type { Frame } from '../model/types';
import type { Editor } from './editor';

interface Entry {
  canvas: HTMLCanvasElement;
  key: string;
}

/** Small composited previews of frames for the timeline. */
export class Thumbnails {
  private cache = new Map<string, Entry>();
  private queue = new Set<string>();
  private running = false;
  readonly width: number;
  readonly height: number;

  constructor(
    private ed: Editor,
    cssHeight: number,
  ) {
    const p = ed.project;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.height = Math.round(cssHeight * dpr);
    this.width = Math.max(1, Math.round((this.height * p.width) / p.height));
  }

  /** Canvas element showing `frame`; refreshed in the background when stale. */
  get(frame: Frame): HTMLCanvasElement {
    let e = this.cache.get(frame.id);
    if (!e) {
      const canvas = createCanvas(this.width, this.height) as HTMLCanvasElement;
      canvas.className = 'thumb';
      e = { canvas, key: '' };
      this.cache.set(frame.id, e);
    }
    if (e.key !== this.keyOf(frame)) this.request(frame.id);
    return e.canvas;
  }

  invalidate(frameId?: string): void {
    if (frameId) {
      this.request(frameId);
      return;
    }
    for (const f of this.ed.project.frames) this.request(f.id);
  }

  private keyOf(frame: Frame): string {
    const p = this.ed.project;
    const parts = [p.background];
    for (const { cell, layer } of visibleCells(p, frame)) parts.push(`${cell.id}.${cell.version}.${layer.opacity}`);
    return parts.join('|');
  }

  private request(frameId: string): void {
    this.queue.add(frameId);
    if (!this.running) {
      this.running = true;
      setTimeout(() => void this.process(), 30);
    }
  }

  private async process(): Promise<void> {
    const ed = this.ed;
    try {
      while (this.queue.size) {
        // The current frame first, then in order.
        const current = ed.frame.id;
        const id = this.queue.has(current) ? current : this.queue.values().next().value!;
        this.queue.delete(id);
        const frame = ed.project.frames.find((f) => f.id === id);
        const e = this.cache.get(id);
        if (!frame || !e) continue;
        const key = this.keyOf(frame);
        if (key === e.key) continue;
        await ed.store.ensure(visibleCells(ed.project, frame).map((c) => c.cell));
        const ctx = ctx2d(e.canvas);
        ctx.imageSmoothingQuality = 'high';
        const s = this.width / ed.project.width;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        const complete = drawFrame(ctx, ed.project, frame, ed.store, { background: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        e.key = complete ? key : '';
        // Yield so drawing stays responsive.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.running = false;
    }
  }

  prune(): void {
    const ids = new Set(this.ed.project.frames.map((f) => f.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
  }
}
