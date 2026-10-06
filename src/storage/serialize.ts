import { uid } from '../model/ids';
import { LIMITS, clamp, clampInt, newFrame, newLayer } from '../model/project';
import type { AudioClip, Cell, Frame, Layer, Project, Rect } from '../model/types';

export const FORMAT = 'karekare';
export const FORMAT_VERSION = 1;

type RectTuple = [number, number, number, number];

export interface CellJSON {
  id: string;
  v: number;
  file: string;
  rect: RectTuple;
}

export interface ProjectJSON {
  format: typeof FORMAT;
  formatVersion: number;
  seq?: number;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  created: number;
  modified: number;
  lastFrame: number;
  lastLayer: string | null;
  layers: Layer[];
  frames: { id: string; hold: number; cells: Record<string, CellJSON> }[];
  audio: { id: string; name: string; mime: string; file: string; offset: number; volume: number } | null;
}

/** Name of the file holding a cell's current encoding. */
export function cellFileName(cell: Cell): string | null {
  if (!cell.enc?.blob) return null;
  return `${cell.id}-${cell.enc.version}.png`;
}

export function audioFileName(a: AudioClip): string {
  const ext = (a.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'audio').toLowerCase();
  return `${a.id}.${ext}`;
}

/**
 * Serializes a project. Only cells with an encoded blob are included; `fileOf`
 * maps them to their stored path (or null to skip).
 */
export function toJSON(p: Project, fileOf: (cell: Cell) => string | null, audioFile: string | null): ProjectJSON {
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    background: p.background,
    created: p.created,
    modified: p.modified,
    lastFrame: p.lastFrame,
    lastLayer: p.lastLayer,
    layers: p.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity })),
    frames: p.frames.map((f) => {
      const cells: Record<string, CellJSON> = {};
      for (const layerId in f.cells) {
        const c = f.cells[layerId];
        const file = c.enc?.blob && c.enc.rect ? fileOf(c) : null;
        if (!file) continue;
        const r = c.enc!.rect!;
        cells[layerId] = { id: c.id, v: c.enc!.version, file, rect: [r.x, r.y, r.w, r.h] };
      }
      return { id: f.id, hold: f.hold, cells };
    }),
    audio:
      p.audio && audioFile
        ? {
            id: p.audio.id,
            name: p.audio.name,
            mime: p.audio.mime,
            file: audioFile,
            offset: p.audio.offset,
            volume: p.audio.volume,
          }
        : null,
  };
}

export class FormatError extends Error {}

const str = (v: unknown, fallback: string, max = 120): string =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback;
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const safeId = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const safeFile = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(v) && !v.includes('..') ? v : null;

/**
 * Parses and validates project JSON (from storage or an imported file).
 * `loadFile(name, kind)` returns the stored blob for a cell or audio file.
 */
export async function fromJSON(
  raw: unknown,
  loadFile: (name: string, kind: 'cell' | 'audio') => Promise<Blob | null>,
): Promise<{ project: Project; files: Map<Cell, string>; audioFile: string | null; missing: number }> {
  if (!raw || typeof raw !== 'object') throw new FormatError('Not a project');
  const j = raw as Partial<ProjectJSON>;
  if (j.format !== FORMAT) throw new FormatError('Unknown format');
  if (num(j.formatVersion, 0) > FORMAT_VERSION) throw new FormatError('Project is from a newer version');

  const width = clampInt(num(j.width, 1280), LIMITS.minSize, LIMITS.maxSize);
  const height = clampInt(num(j.height, 720), LIMITS.minSize, LIMITS.maxSize);

  const layers: Layer[] = [];
  const layerIds = new Set<string>();
  for (const l of Array.isArray(j.layers) ? j.layers : []) {
    const id = safeId(l?.id);
    if (!id || layerIds.has(id)) continue;
    layerIds.add(id);
    layers.push({
      id,
      name: str(l.name, `Layer ${layers.length + 1}`, 60),
      visible: l.visible !== false,
      locked: l.locked === true,
      opacity: clamp(num(l.opacity, 1), 0, 1),
    });
  }
  if (layers.length === 0) {
    const l = newLayer('Layer 1');
    layers.push(l);
    layerIds.add(l.id);
  }

  const files = new Map<Cell, string>();
  const frames: Frame[] = [];
  const frameIds = new Set<string>();
  const cellIds = new Set<string>();
  let missing = 0;
  const jobs: Promise<void>[] = [];
  for (const fj of Array.isArray(j.frames) ? j.frames : []) {
    let id = safeId(fj?.id);
    const frame = newFrame(clampInt(num(fj?.hold, 1), 1, LIMITS.maxHold));
    if (id && !frameIds.has(id)) frame.id = id;
    id = frame.id;
    frameIds.add(id);
    frames.push(frame);
    const cells = fj?.cells && typeof fj.cells === 'object' ? fj.cells : {};
    for (const layerId of Object.keys(cells)) {
      if (!layerIds.has(layerId)) continue;
      const cj = cells[layerId] as Partial<CellJSON>;
      const cid = safeId(cj?.id);
      const file = safeFile(cj?.file);
      const rect = parseRect(cj?.rect, width, height);
      if (!cid || cellIds.has(cid) || !file || !rect) continue;
      cellIds.add(cid);
      const version = clampInt(num(cj.v, 0), 0, Number.MAX_SAFE_INTEGER);
      jobs.push(
        loadFile(file, 'cell').then((blob) => {
          if (!blob) {
            missing++;
            return;
          }
          const cell: Cell = { id: cid, version, img: null, enc: { blob, rect, version }, file };
          frame.cells[layerId] = cell;
          files.set(cell, file);
        }),
      );
    }
  }
  if (frames.length === 0) frames.push(newFrame());
  await Promise.all(jobs);

  let audio: AudioClip | null = null;
  let audioFile: string | null = null;
  const aj = j.audio;
  if (aj && typeof aj === 'object') {
    const id = safeId(aj.id);
    const file = safeFile(aj.file);
    if (id && file) {
      const blob = await loadFile(file, 'audio');
      if (blob) {
        audio = {
          id,
          name: str(aj.name, 'audio', 120),
          mime: str(aj.mime, blob.type || 'audio/mpeg', 60),
          blob,
          offset: clampInt(num(aj.offset, 0), -100000, 100000),
          volume: clamp(num(aj.volume, 1), 0, 1),
          file,
        };
        audioFile = file;
      } else {
        missing++;
      }
    }
  }

  const project: Project = {
    id: safeId(j.id) ?? uid(),
    name: str(j.name, 'Animation', 80),
    width,
    height,
    fps: clampInt(num(j.fps, 12), LIMITS.minFps, LIMITS.maxFps),
    background: typeof j.background === 'string' && /^#[0-9a-f]{6}$/i.test(j.background) ? j.background : '#ffffff',
    layers,
    frames,
    audio,
    created: num(j.created, Date.now()),
    modified: num(j.modified, Date.now()),
    lastFrame: clampInt(num(j.lastFrame, 0), 0, frames.length - 1),
    lastLayer: typeof j.lastLayer === 'string' && layerIds.has(j.lastLayer) ? j.lastLayer : null,
  };
  return { project, files, audioFile, missing };
}

function parseRect(v: unknown, width: number, height: number): Rect | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [x, y, w, h] = v.map((n) => Math.round(num(n, NaN)));
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  if (x < 0 || y < 0 || x + w > width || y + h > height) return null;
  return { x, y, w, h };
}
