// Runs in the export worker (or on the main thread as a fallback).
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { zipSync, type Zippable } from 'fflate';
import { canvasToBlob, createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../core/canvas';
import { ExportError, type ExportFrame, type ExportJob, type ExportResult } from './types';

type Progress = (done: number, total: number) => void;

/** Composites export frames at output size, decoding cell PNGs on demand. */
class FrameRenderer {
  readonly canvas: AnyCanvas;
  readonly ctx: Ctx2D;
  readonly width: number;
  readonly height: number;
  private cache = new Map<Blob, ImageBitmap>();

  constructor(
    private job: ExportJob,
    even: boolean,
  ) {
    let w = Math.max(1, Math.round(job.width * job.scale));
    let h = Math.max(1, Math.round(job.height * job.scale));
    if (even) {
      w += w % 2;
      h += h % 2;
    }
    this.width = w;
    this.height = h;
    this.canvas = createCanvas(w, h);
    this.ctx = ctx2d(this.canvas, true);
    this.ctx.imageSmoothingQuality = 'high';
  }

  async render(frame: ExportFrame): Promise<void> {
    const { ctx, job } = this;
    const sx = this.width / job.width;
    const sy = this.height / job.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.width, this.height);
    if (job.background) {
      ctx.fillStyle = job.background;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    const used = new Set<Blob>();
    for (const c of frame.cells) {
      const bmp = await this.decode(c.blob);
      used.add(c.blob);
      ctx.globalAlpha = c.opacity;
      ctx.drawImage(bmp, c.rect.x, c.rect.y, c.rect.w, c.rect.h);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Keep only what this frame used; the next frame often shares cells.
    for (const [blob, bmp] of this.cache) {
      if (!used.has(blob)) {
        bmp.close();
        this.cache.delete(blob);
      }
    }
  }

  private async decode(blob: Blob): Promise<ImageBitmap> {
    let bmp = this.cache.get(blob);
    if (!bmp) {
      bmp = await createImageBitmap(blob);
      this.cache.set(blob, bmp);
    }
    return bmp;
  }

  dispose(): void {
    for (const bmp of this.cache.values()) bmp.close();
    this.cache.clear();
  }
}

export async function runExportJob(job: ExportJob, progress: Progress): Promise<ExportResult> {
  if (job.frames.length === 0) throw new ExportError('Nothing to export', 'empty');
  switch (job.format) {
    case 'gif':
      return exportGif(job, progress);
    case 'png':
      return exportPng(job, progress);
    case 'video':
      return exportVideo(job, progress);
  }
}

async function exportGif(job: ExportJob, progress: Progress): Promise<ExportResult> {
  const r = new FrameRenderer({ ...job, background: job.background ?? '#ffffff' }, false);
  const gif = GIFEncoder();
  const total = job.frames.length;
  let carry = 0;
  try {
    for (let i = 0; i < total; i++) {
      const frame = job.frames[i];
      await r.render(frame);
      const { data } = r.ctx.getImageData(0, 0, r.width, r.height);
      const palette = quantize(data, 256, { format: 'rgb565' });
      const index = applyPalette(data, palette, 'rgb565');
      // GIF delays are in 1/100 s; carry rounding error so timing stays exact.
      const exact = (frame.hold * 100) / job.fps + carry;
      const cs = Math.max(2, Math.round(exact));
      carry = exact - cs;
      gif.writeFrame(index, r.width, r.height, { palette, delay: cs * 10, repeat: job.loop ? 0 : -1 });
      progress(i + 1, total);
    }
    gif.finish();
    const bytes = gif.bytes();
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), ext: 'gif' };
  } finally {
    r.dispose();
  }
}

async function exportPng(job: ExportJob, progress: Progress): Promise<ExportResult> {
  const r = new FrameRenderer(job, false);
  const total = job.frames.length;
  try {
    if (total === 1) {
      await r.render(job.frames[0]);
      progress(1, 1);
      return { blob: await canvasToBlob(r.canvas, 'image/png'), ext: 'png' };
    }
    const files: Zippable = {};
    const count = job.expandHolds ? job.frames.reduce((n, f) => n + f.hold, 0) : total;
    const digits = Math.max(4, String(count).length);
    const base = job.name.replace(/[^\w-]+/g, '_') || 'frame';
    let n = 0;
    for (let i = 0; i < total; i++) {
      const frame = job.frames[i];
      await r.render(frame);
      const bytes = new Uint8Array(await (await canvasToBlob(r.canvas, 'image/png')).arrayBuffer());
      const copies = job.expandHolds ? frame.hold : 1;
      for (let c = 0; c < copies; c++) {
        n++;
        files[`${base}_${String(n).padStart(digits, '0')}.png`] = [bytes, { level: 0 }];
      }
      progress(i + 1, total);
    }
    const zipped = zipSync(files);
    return { blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), ext: 'zip' };
  } finally {
    r.dispose();
  }
}

async function exportVideo(job: ExportJob, progress: Progress): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined') throw new ExportError('WebCodecs is not supported', 'noVideo');
  const mb = await import('mediabunny');
  const r = new FrameRenderer({ ...job, background: job.background ?? '#ffffff' }, true);
  const size = { width: r.width, height: r.height };

  let container: 'mp4' | 'webm' = 'mp4';
  let vcodec = await mb.getFirstEncodableVideoCodec(['avc', 'hevc'], size);
  if (!vcodec) {
    container = 'webm';
    vcodec = await mb.getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], size);
  }
  if (!vcodec) throw new ExportError('No video encoder available', 'noVideo');

  const output = new mb.Output({
    format: container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const video = new mb.CanvasSource(r.canvas, { codec: vcodec, quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: job.fps });

  let audioSource: InstanceType<typeof mb.AudioSampleSource> | null = null;
  const audio = job.audio;
  if (audio && audio.channels.length) {
    const acodec = await mb.getFirstEncodableAudioCodec(container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'], {
      numberOfChannels: audio.channels.length,
      sampleRate: audio.sampleRate,
    });
    if (acodec) {
      audioSource = new mb.AudioSampleSource({ codec: acodec, quality: mb.QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
  }

  try {
    await output.start();
    const total = job.frames.length;
    let tick = 0;
    for (let i = 0; i < total; i++) {
      const frame = job.frames[i];
      await r.render(frame);
      // Constant frame rate: held frames are repeated (cheap to encode).
      for (let k = 0; k < frame.hold; k++) {
        await video.add(tick / job.fps, 1 / job.fps);
        tick++;
      }
      progress(i + 1, total);
    }
    if (audioSource && audio) {
      const chunk = audio.sampleRate; // one second per sample
      const length = audio.channels[0].length;
      for (let start = 0; start < length; start += chunk) {
        const n = Math.min(chunk, length - start);
        const data = new Float32Array(n * audio.channels.length);
        audio.channels.forEach((ch, c) => data.set(ch.subarray(start, start + n), c * n));
        const sample = new mb.AudioSample({
          data,
          format: 'f32-planar',
          numberOfChannels: audio.channels.length,
          sampleRate: audio.sampleRate,
          timestamp: start / audio.sampleRate,
        });
        await audioSource.add(sample);
        sample.close();
      }
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  } finally {
    r.dispose();
  }
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
  return {
    blob: new Blob([buffer], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' }),
    ext: container,
    container,
    audioIncluded: !!audioSource,
  };
}
