import type { AudioClip } from '../model/types';

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function audioSupported(): boolean {
  return contextCtor() !== null;
}

/** Decoding, waveform peaks, playback and scrubbing of the project's sound. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferFor: Blob | null = null;
  private loading: Promise<AudioBuffer | null> | null = null;
  private playing: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private scrubNode: AudioBufferSourceNode | null = null;
  private peakCache: { key: string; peaks: Float32Array } | null = null;

  context(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get decoded(): AudioBuffer | null {
    return this.buffer;
  }

  /** Decodes `blob` (cached for the same blob). */
  load(blob: Blob): Promise<AudioBuffer | null> {
    if (this.bufferFor === blob && this.buffer) return Promise.resolve(this.buffer);
    if (this.bufferFor === blob && this.loading) return this.loading;
    this.bufferFor = blob;
    this.buffer = null;
    this.peakCache = null;
    this.loading = (async () => {
      const ctx = this.context();
      if (!ctx) return null;
      const data = await blob.arrayBuffer();
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        // Callback form for older Safari.
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      });
      if (this.bufferFor === blob) this.buffer = buf;
      return buf;
    })();
    return this.loading;
  }

  unload(): void {
    this.stop();
    this.buffer = null;
    this.bufferFor = null;
    this.peakCache = null;
  }

  /**
   * Starts playback so that timeline time `fromSec` lines up with the clip.
   * Returns the context time at which timeline time `fromSec` is heard.
   */
  play(fromSec: number, clip: AudioClip, fps: number): number | null {
    this.stop();
    const ctx = this.context();
    const buf = this.buffer;
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
    src.connect(gain).connect(ctx.destination);
    const when = ctx.currentTime + 0.06;
    const pos = fromSec - clip.offset / fps;
    if (pos >= 0) {
      if (pos < buf.duration) src.start(when, pos);
    } else {
      src.start(when - pos, 0);
    }
    this.playing = { src, gain };
    return when;
  }

  stop(): void {
    if (!this.playing) return;
    try {
      this.playing.src.stop();
    } catch {
      // Not started.
    }
    this.playing.src.disconnect();
    this.playing = null;
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Plays a short slice at timeline time `atSec` (for lip-sync scrubbing). */
  scrub(atSec: number, durSec: number, clip: AudioClip, fps: number): void {
    const ctx = this.context();
    const buf = this.buffer;
    if (!ctx || !buf || this.playing) return;
    const pos = atSec - clip.offset / fps;
    if (pos < 0 || pos >= buf.duration) return;
    try {
      this.scrubNode?.stop();
    } catch {
      // Ignore.
    }
    const dur = Math.min(Math.max(durSec, 0.06), 0.3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(clip.volume, t + 0.008);
    gain.gain.setValueAtTime(clip.volume, t + dur - 0.02);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(gain).connect(ctx.destination);
    src.start(t, pos, dur);
    this.scrubNode = src;
  }

  /** Peak amplitude per bucket, `perSecond` buckets per second. */
  peaks(perSecond: number): Float32Array | null {
    const buf = this.buffer;
    if (!buf) return null;
    const key = `${perSecond}`;
    if (this.peakCache?.key === key) return this.peakCache.peaks;
    const n = Math.ceil(buf.duration * perSecond);
    const peaks = new Float32Array(n);
    const step = buf.sampleRate / perSecond;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const s0 = Math.floor(i * step);
        const s1 = Math.min(data.length, Math.floor((i + 1) * step));
        let m = peaks[i];
        // Sampling a subset keeps this fast for long files.
        const stride = Math.max(1, Math.floor((s1 - s0) / 256));
        for (let s = s0; s < s1; s += stride) {
          const v = Math.abs(data[s]);
          if (v > m) m = v;
        }
        peaks[i] = m;
      }
    }
    this.peakCache = { key, peaks };
    return peaks;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/**
 * Renders the clip as it sounds on the timeline: offset, volume and cut to
 * `durationSec`, resampled to `sampleRate`. Returns planar channel data.
 */
export async function renderClip(
  buffer: AudioBuffer,
  clip: AudioClip,
  fps: number,
  durationSec: number,
  sampleRate = 48000,
): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
  const w = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) return null;
  const length = Math.max(1, Math.ceil(durationSec * sampleRate));
  const channels = Math.min(2, buffer.numberOfChannels);
  const off = new Ctor(channels, length, sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const gain = off.createGain();
  gain.gain.value = clip.volume;
  src.connect(gain).connect(off.destination);
  const offsetSec = clip.offset / fps;
  if (offsetSec >= 0) src.start(offsetSec);
  else src.start(0, -offsetSec);
  const rendered = await off.startRendering();
  const out: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) out.push(new Float32Array(rendered.getChannelData(c)));
  return { channels: out, sampleRate };
}
