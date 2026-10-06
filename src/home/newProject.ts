import { t } from '../i18n';
import { createProject } from '../model/project';
import type { Project } from '../model/types';
import { h } from '../ui/dom';
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

const BACKGROUNDS = ['#ffffff', '#fdf6e3', '#e8f4ff', '#1f2430'];

export function newProjectDialog(defaultName: string): Promise<Project | null> {
  return new Promise((resolve) => {
    let result: Project | null = null;
    let size = SIZES[0];
    let fps = 12;
    let background = BACKGROUNDS[0];

    const name = h('input', { class: 'input', type: 'text', value: defaultName, maxlength: 80 });
    const sizes = h('div', { class: 'size-cards', role: 'radiogroup' });
    for (const s of SIZES) {
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
      sizes.append(card);
    }
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
      result = createProject(
        { name: name.value.trim() || defaultName, width: size.width, height: size.height, fps, background },
        `${t('layer')} 1`,
      );
    };
    const d = openDialog({
      title: t('newAnimation'),
      wide: true,
      body: [
        h('label', { class: 'field' }, h('span', { class: 'opt-label' }, t('projectName')), name),
        h('div', { class: 'field-col' }, h('span', { class: 'opt-label' }, t('canvasSize')), sizes),
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
