import { BRUSHES, brushDef, createStroke, type BrushKind } from '../core/brushes';
import { ctx2d } from '../core/canvas';
import { t, type StringKey } from '../i18n';
import { saveSettings, settings } from '../settings';
import { h } from '../ui/dom';
import { closePopover, popover } from '../ui/popover';
import type { Editor } from './editor';

export const BRUSH_NAMES: Record<BrushKind, StringKey> = {
  pen: 'brushPen',
  pencil: 'brushPencil',
  marker: 'brushMarker',
  paint: 'brushPaint',
  highlighter: 'brushHighlighter',
  crayon: 'brushCrayon',
  chalk: 'brushChalk',
  neon: 'brushNeon',
  calligraphy: 'brushCalligraphy',
  spray: 'brushSpray',
  rainbow: 'brushRainbow',
  dots: 'brushDots',
  stars: 'brushStars',
  hearts: 'brushHearts',
  bubbles: 'brushBubbles',
  confetti: 'brushConfetti',
};

/** A sample stroke drawn with the real brush engine. */
export function brushPreview(kind: BrushKind, color: string, cssWidth: number, cssHeight: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssWidth * dpr);
  const hgt = Math.round(cssHeight * dpr);
  const canvas = h('canvas', { class: 'brush-preview', width: w, height: hgt });
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = ctx2d(canvas);
  const def = brushDef(kind);
  // Small enough that patterned brushes show several marks, big enough to read.
  const size = Math.min(def.size * dpr, hgt * (kind === 'spray' ? 0.55 : kind === 'bubbles' ? 0.5 : 0.32));
  const stroke = createStroke(
    { kind, color, size, opacity: def.opacity, smoothing: 0, pressure: true, width: w, height: hgt, seed: 7 },
    ctx,
  );
  const pad = Math.min(size * 0.8 + 4, w * 0.12);
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = pad + (w - pad * 2) * t;
    const y = hgt / 2 + Math.sin(t * Math.PI * 2) * (hgt / 2 - pad) * 0.6;
    // Pressure swells in the middle, like a real stroke.
    stroke.push([x, y, 0.25 + 0.75 * Math.sin(t * Math.PI)]);
  }
  stroke.draw(ctx, (r) => ctx.clearRect(r.x, r.y, r.w, r.h), true);
  return canvas;
}

/** Switches brush, remembering size and opacity per brush. */
export function selectBrush(ed: Editor, kind: BrushKind): void {
  const b = ed.brush;
  if (b.kind === kind) return;
  settings.brushPresets[b.kind] = { size: b.size, opacity: b.opacity };
  const def = brushDef(kind);
  const preset = settings.brushPresets[kind] ?? { size: def.size, opacity: def.opacity };
  b.kind = kind;
  b.size = Math.min(def.maxSize, Math.max(1, preset.size));
  b.opacity = Math.min(1, Math.max(0.05, preset.opacity));
  settings.brush = { ...b };
  saveSettings();
  if (ed.tool !== 'brush') ed.tool = 'brush';
  ed.events.emit('tool');
}

export function openBrushPicker(anchor: HTMLElement, ed: Editor, side: 'right' | 'left' | 'bottom' = 'bottom'): void {
  const grid = h('div', { class: 'brush-grid', role: 'listbox', 'aria-label': t('brushes') });
  for (const def of BRUSHES) {
    const active = def.kind === ed.brush.kind;
    grid.append(
      h(
        'button',
        {
          class: `brush-card ${active ? 'active' : ''}`,
          role: 'option',
          'aria-selected': String(active),
          title: t(BRUSH_NAMES[def.kind]),
          onclick: () => {
            selectBrush(ed, def.kind);
            closePopover();
          },
        },
        brushPreview(def.kind, ed.color, 84, 40),
        h('span', null, t(BRUSH_NAMES[def.kind])),
      ),
    );
  }
  popover(anchor, h('div', { class: 'brush-pop' }, h('div', { class: 'menu-title' }, t('brushes')), grid), { side, className: 'popover-wide' });
}
