import { brushDef } from '../core/brushes';
import { t, type StringKey } from '../i18n';
import { saveSettings, settings } from '../settings';
import { clear, h } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import { BRUSH_NAMES, brushPreview, openBrushPicker } from './brushPicker';
import type { Editor, ToolId } from './editor';

export const PALETTE = [
  '#1f2430', '#5b6170', '#a0a6b4', '#ffffff',
  '#e5484d', '#f76b15', '#ffc53d', '#8bd448',
  '#30a46c', '#12a594', '#00a2c7', '#3e63dd',
  '#5b5bd6', '#8e4ec6', '#d6409f', '#8d5b3a',
  '#ffdbac', '#f1c27d', '#c68642', '#8d5524',
  '#ffd6e7', '#c9f2ff', '#d9f99d', '#fff3b0',
];

const TOOLS: { id: ToolId; icon: IconName; label: StringKey; key: string }[] = [
  { id: 'brush', icon: 'brush', label: 'toolBrush', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'toolEraser', key: 'E' },
  { id: 'fill', icon: 'fill', label: 'toolFill', key: 'G' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'toolEyedropper', key: 'I' },
  { id: 'hand', icon: 'hand', label: 'toolHand', key: 'H' },
];

export interface ToolbarActions {
  onText: () => void;
  onPhoto: (anchor: HTMLElement) => void;
}

/** Vertical tool palette with the color swatch and insert buttons. */
export class Toolbar {
  readonly el: HTMLElement;
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private swatch: HTMLButtonElement;
  private offs: (() => void)[] = [];

  constructor(
    private ed: Editor,
    actions: ToolbarActions,
  ) {
    this.el = h('nav', { class: 'toolbar', 'aria-label': t('tools') });
    for (const tool of TOOLS) {
      const label = `${t(tool.label)} (${tool.key})`;
      const b: HTMLButtonElement = h(
        'button',
        {
          class: 'tool-btn',
          title: label,
          'aria-label': label,
          onclick: () => {
            // Tapping the brush again opens the brush picker.
            if (tool.id === 'brush' && ed.tool === 'brush') openBrushPicker(b, ed, settings.leftHanded ? 'left' : 'right');
            else ed.setTool(tool.id);
          },
        },
        icon(tool.icon, 22),
      );
      this.buttons.set(tool.id, b);
      this.el.append(b);
    }
    this.swatch = h(
      'button',
      {
        class: 'swatch-btn',
        title: t('color'),
        'aria-label': t('color'),
        onclick: () => this.openColors(),
      },
      h('span', { class: 'swatch-dot' }),
    );
    const textBtn = h(
      'button',
      { class: 'tool-btn', title: `${t('addText')} (T)`, 'aria-label': t('addText'), onclick: () => actions.onText() },
      icon('text', 22),
    );
    const photoBtn: HTMLButtonElement = h(
      'button',
      { class: 'tool-btn', title: t('addPhoto'), 'aria-label': t('addPhoto'), onclick: () => actions.onPhoto(photoBtn) },
      icon('image', 22),
    );
    this.el.append(h('div', { class: 'toolbar-sep' }), this.swatch, h('div', { class: 'toolbar-sep' }), textBtn, photoBtn);
    this.offs.push(ed.events.on('tool', () => this.update()));
    this.update();
  }

  update(): void {
    for (const [id, b] of this.buttons) {
      b.classList.toggle('active', id === this.ed.tool);
      b.setAttribute('aria-pressed', String(id === this.ed.tool));
    }
    (this.swatch.firstElementChild as HTMLElement).style.background = this.ed.color;
  }

  openColors(): void {
    const ed = this.ed;
    const pick = (c: string) => {
      setColor(ed, c);
      closePopover();
    };
    const swatch = (c: string) =>
      h('button', {
        class: `color-swatch ${c.toLowerCase() === ed.color.toLowerCase() ? 'active' : ''}`,
        style: { background: c },
        title: c,
        'aria-label': c,
        onclick: () => pick(c),
      });
    const custom = h('input', { type: 'color', value: ed.color, class: 'color-input', 'aria-label': t('customColor') });
    custom.addEventListener('input', () => setColor(ed, custom.value, false));
    custom.addEventListener('change', () => setColor(ed, custom.value));
    const content = h(
      'div',
      { class: 'color-pop' },
      h('div', { class: 'color-grid' }, ...PALETTE.map(swatch)),
      settings.recentColors.length
        ? h('div', null, h('div', { class: 'menu-title' }, t('recentColors')), h('div', { class: 'color-grid' }, ...settings.recentColors.map(swatch)))
        : null,
      h('label', { class: 'color-custom' }, custom, h('span', null, t('customColor'))),
    );
    popover(this.swatch, content, { side: settings.leftHanded ? 'left' : 'right' });
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}

/** Sets the drawing color; `remember` adds it to recent colors and leaves non-painting tools. */
export function setColor(ed: Editor, color: string, remember = true): void {
  ed.color = color;
  settings.color = color;
  if (remember) {
    const lower = color.toLowerCase();
    if (!PALETTE.includes(lower)) {
      settings.recentColors = [lower, ...settings.recentColors.filter((c) => c !== lower)].slice(0, 8);
    }
  }
  saveSettings();
  if (remember && (ed.tool === 'eraser' || ed.tool === 'hand')) ed.tool = 'brush';
  ed.events.emit('tool');
}

/** Context-sensitive options for the current tool (size, opacity, ...). */
export class OptionsBar {
  readonly el: HTMLElement;
  private offs: (() => void)[] = [];

  constructor(private ed: Editor) {
    this.el = h('div', { class: 'optionsbar' });
    this.offs.push(ed.events.on('tool', () => this.render()));
    this.render();
  }

  private render(): void {
    const ed = this.ed;
    clear(this.el);
    const persist = () => {
      settings.brush = { ...ed.brush };
      settings.eraser = { ...ed.eraser };
      settings.fill = { ...ed.fill };
      saveSettings();
    };
    switch (ed.tool) {
      case 'brush': {
        const chip: HTMLButtonElement = h(
          'button',
          {
            class: 'brush-chip',
            title: t('chooseBrush'),
            'aria-label': t('chooseBrush'),
            onclick: () => openBrushPicker(chip, ed, 'bottom'),
          },
          brushPreview(ed.brush.kind, ed.color, 52, 26),
          h('span', null, t(BRUSH_NAMES[ed.brush.kind])),
          icon('chevronDown', 16),
        );
        this.el.append(
          chip,
          slider(t('size'), 1, brushDef(ed.brush.kind).maxSize, ed.brush.size, (v) => {
            ed.brush.size = v;
            persist();
          }, (v) => `${v}px`, sizePreview(ed)),
          slider(t('opacity'), 5, 100, Math.round(ed.brush.opacity * 100), (v) => {
            ed.brush.opacity = v / 100;
            persist();
          }, (v) => `${v}%`),
          slider(t('smoothing'), 0, 100, Math.round(ed.brush.smoothing * 100), (v) => {
            ed.brush.smoothing = v / 100;
            persist();
          }, (v) => `${v}%`),
        );
        break;
      }
      case 'eraser':
        this.el.append(
          slider(t('size'), 2, 200, ed.eraser.size, (v) => {
            ed.eraser.size = v;
            persist();
          }, (v) => `${v}px`),
        );
        break;
      case 'fill':
        this.el.append(
          slider(t('tolerance'), 0, 100, ed.fill.tolerance, (v) => {
            ed.fill.tolerance = v;
            persist();
          }, (v) => `${v}%`),
          slider(t('fillExpand'), 0, 4, ed.fill.expand, (v) => {
            ed.fill.expand = v;
            persist();
          }, (v) => `${v}px`),
          toggle(t('sampleAllLayers'), ed.fill.sampleAll, (v) => {
            ed.fill.sampleAll = v;
            persist();
          }),
        );
        break;
      case 'eyedropper':
        this.el.append(h('span', { class: 'hint' }, t('hintEyedropper')));
        break;
      case 'hand':
        this.el.append(h('span', { class: 'hint' }, t('hintHand')));
        break;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}

function sizePreview(ed: Editor): HTMLElement {
  const dot = h('span', { class: 'size-dot' });
  const update = () => {
    const d = Math.max(2, Math.min(28, ed.brush.size));
    dot.style.width = dot.style.height = `${d}px`;
    dot.style.background = ed.color;
  };
  update();
  dot.addEventListener('refresh', update);
  return dot;
}

export function slider(
  label: string,
  min: number,
  max: number,
  value: number,
  onChange: (v: number) => void,
  format: (v: number) => string,
  extra?: HTMLElement,
): HTMLElement {
  const input = h('input', { type: 'range', min, max, step: 1, value: String(value), class: 'slider', 'aria-label': label });
  const out = h('span', { class: 'slider-value' }, format(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
    extra?.dispatchEvent(new Event('refresh'));
  });
  return h('label', { class: 'opt' }, h('span', { class: 'opt-label' }, label), input, out, extra ?? null);
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'switch', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'opt opt-toggle' }, input, h('span', null, label));
}

export function segmented(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    const b = h(
      'button',
      {
        class: o.value === value ? 'active' : '',
        role: 'radio',
        'aria-checked': String(o.value === value),
        onclick: () => {
          for (const c of wrap.children) {
            c.classList.remove('active');
            c.setAttribute('aria-checked', 'false');
          }
          b.classList.add('active');
          b.setAttribute('aria-checked', 'true');
          onChange(o.value);
        },
      },
      o.label,
    );
    wrap.append(b);
  }
  return wrap;
}
