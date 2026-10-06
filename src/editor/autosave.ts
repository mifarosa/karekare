import { canvasToBlob, createCanvas, ctx2d } from '../core/canvas';
import type { CellEncoder } from '../core/encoder';
import { drawFrame } from '../core/render';
import { allCells, isDirty, visibleCells } from '../model/project';
import type { Cell, Rect } from '../model/types';
import type { ProjectRepo } from '../storage/repo';
import type { Editor } from './editor';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

const THUMB_W = 320;

/** Encodes changed cells and writes the project to storage in the background. */
export class AutoSaver {
  state: SaveState = 'saved';
  error: unknown = null;
  onState: (s: SaveState) => void = () => {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  private thumbKey = '';

  constructor(
    private ed: Editor,
    private repo: ProjectRepo,
    private encoder: CellEncoder,
  ) {}

  schedule(delay = 1200): void {
    this.setState(this.state === 'saving' ? 'saving' : 'pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Saves now; resolves when everything known so far is stored. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        this.setState('saving');
        await this.encodeAll();
        await this.repo.save(this.ed.project);
        await this.saveThumb().catch((err) => console.warn('Thumbnail failed', err));
      } while (this.again);
      this.error = null;
      this.setState(allCells(this.ed.project).some(isDirty) ? 'pending' : 'saved');
    })()
      .catch((err) => {
        console.error('Save failed', err);
        this.error = err;
        this.setState('error');
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Makes sure every cell has an up-to-date PNG (e.g. before export). */
  async encodeAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const cell of allCells(this.ed.project)) {
      if (!isDirty(cell)) continue;
      if (this.ed.store.isLive(cell)) {
        const snap = this.ed.liveSnapshot();
        if (!snap) continue; // Mid-stroke; the stroke end triggers another save.
        if (!snap.bitmap || !snap.rect) {
          applyResult(cell, snap.version, null, null);
          continue;
        }
        jobs.push(this.encode(cell, snap.version, snap.bitmap, snap.rect));
      } else if (cell.img) {
        const { src, rect } = cell.img;
        jobs.push(this.encode(cell, cell.version, createImageBitmap(src), rect));
      }
    }
    await Promise.all(jobs);
  }

  private async encode(cell: Cell, version: number, bitmap: Promise<ImageBitmap>, rect: Rect): Promise<void> {
    try {
      const res = await this.encoder.encode(await bitmap, rect);
      applyResult(cell, version, res.blob, res.rect);
    } catch (err) {
      console.warn('Cell encode failed', err);
    }
  }

  private async saveThumb(): Promise<void> {
    const ed = this.ed;
    const p = ed.project;
    const frame = p.frames[0];
    const cells = visibleCells(p, frame);
    const key = [p.background, ...cells.map(({ cell, layer }) => `${cell.id}:${cell.version}:${layer.opacity}`)].join('|');
    if (key === this.thumbKey) return;
    await ed.store.ensure(cells.map((c) => c.cell));
    const scale = Math.min(1, THUMB_W / p.width);
    const c = createCanvas(p.width * scale, p.height * scale);
    const ctx = ctx2d(c);
    ctx.scale(scale, scale);
    drawFrame(ctx, p, frame, ed.store, { background: true });
    await this.repo.saveThumb(p.id, await canvasToBlob(c, 'image/png'));
    this.thumbKey = key;
  }

  private setState(s: SaveState): void {
    if (s === this.state) return;
    this.state = s;
    this.onState(s);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

function applyResult(cell: Cell, version: number, blob: Blob | null, rect: Rect | null): void {
  if (cell.enc && cell.enc.version >= version) return;
  cell.enc = { blob, rect, version };
}
