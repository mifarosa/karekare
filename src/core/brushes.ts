import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { clip, union } from '../model/rect';
import type { Rect } from '../model/types';
import { fillOutline, outlineBounds, type InputPoint } from './brush';
import { createCanvas, ctx2d, parseColor, type Ctx2D } from './canvas';

export type BrushKind =
  | 'pen'
  | 'pencil'
  | 'marker'
  | 'paint'
  | 'highlighter'
  | 'crayon'
  | 'chalk'
  | 'neon'
  | 'calligraphy'
  | 'spray'
  | 'rainbow'
  | 'dots'
  | 'stars'
  | 'hearts'
  | 'bubbles'
  | 'confetti';

export interface BrushDef {
  kind: BrushKind;
  /** Default size and opacity when the brush is picked for the first time. */
  size: number;
  opacity: number;
  maxSize: number;
  /** Keeps painting while the pointer is held still (spray). */
  continuous?: boolean;
}

/** All brushes, in picker order. */
export const BRUSHES: BrushDef[] = [
  { kind: 'pen', size: 6, opacity: 1, maxSize: 120 },
  { kind: 'pencil', size: 4, opacity: 1, maxSize: 60 },
  { kind: 'marker', size: 12, opacity: 1, maxSize: 120 },
  { kind: 'paint', size: 18, opacity: 1, maxSize: 150 },
  { kind: 'highlighter', size: 28, opacity: 0.4, maxSize: 120 },
  { kind: 'crayon', size: 14, opacity: 1, maxSize: 100 },
  { kind: 'chalk', size: 16, opacity: 1, maxSize: 100 },
  { kind: 'neon', size: 10, opacity: 1, maxSize: 80 },
  { kind: 'calligraphy', size: 18, opacity: 1, maxSize: 100 },
  { kind: 'spray', size: 50, opacity: 1, maxSize: 200, continuous: true },
  { kind: 'rainbow', size: 14, opacity: 1, maxSize: 120 },
  { kind: 'dots', size: 10, opacity: 1, maxSize: 80 },
  { kind: 'stars', size: 30, opacity: 1, maxSize: 150 },
  { kind: 'hearts', size: 30, opacity: 1, maxSize: 150 },
  { kind: 'bubbles', size: 40, opacity: 1, maxSize: 200 },
  { kind: 'confetti', size: 40, opacity: 1, maxSize: 200 },
];

export function brushDef(kind: string): BrushDef {
  return BRUSHES.find((b) => b.kind === kind) ?? BRUSHES[0];
}

export function isBrushKind(kind: unknown): kind is BrushKind {
  return BRUSHES.some((b) => b.kind === kind);
}

export interface StrokeParams {
  kind: BrushKind | 'eraser';
  color: string;
  size: number;
  /** 0..1 */
  opacity: number;
  /** 0..1, how strongly input is smoothed. */
  smoothing: number;
  /** Real pen pressure is available. */
  pressure: boolean;
  /** Canvas size, for clipping changed areas. */
  width: number;
  height: number;
  /** Seed for brushes with randomness, so a stroke can be reproduced. */
  seed: number;
}

/** One stroke in progress. */
export interface BrushStroke {
  push(p: InputPoint): void;
  /**
   * Draws onto `ctx` and returns the area this call changed (or null).
   * Brushes that redraw the whole stroke call `restore` first to put back
   * the pixels from before the stroke.
   */
  draw(ctx: Ctx2D, restore: (r: Rect) => void, last: boolean): Rect | null;
}

/** `ctx` is only used to create fill patterns. */
export function createStroke(p: StrokeParams, ctx: Ctx2D): BrushStroke {
  switch (p.kind) {
    case 'calligraphy':
      return new CalligraphyStroke(p);
    case 'spray':
      return new SprayStroke(p);
    case 'rainbow':
      return new RainbowStroke(p);
    case 'dots':
      return new DotsStroke(p);
    case 'stars':
      return new ShapeStroke(p, 'star');
    case 'hearts':
      return new ShapeStroke(p, 'heart');
    case 'bubbles':
      return new BubbleStroke(p);
    case 'confetti':
      return new ConfettiStroke(p);
    default:
      return new OutlineStroke(p, outlineLook(p, ctx));
  }
}

// ---------------------------------------------------------------------------
// Outline brushes: perfect-freehand polygon, redrawn as a whole every frame
// (so semi-transparent strokes never darken where they cross themselves).

interface OutlineLook {
  options: StrokeOptions;
  paint: string | CanvasPattern;
  composite: GlobalCompositeOperation;
  /** Extra pixels around the outline that the look can touch. */
  pad: number;
  glow?: number;
  core?: { scale: number; color: string; alpha: number };
}

function outlineLook(p: StrokeParams, ctx: Ctx2D): OutlineLook {
  const base: StrokeOptions = {
    size: p.size,
    smoothing: 0.5,
    streamline: 0.15 + p.smoothing * 0.75,
    simulatePressure: !p.pressure,
  };
  const look = (options: StrokeOptions, extra: Partial<OutlineLook> = {}): OutlineLook => ({
    options: { ...base, ...options },
    paint: p.color,
    composite: 'source-over',
    pad: 2,
    ...extra,
  });
  switch (p.kind) {
    case 'eraser':
      return look({ thinning: 0, simulatePressure: false }, { paint: '#000', composite: 'destination-out' });
    case 'pencil':
      return look({ thinning: p.pressure ? 0.35 : 0.15, smoothing: 0.35 }, { paint: texturePattern(ctx, 'pencil', p.color) });
    case 'marker':
      return look({ thinning: 0, simulatePressure: false });
    case 'paint':
      return look({
        thinning: p.pressure ? 0.75 : 0.55,
        smoothing: 0.65,
        start: { taper: p.size * 2.5 },
        end: { taper: p.size * 2.5 },
      });
    case 'highlighter':
      return look({ thinning: 0, simulatePressure: false, start: { cap: false }, end: { cap: false } });
    case 'crayon':
      return look({ thinning: p.pressure ? 0.3 : 0.1, smoothing: 0.4 }, { paint: texturePattern(ctx, 'crayon', p.color) });
    case 'chalk':
      return look({ thinning: 0.1, smoothing: 0.3 }, { paint: texturePattern(ctx, 'chalk', p.color) });
    case 'neon':
      return look(
        { thinning: p.pressure ? 0.3 : 0.15 },
        { glow: p.size * 1.2, pad: p.size * 1.8 + 4, core: { scale: 0.35, color: '#ffffff', alpha: 0.85 } },
      );
    default:
      return look({
        thinning: p.pressure ? 0.65 : 0.45,
        easing: (t) => t,
        start: { taper: 0, cap: true },
        end: { taper: 0, cap: true },
      });
  }
}

class OutlineStroke implements BrushStroke {
  private points: InputPoint[] = [];
  private prevBox: Rect | null = null;

  constructor(
    private p: StrokeParams,
    private look: OutlineLook,
  ) {}

  push(pt: InputPoint): void {
    this.points.push(pt);
  }

  draw(ctx: Ctx2D, restore: (r: Rect) => void, last: boolean): Rect | null {
    const { p, look } = this;
    const outline = getStroke(this.points, { ...look.options, last });
    const raw = outlineBounds(outline, look.pad);
    const box = raw ? clip(raw, p.width, p.height) : null;
    const dirty = union(box, this.prevBox);
    if (!dirty) return null;
    restore(dirty);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dirty.x, dirty.y, dirty.w, dirty.h);
    ctx.clip();
    ctx.globalAlpha = p.opacity;
    ctx.globalCompositeOperation = look.composite;
    if (look.glow) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = look.glow;
    }
    ctx.fillStyle = look.paint;
    fillOutline(ctx, outline);
    if (look.core) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = p.opacity * look.core.alpha;
      ctx.fillStyle = look.core.color;
      const size = (look.options.size ?? p.size) * look.core.scale;
      fillOutline(ctx, getStroke(this.points, { ...look.options, size, last }));
    }
    ctx.restore();
    this.prevBox = box;
    return dirty;
  }
}

// ---------------------------------------------------------------------------
// Path brushes: follow a smoothed path and add marks incrementally.

abstract class PathStroke implements BrushStroke {
  private raw: InputPoint[] = [];
  private next = 0;
  private started = false;
  private carry = 0;
  protected x = 0;
  protected y = 0;
  protected pr = 0.5;
  /** Distance travelled along the path. */
  protected dist = 0;
  protected rand: () => number;
  private changed: Rect | null = null;

  constructor(protected p: StrokeParams) {
    this.rand = mulberry32(p.seed);
  }

  push(pt: InputPoint): void {
    this.raw.push(pt);
  }

  draw(ctx: Ctx2D, _restore: (r: Rect) => void, last: boolean): Rect | null {
    this.changed = null;
    ctx.save();
    ctx.globalAlpha = this.p.opacity;
    ctx.globalCompositeOperation = 'source-over';
    const k = 1 - Math.min(0.85, this.p.smoothing * 0.85);
    while (this.next < this.raw.length) {
      const [x, y, pr] = this.raw[this.next++];
      if (!this.started) {
        this.started = true;
        this.x = x;
        this.y = y;
        this.pr = pr;
        this.begin(ctx);
        continue;
      }
      this.moveTo(ctx, this.x + (x - this.x) * k, this.y + (y - this.y) * k, this.pr + (pr - this.pr) * k);
    }
    // Smoothing lags behind the pen; catch up at the end of the stroke.
    const end = this.raw[this.raw.length - 1];
    if (last && end && Math.hypot(end[0] - this.x, end[1] - this.y) > 0.5) this.moveTo(ctx, end[0], end[1], end[2]);
    if (this.started && !last) this.tick(ctx);
    ctx.restore();
    return this.changed ? clip(this.changed, this.p.width, this.p.height) : null;
  }

  private moveTo(ctx: Ctx2D, x: number, y: number, pr: number): void {
    const x0 = this.x;
    const y0 = this.y;
    const p0 = this.pr;
    const len = Math.hypot(x - x0, y - y0);
    if (len < 0.01) return;
    this.segment(ctx, x0, y0, p0, x, y, pr, len);
    this.x = x;
    this.y = y;
    this.pr = pr;
    this.dist += len;
  }

  /** Default: evenly spaced dabs along the segment. */
  protected segment(ctx: Ctx2D, x0: number, y0: number, p0: number, x1: number, y1: number, p1: number, len: number): void {
    const step = Math.max(1, this.spacing());
    let at = step - this.carry;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    while (at <= len) {
      const t = at / len;
      this.dab(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t, angle);
      at += step;
    }
    this.carry = len - (at - step);
  }

  /** First touch. */
  protected begin(ctx: Ctx2D): void {
    this.dab(ctx, this.x, this.y, this.pr, 0);
  }

  /** Called once per frame while the stroke is active. */
  protected tick(_ctx: Ctx2D): void {}

  protected spacing(): number {
    return this.p.size;
  }

  protected abstract dab(ctx: Ctx2D, x: number, y: number, pr: number, angle: number): void;

  /** Brush size, thinner under light pen pressure. */
  protected widthAt(pr: number): number {
    return this.p.pressure ? this.p.size * (0.25 + 0.75 * pr) : this.p.size;
  }

  protected mark(x: number, y: number, r: number): void {
    this.changed = union(this.changed, { x: x - r, y: y - r, w: r * 2, h: r * 2 });
  }
}

class DotsStroke extends PathStroke {
  protected override spacing(): number {
    return this.p.size * 1.7;
  }

  protected dab(ctx: Ctx2D, x: number, y: number, pr: number): void {
    const r = this.widthAt(pr) / 2;
    ctx.fillStyle = this.p.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    this.mark(x, y, r + 1);
  }
}

class ShapeStroke extends PathStroke {
  constructor(
    p: StrokeParams,
    private shape: 'star' | 'heart',
  ) {
    super(p);
  }

  protected override spacing(): number {
    return this.p.size * 1.15;
  }

  protected dab(ctx: Ctx2D, x: number, y: number, pr: number, angle: number): void {
    const size = this.widthAt(pr);
    const r = size * (0.32 + 0.3 * this.rand());
    // Scatter sideways a little so the trail looks playful.
    const off = (this.rand() - 0.5) * size * 0.6;
    const cx = x - Math.sin(angle) * off;
    const cy = y + Math.cos(angle) * off;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.shape === 'star' ? this.rand() * Math.PI * 2 : (this.rand() - 0.5) * 0.7);
    ctx.fillStyle = this.p.color;
    ctx.beginPath();
    if (this.shape === 'star') starPath(ctx, r);
    else heartPath(ctx, r);
    ctx.fill();
    ctx.restore();
    this.mark(cx, cy, r * 1.3 + 1);
  }
}

class BubbleStroke extends PathStroke {
  protected override spacing(): number {
    return this.p.size * 0.75;
  }

  protected dab(ctx: Ctx2D, x: number, y: number, pr: number, angle: number): void {
    const size = this.widthAt(pr);
    const r = size * (0.12 + 0.25 * this.rand());
    const off = (this.rand() - 0.5) * size;
    const cx = x - Math.sin(angle) * off;
    const cy = y + Math.cos(angle) * off;
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * 0.15;
    ctx.fillStyle = this.p.color;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = this.p.color;
    ctx.stroke();
    // Shine
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, Math.PI * 1.1, Math.PI * 1.45);
    ctx.lineWidth = Math.max(1.2, r * 0.12);
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.stroke();
    this.mark(cx, cy, r + ctx.lineWidth + 1);
  }
}

const CONFETTI_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#00a2c7', '#3e63dd', '#8e4ec6', '#d6409f'];

class ConfettiStroke extends PathStroke {
  protected override spacing(): number {
    return this.p.size * 0.4;
  }

  protected dab(ctx: Ctx2D, x: number, y: number, pr: number, angle: number): void {
    const size = this.widthAt(pr);
    const w = size * (0.18 + 0.14 * this.rand());
    const hgt = w * (0.4 + 0.3 * this.rand());
    const off = (this.rand() - 0.5) * size * 1.2;
    const cx = x - Math.sin(angle) * off;
    const cy = y + Math.cos(angle) * off;
    const pick = this.rand() < 0.2 ? this.p.color : CONFETTI_COLORS[Math.floor(this.rand() * CONFETTI_COLORS.length)];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rand() * Math.PI);
    ctx.fillStyle = pick;
    ctx.fillRect(-w / 2, -hgt / 2, w, hgt);
    ctx.restore();
    this.mark(cx, cy, w + 1);
  }
}

class SprayStroke extends PathStroke {
  protected override begin(ctx: Ctx2D): void {
    this.spray(ctx, this.x, this.y, Math.ceil(this.p.size * 0.6));
  }

  protected override segment(ctx: Ctx2D, x0: number, y0: number, _p0: number, x1: number, y1: number, _p1: number, len: number): void {
    const count = Math.ceil(len * this.p.size * 0.05);
    for (let i = 0; i < count; i++) {
      const t = this.rand();
      this.spray(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1);
    }
  }

  /** Holding still keeps spraying, like a real can. */
  protected override tick(ctx: Ctx2D): void {
    this.spray(ctx, this.x, this.y, Math.ceil(this.p.size * 0.25));
  }

  protected dab(): void {}

  private spray(ctx: Ctx2D, x: number, y: number, count: number): void {
    const radius = this.widthAt(this.pr) / 2;
    const dot = Math.max(0.8, this.p.size / 70);
    ctx.fillStyle = this.p.color;
    for (let i = 0; i < count; i++) {
      // Denser towards the middle.
      const r = Math.pow(this.rand(), 0.7) * radius;
      const a = this.rand() * Math.PI * 2;
      const d = dot * (0.6 + this.rand() * 0.9);
      ctx.fillRect(x + Math.cos(a) * r - d / 2, y + Math.sin(a) * r - d / 2, d, d);
    }
    this.mark(x, y, radius + dot * 2);
  }
}

class RainbowStroke extends PathStroke {
  protected override begin(ctx: Ctx2D): void {
    const r = this.widthAt(this.pr) / 2;
    ctx.fillStyle = this.hue(0);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    this.mark(this.x, this.y, r + 1);
  }

  protected override segment(ctx: Ctx2D, x0: number, y0: number, p0: number, x1: number, y1: number, p1: number): void {
    const w = this.widthAt((p0 + p1) / 2);
    ctx.lineCap = 'round';
    ctx.lineWidth = w;
    ctx.strokeStyle = this.hue(this.dist);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    this.mark(x0, y0, w / 2 + 1);
    this.mark(x1, y1, w / 2 + 1);
  }

  protected dab(): void {}

  private hue(distance: number): string {
    const h = ((distance / (this.p.size * 12)) * 360) % 360;
    return `hsl(${Math.round(h)}, 95%, 55%)`;
  }
}

/** Flat nib held at 45°: thick on one diagonal, thin on the other. */
class CalligraphyStroke extends PathStroke {
  private static readonly NIB = -Math.PI / 4;

  protected override begin(ctx: Ctx2D): void {
    this.quad(ctx, this.x, this.y, this.pr, this.x, this.y, this.pr);
  }

  protected override segment(ctx: Ctx2D, x0: number, y0: number, p0: number, x1: number, y1: number, p1: number): void {
    this.quad(ctx, x0, y0, p0, x1, y1, p1);
  }

  protected dab(): void {}

  private quad(ctx: Ctx2D, x0: number, y0: number, p0: number, x1: number, y1: number, p1: number): void {
    const cos = Math.cos(CalligraphyStroke.NIB);
    const sin = Math.sin(CalligraphyStroke.NIB);
    const h0 = this.widthAt(p0) / 2;
    const h1 = this.widthAt(p1) / 2;
    ctx.fillStyle = ctx.strokeStyle = this.p.color;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, this.p.size * 0.08);
    ctx.beginPath();
    ctx.moveTo(x0 + cos * h0, y0 + sin * h0);
    ctx.lineTo(x1 + cos * h1, y1 + sin * h1);
    ctx.lineTo(x1 - cos * h1, y1 - sin * h1);
    ctx.lineTo(x0 - cos * h0, y0 - sin * h0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const r = Math.max(h0, h1) + ctx.lineWidth;
    this.mark(x0, y0, r);
    this.mark(x1, y1, r);
  }
}

// ---------------------------------------------------------------------------
// Shapes, textures, randomness

function starPath(ctx: Ctx2D, r: number): void {
  const inner = r * 0.45;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
}

function heartPath(ctx: Ctx2D, r: number): void {
  const s = r / 16;
  ctx.moveTo(0, 13 * s);
  ctx.bezierCurveTo(-16 * s, 2 * s, -14 * s, -14 * s, 0, -6 * s);
  ctx.bezierCurveTo(14 * s, -14 * s, 16 * s, 2 * s, 0, 13 * s);
  ctx.closePath();
}

/** Small, fast seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Texture = 'pencil' | 'crayon' | 'chalk';
const patterns = new Map<string, CanvasPattern>();

/**
 * Grainy fills that make strokes look like pencil, wax crayon or chalk on
 * paper. Patterns are anchored to the canvas, so the grain stays put.
 */
function texturePattern(ctx: Ctx2D, texture: Texture, color: string): CanvasPattern | string {
  const key = `${texture}|${color}`;
  const cached = patterns.get(key);
  if (cached) return cached;
  const size = texture === 'crayon' ? 96 : 64;
  const c = createCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const [r, gr, b] = parseColor(color);
  // Deterministic noise so the texture does not change between strokes.
  const rand = mulberry32(texture.length * 7919);
  const streak = new Float32Array(size).map(() => rand());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = rand();
      let alpha: number;
      if (texture === 'pencil') alpha = n < 0.18 ? 40 : 150 + Math.floor(rand() * 105);
      // Wax skips over the paper's tooth in horizontal streaks.
      else if (texture === 'crayon') alpha = n < 0.12 + streak[y] * 0.3 ? 0 : 170 + Math.floor(rand() * 85);
      else alpha = n < 0.42 ? 0 : 110 + Math.floor(rand() * 110);
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = alpha;
    }
  }
  g.putImageData(img, 0, 0);
  const created = ctx.createPattern(c, 'repeat');
  if (!created) return color;
  if (patterns.size > 48) patterns.clear();
  patterns.set(key, created);
  return created;
}
