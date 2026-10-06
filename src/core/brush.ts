import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { Rect } from '../model/types';
import type { Ctx2D } from './canvas';

export type BrushKind = 'pen' | 'marker' | 'pencil';

export interface StrokeStyle {
  kind: BrushKind | 'eraser';
  size: number;
  /** 0..1, how strongly input is smoothed. */
  smoothing: number;
  /** Real pen pressure is available. */
  pressure: boolean;
}

/** [x, y, pressure] */
export type InputPoint = [number, number, number];

export function strokeOptions(style: StrokeStyle, last: boolean): StrokeOptions {
  const streamline = 0.15 + style.smoothing * 0.75;
  const base: StrokeOptions = {
    size: style.size,
    smoothing: 0.5,
    streamline,
    last,
    simulatePressure: !style.pressure,
  };
  switch (style.kind) {
    case 'pen':
      return {
        ...base,
        thinning: style.pressure ? 0.65 : 0.45,
        easing: (t) => t,
        start: { taper: 0, cap: true },
        end: { taper: 0, cap: true },
      };
    case 'pencil':
      return { ...base, thinning: style.pressure ? 0.35 : 0.15, smoothing: 0.35 };
    case 'marker':
    case 'eraser':
      return { ...base, thinning: 0, simulatePressure: false };
  }
}

/** Outline polygon of a stroke as [x, y] points. */
export function strokeOutline(points: InputPoint[], style: StrokeStyle, last: boolean): number[][] {
  if (points.length === 0) return [];
  return getStroke(points, strokeOptions(style, last));
}

/** Fills a perfect-freehand outline using quadratic curves through midpoints. */
export function fillOutline(ctx: Ctx2D, outline: number[][]): void {
  const n = outline.length;
  if (n < 3) return;
  ctx.beginPath();
  const [x0, y0] = outline[0];
  const [x1, y1] = outline[1];
  ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
  for (let i = 1; i < n; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  ctx.closePath();
  ctx.fill();
}

export function outlineBounds(outline: number[][], pad = 2): Rect | null {
  if (outline.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of outline) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
