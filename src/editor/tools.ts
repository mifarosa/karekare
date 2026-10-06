import { fillOutline, outlineBounds, strokeOutline, type InputPoint, type StrokeStyle } from '../core/brush';
import { createCanvas, ctx2d, parseColor, toHex } from '../core/canvas';
import { expandRegion, floodFill, paintRegion } from '../core/floodFill';
import { drawFrame } from '../core/render';
import { clip, union } from '../model/rect';
import type { Rect } from '../model/types';
import type { Editor } from './editor';

export interface ToolPoint {
  x: number;
  y: number;
  pressure: number;
  pointerType: string;
}

export interface Tool {
  down(p: ToolPoint): void;
  move(points: ToolPoint[]): void;
  up(p: ToolPoint): void;
  /** Abort and revert the current operation. */
  cancel(): void;
}

/** Shared full-size scratch canvas with fast pixel readback. */
class Scratch {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  get(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = createCanvas(width, height) as HTMLCanvasElement;
      this.context = ctx2d(this.canvas, true) as CanvasRenderingContext2D;
    }
    return { canvas: this.canvas, ctx: this.context! };
  }
}

const scratch = new Scratch();

/** Brush and eraser: draws a perfect-freehand stroke on the live canvas. */
export class StrokeTool implements Tool {
  private points: InputPoint[] = [];
  private active = false;
  private prevBox: Rect | null = null;
  private totalBox: Rect | null = null;
  private raf = 0;
  private style!: StrokeStyle;
  private paint: string | CanvasPattern = '#000';
  private alpha = 1;
  private before!: HTMLCanvasElement;
  private beforeCtx!: CanvasRenderingContext2D;

  constructor(
    private ed: Editor,
    private erase: boolean,
  ) {}

  down(p: ToolPoint): void {
    if (!this.ed.beginEdit()) return;
    const { width, height } = this.ed.project;
    const s = scratch.get(width, height);
    this.before = s.canvas;
    this.beforeCtx = s.ctx;
    this.beforeCtx.clearRect(0, 0, width, height);
    this.beforeCtx.drawImage(this.ed.liveCanvas, 0, 0);

    const pen = p.pointerType === 'pen';
    if (this.erase) {
      this.style = { kind: 'eraser', size: this.ed.eraser.size, smoothing: 0.3, pressure: false };
      this.alpha = 1;
      this.paint = '#000';
    } else {
      const b = this.ed.brush;
      this.style = { kind: b.kind, size: b.size, smoothing: b.smoothing, pressure: pen };
      this.alpha = b.opacity;
      this.paint = b.kind === 'pencil' ? pencilPattern(this.ed.liveCtx, this.ed.color) : this.ed.color;
    }
    this.points = [toInput(p)];
    this.prevBox = null;
    this.totalBox = null;
    this.active = true;
    this.render(false);
  }

  move(points: ToolPoint[]): void {
    if (!this.active) return;
    for (const p of points) this.points.push(toInput(p));
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render(false));
  }

  up(p: ToolPoint): void {
    if (!this.active) return;
    const last = this.points[this.points.length - 1];
    if (!last || last[0] !== p.x || last[1] !== p.y) this.points.push(toInput(p));
    this.render(true);
    this.active = false;
    const rect = this.totalBox;
    if (!rect) {
      this.ed.endEdit();
      return;
    }
    const before = this.beforeCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const after = this.ed.liveCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    this.ed.endEdit();
    this.ed.liveChanged(this.erase ? null : rect);
    this.ed.pushPatch(rect, before, after);
  }

  cancel(): void {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.active = false;
    const r = this.totalBox;
    if (r) {
      const ctx = this.ed.liveCtx;
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(this.before, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    this.ed.endEdit();
  }

  private render(last: boolean): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.active) return;
    const { width, height } = this.ed.project;
    const outline = strokeOutline(this.points, this.style, last);
    const box = outlineBounds(outline, 2);
    const boxClip = box ? clip(box, width, height) : null;
    const dirty = union(boxClip, this.prevBox);
    if (!dirty) return;
    const ctx = this.ed.liveCtx;
    ctx.save();
    ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
    ctx.drawImage(this.before, dirty.x, dirty.y, dirty.w, dirty.h, dirty.x, dirty.y, dirty.w, dirty.h);
    ctx.beginPath();
    ctx.rect(dirty.x, dirty.y, dirty.w, dirty.h);
    ctx.clip();
    ctx.globalAlpha = this.alpha;
    ctx.globalCompositeOperation = this.erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = this.paint;
    fillOutline(ctx, outline);
    ctx.restore();
    this.prevBox = boxClip;
    this.totalBox = union(this.totalBox, dirty);
  }
}

function toInput(p: ToolPoint): InputPoint {
  // Pens report 0 right at touch-down; start thin rather than with a blob.
  const pressure = p.pointerType === 'pen' ? Math.max(0.05, p.pressure) : 0.5;
  return [p.x, p.y, pressure];
}

const patterns = new Map<string, CanvasPattern>();

/** Grainy fill that makes strokes look like pencil on paper. */
function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  let pat = patterns.get(color);
  if (pat) return pat;
  const size = 64;
  const c = createCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const [r, gr, b] = parseColor(color);
  // Deterministic noise so the texture does not change between strokes.
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < size * size; i++) {
    const n = rand();
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gr;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = n < 0.18 ? 40 : 150 + Math.floor(rand() * 105);
  }
  g.putImageData(img, 0, 0);
  const created = ctx.createPattern(c as HTMLCanvasElement, 'repeat');
  if (!created) return color;
  if (patterns.size > 32) patterns.clear();
  patterns.set(color, created);
  return created;
}

/** Bucket fill. */
export class FillTool implements Tool {
  constructor(private ed: Editor) {}

  down(p: ToolPoint): void {
    const ed = this.ed;
    const { width, height } = ed.project;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (!ed.beginEdit()) return;
    try {
      let sample: ImageData;
      if (ed.fill.sampleAll) {
        const s = scratch.get(width, height);
        s.ctx.clearRect(0, 0, width, height);
        drawFrame(s.ctx, ed.project, ed.frame, ed.store);
        sample = s.ctx.getImageData(0, 0, width, height);
      } else {
        sample = ed.liveCtx.getImageData(0, 0, width, height);
      }
      const tolerance = (ed.fill.tolerance / 100) * 255;
      let region = floodFill(sample.data, width, height, x, y, tolerance);
      if (!region) return;
      if (ed.fill.expand > 0) region = expandRegion(region, width, height, ed.fill.expand);
      const rect = region.bounds;
      const target = ed.liveCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
      const before = new ImageData(new Uint8ClampedArray(target.data), rect.w, rect.h);
      paintRegion(target.data, rect, region, width, parseColor(ed.color));
      ed.liveCtx.putImageData(target, rect.x, rect.y);
      ed.liveChanged(rect);
      ed.pushPatch(rect, before, target);
    } finally {
      ed.endEdit();
    }
  }

  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** Picks a color from the composited frame. */
export class EyedropperTool implements Tool {
  private canvas = createCanvas(1, 1);
  private ctx = ctx2d(this.canvas, true);
  private active = false;

  constructor(
    private ed: Editor,
    private onPick: (color: string, final: boolean) => void,
  ) {}

  down(p: ToolPoint): void {
    this.active = true;
    this.pick(p, false);
  }

  move(points: ToolPoint[]): void {
    if (this.active && points.length) this.pick(points[points.length - 1], false);
  }

  up(p: ToolPoint): void {
    if (!this.active) return;
    this.active = false;
    this.pick(p, true);
  }

  cancel(): void {
    this.active = false;
  }

  private pick(p: ToolPoint, final: boolean): void {
    const { width, height } = this.ed.project;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, -x, -y);
    drawFrame(ctx, this.ed.project, this.ed.frame, this.ed.store, { background: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    this.onPick(toHex(d[0], d[1], d[2]), final);
  }
}

/** Placeholder; panning is handled by the stage. */
export class HandTool implements Tool {
  down(): void {}
  move(): void {}
  up(): void {}
  cancel(): void {}
}
