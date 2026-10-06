import { createCanvas, ctx2d } from '../core/canvas';
import { drawFrame } from '../core/render';
import { settings } from '../settings';
import { h } from '../ui/dom';
import type { Editor } from './editor';
import { EyedropperTool, FillTool, HandTool, StrokeTool, type Tool, type ToolPoint } from './tools';

const ONION_BEFORE = '#e5484d';
const ONION_AFTER = '#30a46c';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

interface TrackedPointer {
  x: number;
  y: number;
  type: string;
}

type Mode = 'idle' | 'draw' | 'gesture' | 'pan';

/**
 * The drawing surface: stacked canvases (onion, layers below, live layer,
 * layers above, playback) inside a pannable/zoomable viewport, plus all
 * pointer input routing.
 */
export class Stage {
  readonly el: HTMLElement;
  private stageEl: HTMLElement;
  private paper: HTMLElement;
  private onion: HTMLCanvasElement;
  private below: HTMLCanvasElement;
  private above: HTMLCanvasElement;
  private play: HTMLCanvasElement;
  private tmp: HTMLCanvasElement;
  private cursor: HTMLElement;

  zoom = 1;
  panX = 0;
  panY = 0;
  private fitted = true;

  private tools: Record<string, Tool>;
  private pointers = new Map<number, TrackedPointer>();
  private mode: Mode = 'idle';
  private drawPointer = -1;
  private drawStart = 0;
  private drawTool: Tool | null = null;
  private penSeen = false;
  spaceDown = false;
  // Gesture tracking
  private gPrev = { x: 0, y: 0, d: 0, n: 0 };
  private gStart = 0;
  private gMaxPointers = 0;
  private gMoved = 0;
  private panPrev = { x: 0, y: 0 };
  private offs: (() => void)[] = [];
  private resizeObs: ResizeObserver;

  onPick: (color: string, final: boolean) => void = () => {};
  onUndo: () => void = () => {};
  onRedo: () => void = () => {};
  onZoom: () => void = () => {};

  constructor(private ed: Editor) {
    const { width, height } = ed.project;
    const mk = (cls: string) => {
      const c = createCanvas(width, height) as HTMLCanvasElement;
      c.className = `layer-canvas ${cls}`;
      return c;
    };
    this.onion = mk('onion');
    this.below = mk('below');
    this.above = mk('above');
    this.play = mk('play');
    this.tmp = createCanvas(width, height) as HTMLCanvasElement;
    ed.liveCanvas.className = 'layer-canvas live';
    this.paper = h('div', { class: 'paper' });
    this.stageEl = h(
      'div',
      { class: 'stage', style: { width: `${width}px`, height: `${height}px` } },
      this.paper,
      this.below,
      this.onion,
      ed.liveCanvas,
      this.above,
      this.play,
    );
    this.cursor = h('div', { class: 'brush-cursor' });
    this.el = h('div', { class: 'viewport' }, this.stageEl, this.cursor);

    this.tools = {
      brush: new StrokeTool(ed, false),
      eraser: new StrokeTool(ed, true),
      fill: new FillTool(ed),
      eyedropper: new EyedropperTool(ed, (c, f) => this.onPick(c, f)),
      hand: new HandTool(),
    };

    const el = this.el;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', () => this.hideCursor());
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari: block native pinch-zoom and magnifier gestures on the canvas.
    el.addEventListener('gesturestart', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    this.resizeObs = new ResizeObserver(() => {
      if (this.fitted) this.fit();
      else this.apply();
    });
    this.resizeObs.observe(el);

    const ev = ed.events;
    this.offs.push(
      ev.on('live', () => this.renderAll()),
      ev.on('layers', () => this.renderAll()),
      ev.on('onion', () => this.renderOnion()),
      ev.on('project', () => this.renderPaper()),
      ev.on('playback', () => this.renderPlaybackMode()),
      ev.on('playhead', (i) => this.renderPlayFrame(i)),
      ev.on('tool', () => this.updateCursorStyle()),
      ev.on('content', ({ frameId }) => {
        if (frameId !== ed.frame.id) this.renderOnion();
      }),
    );
    this.renderPaper();
    this.updateCursorStyle();
  }

  // -------------------------------------------------------------------------
  // View transform

  fit(): void {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const { width, height } = this.ed.project;
    const pad = Math.min(32, r.width * 0.04);
    this.zoom = Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / width, (r.height - pad * 2) / height));
    this.panX = (r.width - width * this.zoom) / 2;
    this.panY = (r.height - height * this.zoom) / 2;
    this.fitted = true;
    this.apply();
  }

  zoomBy(factor: number, cx?: number, cy?: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(this.zoom * factor, cx ?? r.width / 2, cy ?? r.height / 2);
  }

  /** Sets zoom keeping the viewport point (vx, vy) fixed. */
  private zoomAt(z: number, vx: number, vy: number): void {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const px = (vx - this.panX) / this.zoom;
    const py = (vy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = vx - px * z;
    this.panY = vy - py * z;
    this.fitted = false;
    this.apply();
  }

  private apply(): void {
    this.stageEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.stageEl.classList.toggle('pixelated', this.zoom >= 3);
    this.onZoom();
  }

  private toProject(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: (clientX - r.left - this.panX) / this.zoom, y: (clientY - r.top - this.panY) / this.zoom };
  }

  // -------------------------------------------------------------------------
  // Rendering

  private renderPaper(): void {
    this.paper.style.background = this.ed.project.background;
  }

  /** Redraws everything around the live canvas for the current frame. */
  renderAll(): void {
    const ed = this.ed;
    const { width, height } = ed.project;
    const li = ed.layerIndex;
    const layer = ed.layer;
    for (const [canvas, from, to] of [
      [this.below, 0, li],
      [this.above, li + 1, ed.project.layers.length],
    ] as const) {
      const ctx = ctx2d(canvas);
      ctx.clearRect(0, 0, width, height);
      drawFrame(ctx, ed.project, ed.frame, ed.store, { from, to });
    }
    ed.liveCanvas.style.opacity = String(layer.opacity);
    ed.liveCanvas.style.visibility = layer.visible ? 'visible' : 'hidden';
    this.renderOnion();
  }

  renderOnion(): void {
    const ed = this.ed;
    const { width, height } = ed.project;
    const ctx = ctx2d(this.onion);
    ctx.clearRect(0, 0, width, height);
    const o = ed.onion;
    if (!o.enabled || ed.playing || !ed.layer.visible) return;
    // Tinted drawings of the current layer on neighbouring frames, placed
    // right under the live layer so opaque backgrounds never hide them.
    const draw = (index: number, color: string, alpha: number) => {
      const cell = ed.project.frames[index]?.cells[ed.layerId];
      const src = cell ? ed.store.source(cell) : null;
      if (!src || alpha <= 0) return;
      const t = ctx2d(this.tmp);
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, width, height);
      t.drawImage(src.src, src.rect.x, src.rect.y);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = color;
      t.fillRect(0, 0, width, height);
      t.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.tmp, 0, 0);
    };
    // Farther frames first so nearer ones end up on top.
    for (let k = o.before; k >= 1; k--) draw(ed.frameIndex - k, ONION_BEFORE, o.opacity * (1 - (k - 1) / (o.before + 1)));
    for (let k = o.after; k >= 1; k--) draw(ed.frameIndex + k, ONION_AFTER, o.opacity * (1 - (k - 1) / (o.after + 1)));
    ctx.globalAlpha = 1;
  }

  private renderPlaybackMode(): void {
    const playing = this.ed.playing;
    this.stageEl.classList.toggle('playing', playing);
    if (playing) {
      this.cancelDraw();
      this.renderPlayFrame(this.ed.frameIndex);
    } else {
      this.renderAll();
    }
  }

  private renderPlayFrame(index: number): void {
    const ed = this.ed;
    const frame = ed.project.frames[index];
    if (!frame) return;
    const ctx = ctx2d(this.play);
    const { width, height } = ed.project;
    ctx.clearRect(0, 0, width, height);
    drawFrame(ctx, ed.project, frame, ed.store);
  }

  // -------------------------------------------------------------------------
  // Pointer input

  private penOnly(): boolean {
    return settings.penMode === 'pen' || (settings.penMode === 'auto' && this.penSeen);
  }

  private sample(e: PointerEvent): ToolPoint {
    const p = this.toProject(e.clientX, e.clientY);
    return { x: p.x, y: p.y, pressure: e.pressure, pointerType: e.pointerType };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') this.penSeen = true;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer may already be gone.
    }
    const touch = e.pointerType === 'touch';

    if (this.mode === 'gesture') {
      if (touch) this.resetGesture();
      return;
    }
    if (this.mode === 'draw') {
      // A second finger right after the first means pinch, not a stroke.
      const drawer = this.pointers.get(this.drawPointer);
      if (touch && drawer?.type === 'touch' && performance.now() - this.drawStart < 300) {
        this.cancelDraw();
        this.startGesture();
      }
      return;
    }
    if (this.mode === 'pan') {
      if (touch) {
        this.el.classList.remove('panning');
        this.startGesture();
      }
      return;
    }

    if (this.ed.playing) return;
    if (touch && (this.penOnly() || this.touchCount() >= 2)) {
      this.startGesture();
      return;
    }
    if (
      (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) ||
      this.spaceDown ||
      this.ed.tool === 'hand'
    ) {
      this.mode = 'pan';
      this.panPrev = { x: e.clientX, y: e.clientY };
      this.el.classList.add('panning');
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.mode = 'draw';
    this.drawPointer = e.pointerId;
    this.drawStart = performance.now();
    this.drawTool = this.tools[this.ed.tool];
    this.drawTool.down(this.sample(e));
    this.updateCursor(e);
  };

  private onMove = (e: PointerEvent): void => {
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }
    if (this.mode === 'draw' && e.pointerId === this.drawPointer) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      this.drawTool?.move(list.map((ev) => this.sample(ev)));
      this.updateCursor(e);
    } else if (this.mode === 'gesture') {
      this.moveGesture();
    } else if (this.mode === 'pan') {
      this.panX += e.clientX - this.panPrev.x;
      this.panY += e.clientY - this.panPrev.y;
      this.panPrev = { x: e.clientX, y: e.clientY };
      this.fitted = false;
      this.apply();
    } else if (e.pointerType !== 'touch') {
      this.updateCursor(e);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.endPointer(e, false);
  };

  private onCancel = (e: PointerEvent): void => {
    this.endPointer(e, true);
  };

  private endPointer(e: PointerEvent, cancelled: boolean): void {
    const had = this.pointers.delete(e.pointerId);
    if (this.mode === 'draw' && e.pointerId === this.drawPointer) {
      // A cancelled pointer still keeps what was drawn so far.
      void cancelled;
      this.drawTool?.up(this.sample(e));
      this.drawTool = null;
      this.drawPointer = -1;
      this.mode = 'idle';
      if (e.pointerType === 'touch') this.hideCursor();
    } else if (this.mode === 'gesture' && had) {
      if (this.touchCount() === 0) this.endGesture();
      else this.resetGesture();
    } else if (this.mode === 'pan' && this.pointers.size === 0) {
      this.mode = 'idle';
      this.el.classList.remove('panning');
    }
  }

  /** Aborts an in-progress stroke without keeping it. */
  cancelDraw(): void {
    if (this.mode === 'draw') {
      this.drawTool?.cancel();
      this.drawTool = null;
      this.drawPointer = -1;
      this.mode = 'idle';
    }
  }

  private touchCount(): number {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === 'touch') n++;
    return n;
  }

  private gestureCenter(): { x: number; y: number; d: number; n: number } {
    const r = this.el.getBoundingClientRect();
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of this.pointers.values()) {
      if (p.type !== 'touch') continue;
      x += p.x;
      y += p.y;
      n++;
    }
    if (!n) return { x: 0, y: 0, d: 0, n: 0 };
    x /= n;
    y /= n;
    let d = 0;
    for (const p of this.pointers.values()) if (p.type === 'touch') d += Math.hypot(p.x - x, p.y - y);
    return { x: x - r.left, y: y - r.top, d: n > 1 ? d / n : 0, n };
  }

  private startGesture(): void {
    this.mode = 'gesture';
    this.gStart = performance.now();
    this.gMaxPointers = 0;
    this.gMoved = 0;
    this.hideCursor();
    this.resetGesture();
  }

  private resetGesture(): void {
    this.gPrev = this.gestureCenter();
    this.gMaxPointers = Math.max(this.gMaxPointers, this.gPrev.n);
  }

  private moveGesture(): void {
    const c = this.gestureCenter();
    if (!c.n) return;
    if (c.n !== this.gPrev.n) {
      this.resetGesture();
      return;
    }
    const dx = c.x - this.gPrev.x;
    const dy = c.y - this.gPrev.y;
    this.gMoved += Math.hypot(dx, dy) + Math.abs(c.d - this.gPrev.d);
    this.panX += dx;
    this.panY += dy;
    this.fitted = false;
    if (c.n > 1 && this.gPrev.d > 0 && c.d > 0) this.zoomAt(this.zoom * (c.d / this.gPrev.d), c.x, c.y);
    else this.apply();
    this.gPrev = c;
  }

  private endGesture(): void {
    this.mode = 'idle';
    const quick = performance.now() - this.gStart < 350 && this.gMoved < 20;
    if (quick && this.gMaxPointers === 2) this.onUndo();
    else if (quick && this.gMaxPointers === 3) this.onRedo();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.panX -= e.deltaX * k;
      this.panY -= e.deltaY * k;
      this.fitted = false;
      this.apply();
    }
  };

  // -------------------------------------------------------------------------
  // Brush cursor

  private updateCursorStyle(): void {
    const tool = this.ed.tool;
    this.el.dataset.tool = tool;
    if (tool !== 'brush' && tool !== 'eraser') this.hideCursor();
  }

  private updateCursor(e: PointerEvent): void {
    const tool = this.ed.tool;
    if ((tool !== 'brush' && tool !== 'eraser') || e.pointerType === 'touch' || this.ed.playing) {
      this.hideCursor();
      return;
    }
    const size = (tool === 'eraser' ? this.ed.eraser.size : this.ed.brush.size) * this.zoom;
    const r = this.el.getBoundingClientRect();
    const s = this.cursor.style;
    s.display = 'block';
    s.width = s.height = `${Math.max(4, size)}px`;
    s.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) translate(-50%, -50%)`;
  }

  private hideCursor(): void {
    this.cursor.style.display = 'none';
  }

  dispose(): void {
    this.resizeObs.disconnect();
    for (const off of this.offs) off();
  }
}
