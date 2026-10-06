export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const hasDocument = typeof document !== 'undefined';

/** Creates a 2D canvas that works both on the main thread and in workers. */
export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (hasDocument) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function ctx2d(c: AnyCanvas, readback = false): Ctx2D {
  const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined) as Ctx2D | null;
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

/** Releases canvas memory eagerly (helps iOS Safari's canvas memory cap). */
export function releaseCanvas(c: AnyCanvas): void {
  c.width = 1;
  c.height = 1;
}

export async function canvasToBlob(c: AnyCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
  });
}

export function parseColor(hex: string): [number, number, number] {
  let s = hex.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
