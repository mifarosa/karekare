import { createCanvas, ctx2d, releaseCanvas } from '../core/canvas';
import { t } from '../i18n';
import { inflate } from '../model/rect';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import type { Editor } from './editor';
import type { PlaceContent } from './placeContent';
import { applyPlacement, placementBounds, snapAngle, type Placement } from './placement';
import type { Stage } from './stage';

export interface PlaceOptions {
  /** Initial scale; defaults to fitting half of the canvas. */
  scale?: number;
  /** Extra controls shown in the bar (e.g. text input). */
  controls?: HTMLElement;
  onEnd?: (committed: boolean) => void;
}

type Drag =
  | { kind: 'move'; x: number; y: number; cx: number; cy: number }
  | { kind: 'pinch'; d: number; a: number; mx: number; my: number; p: Placement }
  | { kind: 'scale'; d: number; scale: number }
  | { kind: 'rotate'; a: number; rotation: number };

const MIN_SIDE = 8;
let hintShown = false;

/**
 * Lets the user move, resize and rotate an object (text or photo) over the
 * current layer before it is drawn into it. While active, a transparent
 * shield takes all pointer input on the canvas, and the bar with the
 * object's controls covers the tool options strip (never the canvas).
 */
export class Placer {
  private content: PlaceContent | null = null;
  private opts: PlaceOptions = {};
  private p: Placement = { cx: 0, cy: 0, scale: 1, rotation: 0 };
  private overlay: HTMLCanvasElement | null = null;
  private shield: HTMLElement;
  private box: HTMLElement;
  private bar: HTMLElement;
  private slot: HTMLElement;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: Drag | null = null;
  private raf = 0;
  private offs: (() => void)[] = [];

  constructor(
    private ed: Editor,
    private stage: Stage,
    private host: HTMLElement,
  ) {
    const handle = (cls: string, kind: 'scale' | 'rotate') => {
      const el = h('div', { class: `ph ${cls}` });
      el.addEventListener('pointerdown', (e) => this.onHandleDown(e, kind));
      el.addEventListener('pointermove', (e) => this.onHandleMove(e));
      el.addEventListener('pointerup', (e) => this.onHandleUp(e));
      el.addEventListener('pointercancel', (e) => this.onHandleUp(e));
      return el;
    };
    this.box = h(
      'div',
      { class: 'placer-box', hidden: true },
      h('div', { class: 'ph-stem' }),
      handle('ph-rotate', 'rotate'),
      handle('ph-tl', 'scale'),
      handle('ph-tr', 'scale'),
      handle('ph-br', 'scale'),
      handle('ph-bl', 'scale'),
    );
    this.box.querySelector('.ph-rotate')!.append(icon('rotate', 14));
    this.shield = h('div', { class: 'placer-shield', hidden: true });
    this.shield.addEventListener('pointerdown', this.onDown);
    this.shield.addEventListener('pointermove', this.onMove);
    this.shield.addEventListener('pointerup', this.onUp);
    this.shield.addEventListener('pointercancel', this.onUp);
    stage.el.append(this.shield, this.box);

    this.slot = h('div', { class: 'placer-controls' });
    this.bar = h(
      'div',
      { class: 'placer-bar', hidden: true },
      this.slot,
      h(
        'div',
        { class: 'placer-actions' },
        h('button', { class: 'btn', title: t('cancel'), 'aria-label': t('cancel'), onclick: () => this.cancel() }, icon('close', 18), h('span', null, t('cancel'))),
        h(
          'button',
          { class: 'btn btn-primary', title: t('placeDone'), 'aria-label': t('placeDone'), onclick: () => this.commit() },
          icon('check', 18),
          h('span', null, t('placeDone')),
        ),
      ),
    );
    host.append(this.bar);

    this.offs.push(
      stage.onView(() => this.position()),
      // Navigating away or playing first draws the object into its cell.
      ed.onLeave(() => {
        if (this.active) this.commit();
      }),
    );
  }

  get active(): boolean {
    return this.content !== null;
  }

  /** Starts placing `content` in the middle of the visible canvas. */
  start(content: PlaceContent, opts: PlaceOptions = {}): boolean {
    if (this.active) this.commit();
    const blocker = this.ed.editBlocker();
    if (blocker || this.ed.playing) {
      if (blocker) this.ed.events.emit('notice', blocker);
      content.dispose();
      return false;
    }
    const { width, height } = this.ed.project;
    const c = this.stage.viewCenter();
    this.content = content;
    this.opts = opts;
    this.p = {
      cx: c.x,
      cy: c.y,
      scale: opts.scale ?? Math.min((width * 0.5) / content.width, (height * 0.5) / content.height),
      rotation: 0,
    };
    this.overlay = createCanvas(width, height) as HTMLCanvasElement;
    this.overlay.classList.add('placing');
    this.overlay.style.opacity = String(this.ed.layer.opacity);
    this.stage.addOverlay(this.overlay);
    this.slot.replaceChildren(...(opts.controls ? [opts.controls] : []));
    this.shield.hidden = this.box.hidden = this.bar.hidden = false;
    // The bar sits inside the (scrollable) options strip; pin that strip in place.
    this.host.scrollLeft = 0;
    this.host.classList.add('placing');
    this.update();
    if (!hintShown) {
      hintShown = true;
      toast(t('placeHint'), { duration: 5000 });
    }
    return true;
  }

  /** Redraws after the content changed (e.g. edited text). */
  update(): void {
    if (!this.content) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  /** Draws the object into the current layer as one undo step. */
  commit(): boolean {
    const content = this.content;
    if (!content) return false;
    const empty = (content as { isEmpty?: boolean }).isEmpty === true;
    const rect = inflate(placementBounds(this.p, content.width, content.height), 2);
    const p = { ...this.p };
    const ok =
      !empty &&
      this.ed.drawOnLive(rect, (ctx) => {
        applyPlacement(ctx, p, content.width, content.height);
        content.draw(ctx);
      });
    this.finish(ok);
    return ok;
  }

  cancel(): void {
    if (this.content) this.finish(false);
  }

  private finish(committed: boolean): void {
    cancelAnimationFrame(this.raf);
    this.content?.dispose();
    this.content = null;
    this.drag = null;
    this.pointers.clear();
    if (this.overlay) {
      this.overlay.remove();
      releaseCanvas(this.overlay);
      this.overlay = null;
    }
    this.shield.hidden = this.box.hidden = this.bar.hidden = true;
    this.host.classList.remove('placing');
    this.slot.replaceChildren();
    const onEnd = this.opts.onEnd;
    this.opts = {};
    onEnd?.(committed);
  }

  private render(): void {
    const content = this.content;
    const overlay = this.overlay;
    if (!content || !overlay) return;
    const ctx = ctx2d(overlay);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.save();
    applyPlacement(ctx, this.p, content.width, content.height);
    content.draw(ctx);
    ctx.restore();
    this.position();
  }

  /** Puts the handle box over the object, in viewport pixels. */
  private position(): void {
    const content = this.content;
    if (!content) return;
    const z = this.stage.zoom;
    const c = this.stage.toViewport(this.p.cx, this.p.cy);
    const w = content.width * this.p.scale * z;
    const hgt = content.height * this.p.scale * z;
    const s = this.box.style;
    s.width = `${w}px`;
    s.height = `${hgt}px`;
    s.transform = `translate(${c.x - w / 2}px, ${c.y - hgt / 2}px) rotate(${this.p.rotation}rad)`;
  }

  // -------------------------------------------------------------------------
  // Input

  /** Center of the object in client (page) coordinates. */
  private centerClient(): { x: number; y: number } {
    const r = this.stage.el.getBoundingClientRect();
    const c = this.stage.toViewport(this.p.cx, this.p.cy);
    return { x: r.left + c.x, y: r.top + c.y };
  }

  private clampScale(scale: number): number {
    const content = this.content!;
    const { width, height } = this.ed.project;
    const min = MIN_SIDE / Math.min(content.width, content.height);
    const max = (4 * Math.max(width, height)) / Math.max(content.width, content.height);
    return Math.min(max, Math.max(min, scale));
  }

  private onDown = (e: PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    try {
      this.shield.setPointerCapture(e.pointerId);
    } catch {
      // Ignore.
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.resetDrag();
  };

  private onMove = (e: PointerEvent): void => {
    e.stopPropagation();
    const pt = this.pointers.get(e.pointerId);
    if (!pt || !this.drag) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    const z = this.stage.zoom;
    const d = this.drag;
    if (d.kind === 'move') {
      this.p.cx = d.cx + (pt.x - d.x) / z;
      this.p.cy = d.cy + (pt.y - d.y) / z;
    } else if (d.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.p.scale = this.clampScale(d.p.scale * (dist / d.d));
      this.p.rotation = snapAngle(d.p.rotation + ang - d.a);
      this.p.cx = d.p.cx + ((a.x + b.x) / 2 - d.mx) / z;
      this.p.cy = d.p.cy + ((a.y + b.y) / 2 - d.my) / z;
    }
    this.update();
  };

  private onUp = (e: PointerEvent): void => {
    e.stopPropagation();
    this.pointers.delete(e.pointerId);
    this.resetDrag();
  };

  /** Re-baselines the gesture whenever the number of fingers changes. */
  private resetDrag(): void {
    const pts = [...this.pointers.values()];
    if (pts.length === 0) {
      this.drag = null;
    } else if (pts.length === 1) {
      this.drag = { kind: 'move', x: pts[0].x, y: pts[0].y, cx: this.p.cx, cy: this.p.cy };
    } else {
      const [a, b] = pts;
      this.drag = {
        kind: 'pinch',
        d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        a: Math.atan2(b.y - a.y, b.x - a.x),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        p: { ...this.p },
      };
    }
  }

  private onHandleDown(e: PointerEvent, kind: 'scale' | 'rotate'): void {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Ignore.
    }
    const c = this.centerClient();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    this.drag =
      kind === 'scale'
        ? { kind: 'scale', d: Math.max(1, Math.hypot(dx, dy)), scale: this.p.scale }
        : { kind: 'rotate', a: Math.atan2(dy, dx), rotation: this.p.rotation };
  }

  private onHandleMove(e: PointerEvent): void {
    e.stopPropagation();
    const d = this.drag;
    if (!d || (d.kind !== 'scale' && d.kind !== 'rotate')) return;
    const c = this.centerClient();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    if (d.kind === 'scale') this.p.scale = this.clampScale(d.scale * (Math.hypot(dx, dy) / d.d));
    else this.p.rotation = snapAngle(d.rotation + Math.atan2(dy, dx) - d.a);
    this.update();
  }

  private onHandleUp(e: PointerEvent): void {
    e.stopPropagation();
    this.drag = null;
    this.resetDrag();
  }

  dispose(): void {
    this.cancel();
    for (const off of this.offs) off();
    this.shield.remove();
    this.box.remove();
    this.bar.remove();
  }
}
