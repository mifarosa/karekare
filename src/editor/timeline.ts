import type { AudioEngine } from '../audio/audio';
import { t } from '../i18n';
import { LIMITS, frameStartTick, totalTicks } from '../model/project';
import { clear, h } from '../ui/dom';
import { icon } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import type { Editor } from './editor';
import type { Player } from './player';
import { Thumbnails } from './thumbnails';

const THUMB_H = 54;
const GAP = 6;

export interface TimelineCallbacks {
  onAudio: (anchor: HTMLElement) => void;
  onScrub: (index: number) => void;
}

/** Frame strip with thumbnails, hold lengths, drag reordering and the sound lane. */
export class Timeline {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private framesEl: HTMLElement;
  private audioLane: HTMLElement;
  private scroller: HTMLElement;
  private counter: HTMLElement;
  private holdLabel: HTMLElement;
  private playBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private fpsBtn: HTMLButtonElement;
  private deleteBtn: HTMLButtonElement;
  private thumbs: Thumbnails;
  private tickW: number;
  private boxes: HTMLElement[] = [];
  private marker: HTMLElement;
  private offs: (() => void)[] = [];
  private drag: {
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    target: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    type: string;
  } | null = null;

  constructor(
    private ed: Editor,
    private player: Player,
    private audio: AudioEngine,
    private cb: TimelineCallbacks,
  ) {
    this.thumbs = new Thumbnails(ed, THUMB_H);
    const thumbW = Math.min(120, Math.max(36, (THUMB_H * ed.project.width) / ed.project.height));
    this.tickW = Math.round(thumbW) + GAP;

    const btn = (name: Parameters<typeof icon>[0], label: string, onclick: () => void, cls = '') =>
      h('button', { class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick }, icon(name));

    this.playBtn = btn('play', t('play'), () => player.toggle(), 'play-btn');
    this.loopBtn = btn('loop', t('loop'), () => {
      ed.loop = !ed.loop;
      this.loopBtn.classList.toggle('active', ed.loop);
    });
    this.loopBtn.classList.toggle('active', ed.loop);
    this.counter = h('span', { class: 'tl-counter' });
    this.holdLabel = h('span', { class: 'tl-hold-label' });
    this.fpsBtn = h('button', { class: 'chip', title: t('fps'), onclick: (e: Event) => this.fpsMenu(e.currentTarget as HTMLElement) });
    this.deleteBtn = btn('trash', t('deleteFrame'), () => ed.deleteFrame());
    const musicBtn: HTMLButtonElement = btn('music', t('sound'), () => cb.onAudio(musicBtn));

    const bar = h(
      'div',
      { class: 'tl-bar' },
      h(
        'div',
        { class: 'tl-group' },
        btn('prev', t('prevFrame'), () => this.step(-1)),
        this.playBtn,
        btn('next', t('nextFrame'), () => this.step(1)),
        this.loopBtn,
        this.counter,
      ),
      h(
        'div',
        { class: 'tl-group' },
        btn('newFrame', t('addFrame'), () => ed.addFrame(), 'accent'),
        btn('copy', t('duplicateFrame'), () => ed.duplicateFrame()),
        this.deleteBtn,
      ),
      h(
        'div',
        { class: 'tl-group' },
        btn('minus', t('holdLess'), () => ed.setHold(ed.frameIndex, ed.frame.hold - 1)),
        this.holdLabel,
        btn('plus', t('holdMore'), () => ed.setHold(ed.frameIndex, ed.frame.hold + 1)),
      ),
      h('div', { class: 'tl-group' }, this.fpsBtn, musicBtn),
    );

    this.framesEl = h('div', { class: 'tl-frames' });
    this.audioLane = h('div', { class: 'tl-audio' });
    this.marker = h('div', { class: 'tl-marker' });
    this.track = h('div', { class: 'tl-track' }, this.framesEl, this.audioLane, this.marker);
    this.scroller = h('div', { class: 'tl-scroll' }, this.track);
    this.el = h('div', { class: 'timeline' }, bar, this.scroller);

    // Mouse wheels scroll the strip sideways.
    this.scroller.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          this.scroller.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
    // Block native scrolling while dragging a frame (iOS ignores touch-action changes mid-gesture).
    this.scroller.addEventListener(
      'touchmove',
      (e) => {
        if (this.drag?.active) e.preventDefault();
      },
      { passive: false },
    );

    const ev = ed.events;
    this.offs.push(
      ev.on('structure', () => this.render()),
      ev.on('current', () => this.updateCurrent()),
      ev.on('content', ({ frameId }) => this.thumbs.invalidate(frameId)),
      ev.on('layers', () => this.thumbs.invalidate()),
      ev.on('project', () => {
        this.thumbs.invalidate();
        this.renderAudio();
        this.updateCurrent();
      }),
      ev.on('playback', () => this.updatePlayback()),
      ev.on('playhead', (i) => this.highlight(i, true)),
    );
    this.render();
  }

  private step(d: number): void {
    const n = this.ed.project.frames.length;
    let i = this.ed.frameIndex + d;
    if (i < 0) i = n - 1;
    if (i >= n) i = 0;
    this.ed.goToFrame(i);
    this.cb.onScrub(i);
  }

  render(): void {
    const ed = this.ed;
    this.thumbs.prune();
    clear(this.framesEl);
    this.boxes = ed.project.frames.map((frame, i) => {
      const box = h(
        'div',
        {
          class: 'tl-frame',
          style: { width: `${frame.hold * this.tickW - GAP}px` },
          dataset: { index: String(i) },
          role: 'button',
          'aria-label': t('frameN', { n: i + 1 }),
        },
        this.thumbs.get(frame),
        h('span', { class: 'tl-num' }, String(i + 1)),
        frame.hold > 1 ? h('span', { class: 'tl-hold' }, `×${frame.hold}`) : null,
      );
      box.addEventListener('pointerdown', (e) => this.onFrameDown(e, i));
      return box;
    });
    this.framesEl.append(
      ...this.boxes,
      h(
        'button',
        { class: 'tl-add', title: t('addFrameEnd'), 'aria-label': t('addFrameEnd'), onclick: () => this.addAtEnd() },
        icon('plus', 22),
      ),
    );
    this.renderAudio();
    this.updateCurrent();
  }

  private addAtEnd(): void {
    this.ed.goToFrame(this.ed.project.frames.length - 1);
    this.ed.addFrame();
  }

  renderAudio(): void {
    const ed = this.ed;
    const p = ed.project;
    clear(this.audioLane);
    const ticks = totalTicks(p.frames);
    this.track.style.width = `${(ticks + 1) * this.tickW + 60}px`;
    this.audioLane.classList.toggle('empty', !p.audio);
    if (!p.audio) return;
    const clipEl = h('div', { class: 'tl-wave' });
    const draw = () => {
      const peaks = this.audio.peaks(p.fps * 4);
      if (!peaks || !p.audio) return;
      const pxPerBucket = this.tickW / 4;
      const width = Math.min(32000, Math.ceil(peaks.length * pxPerBucket));
      const height = 28;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = h('canvas', { width: Math.ceil(width * dpr), height: height * dpr });
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = getComputedStyle(this.el).getPropertyValue('--wave') || '#7c5cff';
      for (let i = 0; i < peaks.length; i++) {
        const v = Math.min(1, peaks[i] * 1.2);
        const bh = Math.max(1, v * height);
        ctx.fillRect(i * pxPerBucket, (height - bh) / 2, Math.max(1, pxPerBucket - 1), bh);
      }
      clear(clipEl);
      clipEl.append(c, h('span', { class: 'tl-wave-name' }, p.audio.name));
      clipEl.style.width = `${width}px`;
    };
    clipEl.style.transform = `translateX(${p.audio.offset * this.tickW}px)`;
    this.audioLane.append(clipEl);
    if (this.audio.decoded) draw();
    else void this.audio.load(p.audio.blob).then(draw, () => clipEl.append(h('span', { class: 'tl-wave-name' }, p.audio?.name ?? '')));
    this.attachAudioDrag(clipEl);
  }

  /** Drag the sound clip sideways to change its offset (in frames). */
  private attachAudioDrag(clipEl: HTMLElement): void {
    let start: { x: number; offset: number; moved: boolean } | null = null;
    clipEl.addEventListener('pointerdown', (e) => {
      const a = this.ed.project.audio;
      if (!a) return;
      start = { x: e.clientX, offset: a.offset, moved: false };
      clipEl.setPointerCapture(e.pointerId);
    });
    clipEl.addEventListener('pointermove', (e) => {
      const a = this.ed.project.audio;
      if (!start || !a) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 6) start.moved = true;
      if (!start.moved) return;
      const offset = start.offset + Math.round(dx / this.tickW);
      if (offset !== a.offset) {
        a.offset = offset;
        clipEl.style.transform = `translateX(${offset * this.tickW}px)`;
      }
    });
    const end = () => {
      const a = this.ed.project.audio;
      if (start && a) {
        if (start.moved) this.ed.setAudioProps({ offset: a.offset });
        else this.cb.onAudio(clipEl);
      }
      start = null;
    };
    clipEl.addEventListener('pointerup', end);
    clipEl.addEventListener('pointercancel', end);
  }

  private updateCurrent(): void {
    const ed = this.ed;
    const n = ed.project.frames.length;
    this.counter.textContent = `${ed.frameIndex + 1} / ${n}`;
    this.holdLabel.textContent = `×${ed.frame.hold}`;
    this.holdLabel.title = t('holdHint');
    this.fpsBtn.textContent = `${ed.project.fps} fps`;
    this.deleteBtn.disabled = n <= 1;
    if (!ed.playing) this.highlight(ed.frameIndex, false);
  }

  private highlight(index: number, playing: boolean): void {
    for (const b of this.boxes) b.classList.remove('current', 'playhead');
    const box = this.boxes[index];
    if (!box) return;
    box.classList.add(playing ? 'playhead' : 'current');
    this.scrollIntoView(index);
  }

  private scrollIntoView(index: number): void {
    const s = this.scroller;
    const x = frameStartTick(this.ed.project.frames, index) * this.tickW;
    const w = this.ed.project.frames[index].hold * this.tickW;
    if (x < s.scrollLeft + 8) s.scrollLeft = Math.max(0, x - 24);
    else if (x + w > s.scrollLeft + s.clientWidth - 8) s.scrollLeft = x + w - s.clientWidth + 24;
  }

  private updatePlayback(): void {
    const playing = this.ed.playing;
    clear(this.playBtn);
    this.playBtn.append(icon(playing ? 'pause' : 'play'));
    this.playBtn.title = playing ? t('pause') : t('play');
    this.playBtn.setAttribute('aria-label', this.playBtn.title);
    this.el.classList.toggle('is-playing', playing);
    if (!playing) this.updateCurrent();
  }

  private fpsMenu(anchor: HTMLElement): void {
    const ed = this.ed;
    const values = [4, 6, 8, 10, 12, 15, 24, 30];
    const list = h(
      'div',
      { class: 'menu' },
      h('div', { class: 'menu-title' }, t('fpsTitle')),
      ...values.map((v) =>
        h(
          'button',
          {
            class: `menu-item ${ed.project.fps === v ? 'active' : ''}`,
            onclick: () => {
              ed.setProjectProps({ fps: v });
              closePopover();
            },
          },
          `${v} fps`,
        ),
      ),
    );
    popover(anchor, list, { side: 'top' });
  }

  // -------------------------------------------------------------------------
  // Frame tap / drag reordering

  private onFrameDown(e: PointerEvent, index: number): void {
    if (this.ed.playing) {
      this.player.stop();
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const box = e.currentTarget as HTMLElement;
    this.drag = {
      index,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      target: index,
      type: e.pointerType,
      timer: undefined,
    };
    if (e.pointerType !== 'mouse') {
      this.drag.timer = setTimeout(() => this.beginDrag(box), 380);
    }
    const move = (ev: PointerEvent) => this.onFrameMove(ev, box);
    const up = (ev: PointerEvent) => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      this.onFrameUp(ev, index, box);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  }

  private beginDrag(box: HTMLElement): void {
    const d = this.drag;
    if (!d || d.active) return;
    d.active = true;
    try {
      box.setPointerCapture(d.pointerId);
    } catch {
      // Ignore.
    }
    box.classList.add('dragging');
    this.el.classList.add('reordering');
    navigator.vibrate?.(10);
  }

  private onFrameMove(e: PointerEvent, box: HTMLElement): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (d.type === 'mouse' && Math.abs(dx) > 6) this.beginDrag(box);
      else if (Math.hypot(dx, dy) > 10) {
        // Finger moved before long-press: it's a scroll.
        clearTimeout(d.timer);
      }
      if (!d.active) return;
    }
    // Find the insertion slot from the pointer position.
    const x = e.clientX - this.track.getBoundingClientRect().left;
    const frames = this.ed.project.frames;
    let slot = frames.length; // past the last frame
    let markerX = 0;
    let acc = 0;
    for (let i = 0; i < frames.length; i++) {
      const w = frames[i].hold * this.tickW;
      if (x < acc + w / 2) {
        slot = i;
        break;
      }
      acc += w;
    }
    markerX = acc;
    // The dragged frame leaves its slot, so later slots shift left by one.
    const target = Math.min(frames.length - 1, slot > d.index ? slot - 1 : slot);
    d.target = target;
    this.marker.style.display = 'block';
    this.marker.style.transform = `translateX(${markerX - GAP / 2}px)`;
    // Auto-scroll near the edges.
    const r = this.scroller.getBoundingClientRect();
    if (e.clientX < r.left + 40) this.scroller.scrollLeft -= 12;
    else if (e.clientX > r.right - 40) this.scroller.scrollLeft += 12;
  }

  private onFrameUp(e: PointerEvent, index: number, box: HTMLElement): void {
    const d = this.drag;
    this.drag = null;
    this.marker.style.display = 'none';
    box.classList.remove('dragging');
    this.el.classList.remove('reordering');
    if (!d) return;
    clearTimeout(d.timer);
    if (d.active) {
      if (d.target !== d.index) this.ed.moveFrame(d.index, d.target);
      return;
    }
    if (e.type === 'pointercancel') return;
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 10;
    if (moved) return;
    if (index === this.ed.frameIndex) this.frameMenu(box, index);
    else {
      this.ed.goToFrame(index);
      this.cb.onScrub(index);
    }
  }

  private frameMenu(anchor: HTMLElement, index: number): void {
    const ed = this.ed;
    const item = (name: Parameters<typeof icon>[0], label: string, run: () => void, disabled = false) =>
      h(
        'button',
        {
          class: 'menu-item',
          disabled,
          onclick: () => {
            closePopover();
            run();
          },
        },
        icon(name, 18),
        label,
      );
    const frames = ed.project.frames;
    const menu = h(
      'div',
      { class: 'menu' },
      h('div', { class: 'menu-title' }, t('frameN', { n: index + 1 })),
      item('newFrame', t('addFrame'), () => ed.addFrame()),
      item('copy', t('duplicateFrame'), () => ed.duplicateFrame()),
      item('chevronLeft', t('moveLeft'), () => ed.moveFrame(index, index - 1), index === 0),
      item('chevronRight', t('moveRight'), () => ed.moveFrame(index, index + 1), index >= frames.length - 1),
      item('plus', t('holdMore'), () => ed.setHold(index, frames[index].hold + 1), frames[index].hold >= LIMITS.maxHold),
      item('minus', t('holdLess'), () => ed.setHold(index, frames[index].hold - 1), frames[index].hold <= 1),
      item('eraser', t('clearLayerOnFrame'), () => ed.clearCell(), !ed.liveBounds),
      item('trash', t('deleteFrame'), () => ed.deleteFrame(), frames.length <= 1),
    );
    popover(anchor, menu, { side: 'top' });
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}
