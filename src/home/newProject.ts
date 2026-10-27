import { t } from '../i18n';
import { createProject } from '../model/project';
import type { Project, ProjectKind } from '../model/types';
import { saveSettings, settings } from '../settings';
import { clear, h } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { segmented } from '../editor/toolbar';

interface SizePreset {
  id: string;
  label: Parameters<typeof t>[0];
  width: number;
  height: number;
}

const SIZES: SizePreset[] = [
  { id: 'wide', label: 'sizeWide', width: 1280, height: 720 },
  { id: 'hd', label: 'sizeHd', width: 1920, height: 1080 },
  { id: 'square', label: 'sizeSquare', width: 1080, height: 1080 },
  { id: 'tall', label: 'sizeTall', width: 720, height: 1280 },
  { id: 'classic', label: 'sizeClassic', width: 960, height: 720 },
];

/** Pixel art canvases: every pixel is drawn as a big square. */
const PIXEL_SIZES: SizePreset[] = [
  { id: 'p16', label: 'sizePixelTiny', width: 16, height: 16 },
  { id: 'p32', label: 'sizePixelSmall', width: 32, height: 32 },
  { id: 'p64', label: 'sizePixelMedium', width: 64, height: 64 },
  { id: 'p128', label: 'sizePixelLarge', width: 128, height: 128 },
  { id: 'p64w', label: 'sizeWide', width: 64, height: 36 },
];

const BACKGROUNDS = ['#ffffff', '#fdf6e3', '#e8f4ff', '#1f2430'];

export function newProjectDialog(defaultName: string, kind: ProjectKind): Promise<Project | null> {
  return new Promise((resolve) => {
    let result: Project | null = null;
    let pixel = settings.newPixel;
    let size = pixel ? PIXEL_SIZES[1] : SIZES[0];
    let fps = 12;
    let background = BACKGROUNDS[0];

    const name = h('input', { class: 'input', type: 'text', value: defaultName, maxlength: 80 });
    const sizes = h('div', { class: 'size-cards', role: 'radiogroup' });
    const pixelHint = h('p', { class: 'muted small', hidden: !pixel }, t('pixelHint'));
    const renderSizes = () => {
      clear(sizes);
      for (const s of pixel ? PIXEL_SIZES : SIZES) sizes.append(sizeCard(s));
    };
    const sizeCard = (s: SizePreset) => {
      const ratio = s.width / s.height;
      const shape = h('span', {
        class: 'size-shape',
        style: { width: `${ratio >= 1 ? 40 : 40 * ratio}px`, height: `${ratio >= 1 ? 40 / ratio : 40}px` },
      });
      const card = h(
        'button',
        {
          class: `size-card ${s === size ? 'active' : ''}`,
          role: 'radio',
          'aria-checked': String(s === size),
          onclick: () => {
            size = s;
            for (const c of sizes.children) {
              c.classList.remove('active');
              c.setAttribute('aria-checked', 'false');
            }
            card.classList.add('active');
            card.setAttribute('aria-checked', 'true');
          },
        },
        h('span', { class: 'size-shape-box' }, shape),
        h('strong', null, t(s.label)),
        h('small', null, `${s.width}×${s.height}`),
      );
      return card;
    };
    renderSizes();
    const style = segmented(
      [
        { value: 'normal', label: t('styleNormal') },
        { value: 'pixel', label: t('stylePixel') },
      ],
      pixel ? 'pixel' : 'normal',
      (v) => {
        pixel = v === 'pixel';
        size = pixel ? PIXEL_SIZES[1] : SIZES[0];
        pixelHint.hidden = !pixel;
        renderSizes();
      },
    );
    const bgs = h('div', { class: 'bg-swatches', role: 'radiogroup' });
    for (const c of BACKGROUNDS) {
      const b = h('button', {
        class: `color-swatch ${c === background ? 'active' : ''}`,
        style: { background: c },
        'aria-label': c,
        role: 'radio',
        onclick: () => {
          background = c;
          for (const x of bgs.children) x.classList.remove('active');
          b.classList.add('active');
        },
      });
      bgs.append(b);
    }

    const create = () => {
      settings.newPixel = pixel;
      saveSettings();
      result = createProject(
        { name: name.value.trim() || defaultName, width: size.width, height: size.height, fps, background, kind, pixel },
        `${t('layer')} 1`,
      );
    };
    const animation = kind === 'animation';
    const d = openDialog({
      title: animation ? t('newAnimation') : t('newImage'),
      wide: true,
      body: [
        h('label', { class: 'field' }, h('span', { class: 'opt-label' }, t('projectName')), name),
        h('div', { class: 'field' }, h('span', { class: 'opt-label' }, t('projectStyle')), style),
        pixelHint,
        h('div', { class: 'field-col' }, h('span', { class: 'opt-label' }, t('canvasSize')), sizes),
        ...(animation
          ? [
              h(
                'div',
                { class: 'field' },
                h('span', { class: 'opt-label' }, t('fpsTitle')),
                segmented(
                  [6, 8, 12, 15, 24].map((v) => ({ value: String(v), label: String(v) })),
                  String(fps),
                  (v) => (fps = Number(v)),
                ),
              ),
              h('p', { class: 'muted small' }, t('fpsHint')),
            ]
          : []),
        h('div', { class: 'field' }, h('span', { class: 'opt-label' }, t('background')), bgs),
      ],
      actions: [{ label: t('cancel') }, { label: t('create'), kind: 'primary', run: create }],
      onClose: () => resolve(result),
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        create();
        d.close();
      }
    });
  });
}
