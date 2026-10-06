import { ctx2d } from '../core/canvas';
import { t } from '../i18n';
import type { Layer } from '../model/types';
import { clear, h } from '../ui/dom';
import { promptDialog } from '../ui/dialog';
import { icon } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import type { Editor } from './editor';

const THUMB = 36;

/** Layer list for the current frame: select, show/hide, lock, reorder. */
export class LayersPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows = new Map<string, { row: HTMLElement; thumb: HTMLCanvasElement }>();
  private offs: (() => void)[] = [];
  private thumbTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private ed: Editor) {
    const btn = (name: Parameters<typeof icon>[0], label: string, onclick: () => void) =>
      h('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick }, icon(name, 18));
    this.list = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': t('layers') });
    this.el = h(
      'div',
      { class: 'layers-panel' },
      h('div', { class: 'panel-head' }, icon('layers', 18), h('span', null, t('layers'))),
      this.list,
      h(
        'div',
        { class: 'panel-foot' },
        btn('plus', t('addLayer'), () => ed.addLayer()),
        btn('copy', t('duplicateLayer'), () => ed.duplicateLayer(t('copySuffix'))),
        btn('arrowUp', t('moveUp'), () => ed.moveLayer(ed.layerId, 1)),
        btn('arrowDown', t('moveDown'), () => ed.moveLayer(ed.layerId, -1)),
        btn('trash', t('deleteLayer'), () => ed.deleteLayer()),
      ),
    );
    const ev = ed.events;
    this.offs.push(
      ev.on('structure', () => this.render()),
      ev.on('layers', () => this.render()),
      ev.on('current', () => this.updateSelection()),
      ev.on('live', () => this.scheduleThumbs()),
      ev.on('content', () => this.scheduleThumbs()),
    );
    this.render();
  }

  render(): void {
    const ed = this.ed;
    clear(this.list);
    this.rows.clear();
    const layers = [...ed.project.layers].reverse();
    for (const layer of layers) {
      const thumb = h('canvas', { class: 'layer-thumb', width: THUMB * 2, height: THUMB * 2 });
      const row = h(
        'div',
        {
          class: `layer-row ${layer.visible ? '' : 'hidden-layer'}`,
          role: 'option',
          dataset: { id: layer.id },
          onclick: () => ed.selectLayer(layer.id),
          ondblclick: () => this.rename(layer),
        },
        h(
          'button',
          {
            class: 'icon-btn small',
            title: layer.visible ? t('hideLayer') : t('showLayer'),
            'aria-label': layer.visible ? t('hideLayer') : t('showLayer'),
            onclick: (e: Event) => {
              e.stopPropagation();
              ed.setLayerProps(layer.id, { visible: !layer.visible });
            },
          },
          icon(layer.visible ? 'eye' : 'eyeOff', 18),
        ),
        thumb,
        h('span', { class: 'layer-name' }, layer.name, layer.opacity < 1 ? h('small', null, ` ${Math.round(layer.opacity * 100)}%`) : null),
        layer.locked ? h('span', { class: 'layer-badge', title: t('locked') }, icon('lock', 14)) : null,
        h(
          'button',
          {
            class: 'icon-btn small',
            title: t('layerOptions'),
            'aria-label': t('layerOptions'),
            onclick: (e: Event) => {
              e.stopPropagation();
              ed.selectLayer(layer.id);
              this.options(e.currentTarget as HTMLElement, layer);
            },
          },
          icon('more', 18),
        ),
      );
      this.rows.set(layer.id, { row, thumb });
      this.list.append(row);
    }
    this.updateSelection();
    this.scheduleThumbs();
  }

  private updateSelection(): void {
    for (const [id, { row }] of this.rows) {
      const sel = id === this.ed.layerId;
      row.classList.toggle('selected', sel);
      row.setAttribute('aria-selected', String(sel));
    }
    this.scheduleThumbs();
  }

  private scheduleThumbs(): void {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => this.drawThumbs(), 120);
  }

  private drawThumbs(): void {
    const ed = this.ed;
    const p = ed.project;
    const frame = ed.frame;
    const size = THUMB * 2;
    const s = Math.min(size / p.width, size / p.height);
    const ox = (size - p.width * s) / 2;
    const oy = (size - p.height * s) / 2;
    for (const layer of p.layers) {
      const entry = this.rows.get(layer.id);
      if (!entry) continue;
      const ctx = ctx2d(entry.thumb);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = p.background;
      ctx.fillRect(ox, oy, p.width * s, p.height * s);
      const cell = frame.cells[layer.id];
      const src = cell ? ed.store.source(cell) : null;
      if (src) {
        ctx.setTransform(s, 0, 0, s, ox, oy);
        ctx.drawImage(src.src, src.rect.x, src.rect.y);
      }
    }
  }

  private options(anchor: HTMLElement, layer: Layer): void {
    const ed = this.ed;
    const opacity = h('input', {
      type: 'range',
      min: 0,
      max: 100,
      value: String(Math.round(layer.opacity * 100)),
      class: 'slider',
      'aria-label': t('opacity'),
    });
    const opacityValue = h('span', { class: 'slider-value' }, `${Math.round(layer.opacity * 100)}%`);
    opacity.addEventListener('input', () => {
      opacityValue.textContent = `${opacity.value}%`;
      ed.setLayerProps(layer.id, { opacity: Number(opacity.value) / 100 });
    });
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
    const layers = ed.project.layers;
    const idx = layers.indexOf(layer);
    const menu = h(
      'div',
      { class: 'menu' },
      h('div', { class: 'menu-title' }, layer.name),
      h('label', { class: 'menu-slider' }, h('span', null, t('opacity')), opacity, opacityValue),
      item('palette', t('rename'), () => this.rename(layer)),
      item(layer.locked ? 'unlock' : 'lock', layer.locked ? t('unlockLayer') : t('lockLayer'), () =>
        ed.setLayerProps(layer.id, { locked: !layer.locked }),
      ),
      item('copy', t('duplicateLayer'), () => ed.duplicateLayer(t('copySuffix'))),
      item('arrowUp', t('moveUp'), () => ed.moveLayer(layer.id, 1), idx >= layers.length - 1),
      item('arrowDown', t('moveDown'), () => ed.moveLayer(layer.id, -1), idx <= 0),
      item('eraser', t('clearLayerOnFrame'), () => ed.clearCell(), !ed.liveBounds),
      item('trash', t('deleteLayer'), () => ed.deleteLayer(), layers.length <= 1),
    );
    popover(anchor, menu, { side: 'left' });
  }

  private async rename(layer: Layer): Promise<void> {
    const name = await promptDialog(t('renameLayer'), layer.name, t('save'));
    if (name) this.ed.setLayerProps(layer.id, { name });
  }

  dispose(): void {
    clearTimeout(this.thumbTimer);
    for (const off of this.offs) off();
  }
}
