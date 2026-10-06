import type { Rect } from '../model/types';

export type ExportFormat = 'gif' | 'video' | 'png';

export interface ExportCell {
  blob: Blob;
  rect: Rect;
  opacity: number;
}

export interface ExportFrame {
  hold: number;
  cells: ExportCell[];
}

export interface ExportAudio {
  channels: Float32Array[];
  sampleRate: number;
}

export interface ExportJob {
  format: ExportFormat;
  name: string;
  width: number;
  height: number;
  /** Output size multiplier. */
  scale: number;
  fps: number;
  /** null = transparent (PNG only). */
  background: string | null;
  frames: ExportFrame[];
  /** GIF: loop forever. */
  loop: boolean;
  /** PNG: repeat held frames so the sequence plays at the project fps. */
  expandHolds: boolean;
  audio: ExportAudio | null;
}

export interface ExportResult {
  blob: Blob;
  ext: string;
  /** Video format actually used ('mp4' or 'webm'), for display. */
  container?: string;
  audioIncluded?: boolean;
}

export type ExportMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: ExportResult }
  | { type: 'error'; message: string; code?: string };

export class ExportError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
