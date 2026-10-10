import { canvasToBlob, createCanvas, ctx2d, type AnyCanvas } from '../core/canvas';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { Reference } from '../model/types';
import { h, pickFile } from '../ui/dom';
import { icon } from '../ui/icons';
import { closePopover } from '../ui/popover';
import { toast } from '../ui/toast';
import type { Editor } from './editor';
import { PhotoContent } from './placeContent';
import type { Placement } from './placement';
import type { Placer } from './placer';
import type { Stage } from './stage';
import { slider, toggle } from './toolbar';

/** Formats every browser can decode, so the project opens anywhere. */
const PORTABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_KEEP_BYTES = 12 * 1024 * 1024;
const DEFAULT_OPACITY = 0.5;

interface LoadedPhoto {
  blob: Blob;
  mime: string;
  image: AnyCanvas | ImageBitmap;
  width: number;
  height: number;
}

/**
 * Decodes a picked photo. Small photos in a portable format are kept as
 * they are; others are downscaled and re-encoded so the project stays light.
 */
async function loadPhoto(file: File, maxSide: number): Promise<LoadedPhoto> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (s >= 1 && PORTABLE.has(file.type) && file.size <= MAX_KEEP_BYTES) {
    // Copy into memory: picked files may become unreadable later on iOS.
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    return { blob, mime: file.type, image: bmp, width: bmp.width, height: bmp.height };
  }
  const c = createCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  // Keep transparency for formats that may have it.
  const mime = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif' ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(c, mime, 0.9);
  return { blob, mime: blob.type || mime, image: c, width: c.width, height: c.height };
}

/** Picks a photo and lets the user place it as the project's reference. */
export async function pickReference(ed: Editor, placer: Placer, stage: Stage): Promise<void> {
  const file = await pickFile('image/*');
  if (!file) return;
  const { width, height } = ed.project;
  let photo: LoadedPhoto;
  try {
    photo = await loadPhoto(file, 2 * Math.max(width, height));
  } catch (err) {
    console.warn(err);
    toast(t('photoOpenFailed'), { kind: 'error' });
    return;
  }
  const old = ed.project.reference;
  const id = uid();
  // Starts out showing the whole photo, as big as the canvas allows.
  const at: Placement = {
    cx: width / 2,
    cy: height / 2,
    scale: Math.min(width / photo.width, height / photo.height),
    rotation: 0,
  };
  place(placer, stage, PhotoContent.from(photo.image), at, old?.opacity ?? DEFAULT_OPACITY, (p) => {
    ed.setReference({
      id,
      name: file.name.slice(0, 120) || 'photo',
      blob: photo.blob,
      mime: photo.mime,
      width: photo.width,
      height: photo.height,
      ...p,
      opacity: old?.opacity ?? DEFAULT_OPACITY,
      visible: true,
      above: old?.above ?? false,
      file: null,
    });
    return true;
  });
}

/** Lets the user move, resize or rotate the current reference. */
export async function moveReference(ed: Editor, placer: Placer, stage: Stage): Promise<void> {
  const r = ed.project.reference;
  if (!r) return;
  let image: AnyCanvas | ImageBitmap;
  try {
    image = await createImageBitmap(r.blob);
  } catch (err) {
    console.warn(err);
    toast(t('photoOpenFailed'), { kind: 'error' });
    return;
  }
  if (image.width !== r.width || image.height !== r.height) {
    // Placement math works in the size the reference was placed with.
    const c = createCanvas(r.width, r.height);
    ctx2d(c).drawImage(image, 0, 0, r.width, r.height);
    image.close();
    image = c;
  }
  const at: Placement = { cx: r.cx, cy: r.cy, scale: r.scale, rotation: r.rotation };
  place(placer, stage, PhotoContent.from(image), at, r.opacity, (p) => {
    const cur = ed.project.reference;
    if (!cur || cur.id !== r.id) return false;
    if (p.cx !== cur.cx || p.cy !== cur.cy || p.scale !== cur.scale || p.rotation !== cur.rotation) {
      ed.setReference({ ...cur, ...p });
    }
    // Lining it up again means it should be seen.
    if (!cur.visible) ed.setReferenceProps({ visible: true });
    return true;
  });
}

function place(
  placer: Placer,
  stage: Stage,
  content: PhotoContent,
  at: Placement,
  opacity: number,
  apply: (p: Placement) => boolean,
): void {
  // The overlay stands in for the reference while it moves.
  stage.setReferenceHidden(true);
  const started = placer.start(content, {
    at,
    // Visible enough to line up, faint enough to see the drawing.
    opacity: Math.min(0.8, Math.max(0.35, opacity)),
    controls: h('div', { class: 'placer-note' }, icon('reference', 16), h('span', null, t('reference'))),
    apply,
    onEnd: () => stage.setReferenceHidden(false),
  });
  if (!started) stage.setReferenceHidden(false);
}

/** Shows or hides the reference; returns false when there is none. */
export function toggleReference(ed: Editor): boolean {
  const r = ed.project.reference;
  if (!r) return false;
  ed.setReferenceProps({ visible: !r.visible });
  return true;
}

/** Reference section of the photo menu. */
export function referenceMenuSection(ed: Editor, placer: Placer, stage: Stage, onBeforePlace: () => void): HTMLElement {
  const item = (name: Parameters<typeof icon>[0], label: string, run: () => void, cls = '') =>
    h(
      'button',
      {
        class: `menu-item ${cls}`,
        onclick: () => {
          closePopover();
          run();
        },
      },
      icon(name, 18),
      label,
    );
  const pick = () => {
    onBeforePlace();
    void pickReference(ed, placer, stage);
  };
  const r: Reference | null = ed.project.reference;
  if (!r) {
    return h(
      'div',
      { class: 'menu-section' },
      item('reference', t('referenceAdd'), pick),
      h('p', { class: 'muted small menu-text' }, t('referenceHint')),
    );
  }
  return h(
    'div',
    { class: 'menu-section' },
    h('div', { class: 'menu-title' }, t('reference')),
    h(
      'div',
      { class: 'menu-controls' },
      toggle(t('referenceShow'), r.visible, (v) => ed.setReferenceProps({ visible: v })),
      slider(t('opacity'), 5, 100, Math.round(r.opacity * 100), (v) => ed.setReferenceProps({ opacity: v / 100 }), (v) => `${v}%`),
      toggle(t('referenceAbove'), r.above, (v) => ed.setReferenceProps({ above: v })),
    ),
    item('move', t('referenceMove'), () => {
      onBeforePlace();
      void moveReference(ed, placer, stage);
    }),
    item('image', t('referenceReplace'), pick),
    item('trash', t('referenceRemove'), () => ed.setReference(null), 'danger'),
  );
}
