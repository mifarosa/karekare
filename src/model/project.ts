import { uid } from './ids';
import type { Cell, Frame, Layer, Project } from './types';

export const LIMITS = {
  minSize: 16,
  maxSize: 4096,
  minFps: 1,
  maxFps: 60,
  maxHold: 99,
};

export interface NewProjectOptions {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
}

export function createProject(opts: NewProjectOptions, layerName = 'Layer 1'): Project {
  const layer = newLayer(layerName);
  const now = Date.now();
  return {
    id: uid(),
    name: opts.name,
    width: clampInt(opts.width, LIMITS.minSize, LIMITS.maxSize),
    height: clampInt(opts.height, LIMITS.minSize, LIMITS.maxSize),
    fps: clampInt(opts.fps, LIMITS.minFps, LIMITS.maxFps),
    background: opts.background,
    layers: [layer],
    frames: [newFrame()],
    audio: null,
    created: now,
    modified: now,
    lastFrame: 0,
    lastLayer: layer.id,
  };
}

export function newLayer(name: string): Layer {
  return { id: uid(), name, visible: true, locked: false, opacity: 1 };
}

export function newFrame(hold = 1): Frame {
  return { id: uid(), hold, cells: {} };
}

export function newCell(): Cell {
  return { id: uid(), version: 1, img: null, enc: null, file: null };
}

/** A copy of a cell under a new id that shares the (immutable) pixel data. */
export function cloneCell(c: Cell): Cell {
  return {
    id: uid(),
    version: c.version,
    img: c.img,
    enc: c.enc ? { ...c.enc } : null,
    file: null,
  };
}

/** True when the newest content has not been encoded yet. */
export function isDirty(c: Cell): boolean {
  return !c.enc || c.enc.version !== c.version;
}

/** True when the cell is known to have no pixels (ignores live edits). */
export function isKnownEmpty(c: Cell): boolean {
  return !c.img && !!c.enc && c.enc.version === c.version && !c.enc.blob;
}

export function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// Timeline math. A "tick" is one 1/fps step; a frame covers `hold` ticks.

export function totalTicks(frames: readonly Frame[]): number {
  let t = 0;
  for (const f of frames) t += f.hold;
  return t;
}

export function frameStartTick(frames: readonly Frame[], index: number): number {
  let t = 0;
  for (let i = 0; i < index && i < frames.length; i++) t += frames[i].hold;
  return t;
}

/** Index of the frame visible at `tick` (clamped to the timeline). */
export function frameAtTick(frames: readonly Frame[], tick: number): number {
  if (frames.length === 0) return -1;
  let t = 0;
  for (let i = 0; i < frames.length; i++) {
    t += frames[i].hold;
    if (tick < t) return i;
  }
  return frames.length - 1;
}

export function durationSeconds(p: Pick<Project, 'frames' | 'fps'>): number {
  return totalTicks(p.frames) / p.fps;
}

export function allCells(p: Project): Cell[] {
  const out: Cell[] = [];
  for (const f of p.frames) for (const id in f.cells) out.push(f.cells[id]);
  return out;
}

/** Cells of `frame` for visible layers, bottom to top. */
export function visibleCells(p: Project, frame: Frame): { cell: Cell; layer: Layer }[] {
  const out: { cell: Cell; layer: Layer }[] = [];
  for (const layer of p.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const cell = frame.cells[layer.id];
    if (cell) out.push({ cell, layer });
  }
  return out;
}

export function nextLayerName(p: Project, base: string): string {
  const used = new Set(p.layers.map((l) => l.name));
  for (let n = p.layers.length + 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}
