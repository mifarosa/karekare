import { renderClip, type AudioEngine } from '../audio/audio';
import { durationSeconds } from '../model/project';
import type { Project } from '../model/types';
import type { ExportAudio, ExportFormat, ExportJob, ExportMessage, ExportResult } from './types';
import { ExportError } from './types';

export interface ExportOptions {
  format: ExportFormat;
  scale: number;
  transparent: boolean;
  loop: boolean;
  expandHolds: boolean;
  includeAudio: boolean;
}

export function videoSupported(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

/** Builds an export job from a project whose cells are all encoded. */
export async function buildJob(project: Project, opts: ExportOptions, audio: AudioEngine): Promise<ExportJob> {
  const frames = project.frames.map((f) => ({
    hold: f.hold,
    cells: project.layers
      .filter((l) => l.visible && l.opacity > 0)
      .map((l) => ({ layer: l, cell: f.cells[l.id] }))
      .filter(({ cell }) => cell?.enc?.blob && cell.enc.rect)
      .map(({ layer, cell }) => ({ blob: cell!.enc!.blob!, rect: cell!.enc!.rect!, opacity: layer.opacity })),
  }));
  let exportAudio: ExportAudio | null = null;
  if (opts.format === 'video' && opts.includeAudio && project.audio) {
    const buffer = await audio.load(project.audio.blob).catch(() => null);
    if (buffer) exportAudio = await renderClip(buffer, project.audio, project.fps, durationSeconds(project));
  }
  return {
    format: opts.format,
    name: project.name,
    width: project.width,
    height: project.height,
    scale: opts.scale,
    fps: project.fps,
    background: opts.format === 'png' && opts.transparent ? null : project.background,
    frames,
    loop: opts.loop,
    expandHolds: opts.expandHolds,
    audio: exportAudio,
  };
}

export interface RunningExport {
  promise: Promise<ExportResult>;
  cancel: () => void;
}

/** Runs an export in a worker (falls back to the main thread). */
export function runExport(job: ExportJob, onProgress: (done: number, total: number) => void): RunningExport {
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  if (!canWorker) {
    let cancelled = false;
    const promise = import('./exporter').then(({ runExportJob }) =>
      runExportJob(job, (d, t) => {
        if (cancelled) throw new ExportError('Cancelled', 'cancelled');
        onProgress(d, t);
      }),
    );
    return { promise, cancel: () => (cancelled = true) };
  }

  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let reject!: (e: Error) => void;
  const promise = new Promise<ExportResult>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<ExportMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.done, m.total);
      else if (m.type === 'done') {
        worker.terminate();
        resolve(m.result);
      } else {
        worker.terminate();
        rej(new ExportError(m.message, m.code));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new ExportError(e.message || 'Export failed'));
    };
  });
  const transfer = job.audio ? job.audio.channels.map((c) => c.buffer as ArrayBuffer) : [];
  worker.postMessage(job, transfer);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new ExportError('Cancelled', 'cancelled'));
    },
  };
}
