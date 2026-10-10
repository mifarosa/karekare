/** Axis-aligned rectangle in project pixel space. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
}

/** Decoded pixels of a cell, positioned at `rect` inside the project canvas. */
export interface CellImage {
  src: CanvasImageSource;
  rect: Rect;
}

/** Encoded (PNG) pixels of a cell. `blob === null` means the cell is empty. */
export interface CellEncoded {
  blob: Blob | null;
  rect: Rect | null;
  /** Cell version this encoding corresponds to. */
  version: number;
}

/**
 * The drawing of one layer on one frame.
 *
 * Content lives in up to two representations: a decoded image (cache, may be
 * evicted) and an encoded PNG (canonical once `enc.version === version`).
 * Images assigned to `img` are never mutated, so cells may share them.
 */
export interface Cell {
  id: string;
  version: number;
  img: CellImage | null;
  enc: CellEncoded | null;
  /** File name in project storage holding `enc.blob`, if persisted. */
  file: string | null;
}

export interface Frame {
  id: string;
  /** How many ticks (1/fps seconds) this frame stays on screen. */
  hold: number;
  /** Keyed by layer id. A missing entry means an empty cell. */
  cells: Record<string, Cell>;
}

export interface AudioClip {
  id: string;
  name: string;
  blob: Blob;
  mime: string;
  /** Start position on the timeline, in ticks. */
  offset: number;
  /** 0..1 */
  volume: number;
  file: string | null;
}

/**
 * A photo shown faintly on every frame to trace over. It is only a guide:
 * never part of the drawing, never exported.
 */
export interface Reference {
  id: string;
  name: string;
  blob: Blob;
  mime: string;
  /** Size of the decoded image, in its own pixels. */
  width: number;
  height: number;
  /** Center on the canvas, scale and clockwise angle (radians). */
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  /** Draw over the drawing instead of under it (useful with opaque fills). */
  above: boolean;
  file: string | null;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  /** Bottom to top. */
  layers: Layer[];
  frames: Frame[];
  audio: AudioClip | null;
  reference: Reference | null;
  created: number;
  modified: number;
  /** Editor position to restore when reopening. */
  lastFrame: number;
  lastLayer: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  modified: number;
}
