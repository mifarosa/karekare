import type { AudioEngine } from '../audio/audio';
import { allCells, frameAtTick, frameStartTick, totalTicks, visibleCells } from '../model/project';
import type { Cell } from '../model/types';
import type { Editor } from './editor';

/** Plays the animation (and its sound) on the stage. */
export class Player {
  private raf = 0;
  private startTick = 0;
  private t0 = 0;
  private audioWhen: number | null = null;
  private shown = -1;
  private token = 0;
  onLoading: (loading: boolean) => void = () => {};

  constructor(
    private ed: Editor,
    private audio: AudioEngine,
  ) {
    // Editing the timeline while playing stops playback where the edit put us.
    ed.events.on('structure', () => this.stop(undefined, false));
  }

  get playing(): boolean {
    return this.ed.playing;
  }

  toggle(): void {
    if (this.ed.playing) this.stop();
    else void this.start();
  }

  async start(): Promise<void> {
    const ed = this.ed;
    if (ed.playing || ed.editing) return;
    const token = ++this.token;
    const p = ed.project;
    const frames = p.frames;
    let start = ed.frameIndex;
    if (start >= frames.length - 1 && frames.length > 1) start = 0;

    // Decode everything up front when it fits in memory, else the first second.
    const cells = allCells(p);
    const bytes = cells.reduce((sum, c) => sum + (c.enc?.rect ? c.enc.rect.w * c.enc.rect.h * 4 : 0), 0);
    const first = bytes < ed.store.budget * 0.8 ? cells : this.cellsAhead(start, p.fps);
    const pending = first.filter((c) => !ed.store.isReady(c));
    if (pending.length) {
      this.onLoading(true);
      await ed.store.ensure(pending);
      this.onLoading(false);
      if (token !== this.token) return;
    }
    if (p.audio) await this.audio.load(p.audio.blob).catch(() => null);
    if (token !== this.token) return;

    ed.setPlaying(true);
    this.restart(frameStartTick(frames, start));
    this.shown = -1;
    this.raf = requestAnimationFrame(this.tick);
  }

  private restart(tick: number): void {
    const p = this.ed.project;
    this.startTick = tick;
    this.t0 = performance.now();
    this.audioWhen = p.audio ? this.audio.play(tick / p.fps, p.audio, p.fps) : null;
  }

  private elapsed(): number {
    if (this.audioWhen !== null) return Math.max(0, this.audio.now() - this.audioWhen);
    return (performance.now() - this.t0) / 1000;
  }

  private tick = (): void => {
    const ed = this.ed;
    if (!ed.playing) return;
    const p = ed.project;
    const total = totalTicks(p.frames);
    let tick = this.startTick + Math.floor(this.elapsed() * p.fps + 1e-6);
    if (tick >= total) {
      if (ed.loop) {
        this.restart(0);
        tick = 0;
      } else {
        this.stop(p.frames.length - 1);
        return;
      }
    }
    const index = frameAtTick(p.frames, tick);
    if (index !== this.shown) {
      const frame = p.frames[index];
      const ready = visibleCells(p, frame).every(({ cell }) => ed.store.isReady(cell));
      if (ready || this.shown < 0) {
        this.shown = index;
        ed.events.emit('playhead', index);
      }
      void ed.store.ensure(this.cellsAhead(index, Math.ceil(p.fps / 2)));
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private cellsAhead(from: number, count: number): Cell[] {
    const p = this.ed.project;
    const out: Cell[] = [];
    for (let i = 0; i < count; i++) {
      const f = p.frames[(from + i) % p.frames.length];
      for (const { cell } of visibleCells(p, f)) out.push(cell);
    }
    return out;
  }

  /** Stops and (by default) moves the editor to the shown or given frame. */
  stop(at?: number, navigate = true): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.onLoading(false);
    if (!this.ed.playing) return;
    this.ed.setPlaying(false);
    const index = at ?? this.shown;
    if (navigate && index >= 0) this.ed.goToFrame(index);
  }

  dispose(): void {
    this.stop();
  }
}
