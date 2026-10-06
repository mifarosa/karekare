import type { Rect } from '../model/types';
import { trimAndEncode, type EncodeResult } from './cellCodec';

interface Pending {
  resolve: (r: EncodeResult) => void;
  reject: (e: Error) => void;
}

/** Trims and PNG-encodes cell pixels, off the main thread when possible. */
export class CellEncoder {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    if (typeof OffscreenCanvas === 'undefined' || !('convertToBlob' in OffscreenCanvas.prototype)) return;
    try {
      this.worker = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { id, ok, blob, rect, error } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (ok) p.resolve({ blob, rect });
        else p.reject(new Error(error));
      };
      this.worker.onerror = () => this.fallback();
    } catch {
      this.worker = null;
    }
  }

  /** Takes ownership of `bitmap`. */
  encode(bitmap: ImageBitmap, rect: Rect): Promise<EncodeResult> {
    if (!this.worker) {
      return trimAndEncode(bitmap, rect).finally(() => bitmap.close());
    }
    const id = ++this.seq;
    return new Promise<EncodeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, bitmap, rect }, [bitmap]);
    });
  }

  private fallback(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('Encoder worker failed'));
    this.pending.clear();
  }

  dispose(): void {
    this.fallback();
  }
}
