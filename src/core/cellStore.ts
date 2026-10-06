import { isDirty } from '../model/project';
import type { Cell, CellImage, Rect } from '../model/types';

export interface CellSource {
  src: CanvasImageSource;
  rect: Rect;
}

/** Rough per-device budget for decoded cell pixels, in bytes. */
export function defaultDecodeBudget(): number {
  const MB = 1024 * 1024;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const mem = (nav as { deviceMemory?: number } | undefined)?.deviceMemory;
  const mobile = !!nav && /iPad|iPhone|Android|Mobile/i.test(nav.userAgent);
  if (mem) return Math.min(640, Math.max(96, mem * 48)) * MB;
  return (mobile ? 160 : 384) * MB;
}

/**
 * Keeps decoded cell images in an LRU cache with a memory budget and knows
 * which cell is currently "live" (being edited on the editor's canvas).
 */
export class CellStore {
  private lru = new Map<Cell, number>();
  private bytes = 0;
  private decoding = new Map<Cell, Promise<void>>();
  private liveCell: Cell | null = null;
  private liveCanvas: CanvasImageSource | null = null;
  private liveRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(public budget = defaultDecodeBudget()) {}

  setLive(cell: Cell | null, canvas: CanvasImageSource | null, width: number, height: number): void {
    this.liveCell = cell;
    this.liveCanvas = canvas;
    this.liveRect = { x: 0, y: 0, w: width, h: height };
  }

  isLive(cell: Cell): boolean {
    return cell === this.liveCell;
  }

  /** Current pixels of a cell, or null when empty or not decoded yet. */
  source(cell: Cell): CellSource | null {
    if (cell === this.liveCell && this.liveCanvas) return { src: this.liveCanvas, rect: this.liveRect };
    const img = cell.img;
    if (img) {
      this.touch(cell);
      return img;
    }
    return null;
  }

  /** True when `source()` returns the full content (or the cell is empty). */
  isReady(cell: Cell): boolean {
    if (cell === this.liveCell || cell.img) return true;
    return !cell.enc || !cell.enc.blob;
  }

  setImage(cell: Cell, img: CellImage | null): void {
    this.forget(cell);
    cell.img = img;
    if (img) {
      const size = img.rect.w * img.rect.h * 4;
      this.lru.set(cell, size);
      this.bytes += size;
      this.evict();
    }
  }

  /** Decodes all given cells that are not in memory yet. */
  async ensure(cells: Iterable<Cell>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const cell of cells) {
      if (this.isReady(cell)) {
        if (cell.img) this.touch(cell);
        continue;
      }
      jobs.push(this.decode(cell));
    }
    if (jobs.length) await Promise.all(jobs);
  }

  private decode(cell: Cell): Promise<void> {
    let job = this.decoding.get(cell);
    if (job) return job;
    const enc = cell.enc!;
    job = createImageBitmap(enc.blob!)
      .then((bmp) => {
        // Content may have changed while decoding.
        if (cell.enc === enc && !cell.img) this.setImage(cell, { src: bmp, rect: enc.rect! });
        else bmp.close();
      })
      .catch((err) => {
        console.warn('Cell decode failed', err);
      })
      .finally(() => this.decoding.delete(cell));
    this.decoding.set(cell, job);
    return job;
  }

  private touch(cell: Cell): void {
    const size = this.lru.get(cell);
    if (size === undefined) return;
    this.lru.delete(cell);
    this.lru.set(cell, size);
  }

  private forget(cell: Cell): void {
    const size = this.lru.get(cell);
    if (size !== undefined) {
      this.bytes -= size;
      this.lru.delete(cell);
    }
  }

  /** Drops decoded images (oldest first) that can be recreated from their PNG. */
  evict(): void {
    if (this.bytes <= this.budget) return;
    for (const [cell, size] of this.lru) {
      if (this.bytes <= this.budget * 0.85) break;
      if (cell === this.liveCell || isDirty(cell) || !cell.enc?.blob) continue;
      this.lru.delete(cell);
      this.bytes -= size;
      cell.img = null;
    }
  }

  get usedBytes(): number {
    return this.bytes;
  }

  clear(): void {
    this.lru.clear();
    this.bytes = 0;
    this.liveCell = null;
    this.liveCanvas = null;
  }
}
