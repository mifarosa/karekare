import type { InputPoint } from '../core/brush';
import { brushDef, createStroke, type BrushStroke } from '../core/brushes';
import { createCanvas, ctx2d, parseColor, toHex } from '../core/canvas';
import { expandRegion, floodFill, paintRegion } from '../core/floodFill';
import { drawFrame } from '../core/render';
import { union } from '../model/rect';
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

/** Brush and eraser: draws a stroke of the current brush on the live canvas. */
export class StrokeTool implements Tool {
  private stroke: BrushStroke | null = null;
  private active = false;
  private continuous = false;
  private totalBox: Rect | null = null;
  private raf = 0;
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

    const seed = (Math.random() * 0xffffffff) >>> 0;
    const b = this.ed.brush;
    this.stroke = createStroke(
      this.erase
        ? { kind: 'eraser', color: '#000', size: this.ed.eraser.size, opacity: 1, smoothing: 0.3, pressure: false, width, height, seed }
        : {
            kind: b.kind,
            color: this.ed.color,
            size: b.size,
            opacity: b.opacity,
            smoothing: b.smoothing,
            pressure: p.pointerType === 'pen',
            width,
            height,
            seed,
          },
      this.ed.liveCtx,
    );
    this.continuous = !this.erase && !!brushDef(b.kind).continuous;
    this.stroke.push(toInput(p));
    this.totalBox = null;
    this.active = true;
    this.render(false);
  }

  move(points: ToolPoint[]): void {
    if (!this.active) return;
    for (const p of points) this.stroke!.push(toInput(p));
    this.schedule();
  }

  up(p: ToolPoint): void {
    if (!this.active) return;
    this.stroke!.push(toInput(p));
    this.render(true);
    this.active = false;
    this.stroke = null;
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
    this.stroke = null;
    if (this.totalBox) this.restore(this.totalBox);
    this.ed.endEdit();
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render(false));
  }

  private restore = (r: Rect): void => {
    const ctx = this.ed.liveCtx;
    ctx.clearRect(r.x, r.y, r.w, r.h);
    ctx.drawImage(this.before, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  };

  private render(last: boolean): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.active || !this.stroke) return;
    const changed = this.stroke.draw(this.ed.liveCtx, this.restore, last);
    this.totalBox = union(this.totalBox, changed);
    // Spray keeps painting while the pen rests.
    if (this.continuous && !last) this.schedule();
  }
}

function toInput(p: ToolPoint): InputPoint {
  // Pens report 0 right at touch-down; start thin rather than with a blob.
  const pressure = p.pointerType === 'pen' ? Math.max(0.05, p.pressure) : 0.5;
  return [p.x, p.y, pressure];
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
