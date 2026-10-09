import { t } from '../i18n';
import { saveSettings, settings } from '../settings';
import { h, pickFile, pickFiles } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { icon } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import type { Editor } from './editor';
import { FONT_FAMILIES, PhotoContent, TEXT_BASE_SIZE, TextContent, type TextFont } from './placeContent';
import type { FitMode } from './placement';
import type { Placer } from './placer';
import { MAX_PHOTO_FRAMES, photosToFrames } from './photos';
import { segmented, toggle } from './toolbar';

const PHOTO_ACCEPT = 'image/*';

/** Starts placing a new text, with an input, font choice and outline toggle. */
export function startText(ed: Editor, placer: Placer): void {
  const { width, height } = ed.project;
  const content = new TextContent({
    text: t('textDefault'),
    font: settings.text.font in FONT_FAMILIES ? settings.text.font : 'rounded',
    color: ed.color,
    outline: settings.text.outline,
  });
  const input = h('textarea', { class: 'input placer-text', rows: 1, placeholder: t('textPlaceholder'), 'aria-label': t('textPlaceholder') });
  input.value = content.style.text;
  input.addEventListener('input', () => {
    content.update({ text: input.value });
    placer.update();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') placer.cancel();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) placer.commit();
  });
  const fonts: { value: TextFont; label: string }[] = [
    { value: 'rounded', label: t('fontRounded') },
    { value: 'hand', label: t('fontHand') },
    { value: 'serif', label: t('fontSerif') },
  ];
  const controls = h(
    'div',
    { class: 'text-controls' },
    input,
    segmented(fonts, content.style.font, (v) => {
      content.update({ font: v as TextFont });
      settings.text.font = v as TextFont;
      saveSettings();
      placer.update();
    }),
    toggle(t('textOutline'), content.style.outline, (v) => {
      content.update({ outline: v });
      settings.text.outline = v;
      saveSettings();
      placer.update();
    }),
  );
  // Picking a color from the toolbar recolors the text being placed.
  const off = ed.events.on('tool', () => {
    if (content.style.color === ed.color) return;
    content.update({ color: ed.color });
    placer.update();
  });
  const scale = Math.min((height * 0.12) / TEXT_BASE_SIZE, (width * 0.9) / content.width);
  if (!placer.start(content, { scale, controls, onEnd: off })) {
    off();
    return;
  }
  // Focus within the tap so tablets open the keyboard.
  input.focus();
  input.select();
}

/** Menu of the toolbar's photo button. */
export function photoMenu(anchor: HTMLElement, ed: Editor, placer: Placer, onBusy: (busy: boolean) => void): void {
  const item = (name: Parameters<typeof icon>[0], label: string, run: () => void) =>
    h(
      'button',
      {
        class: 'menu-item',
        onclick: () => {
          closePopover();
          run();
        },
      },
      icon(name, 18),
      label,
    );
  popover(
    anchor,
    h(
      'div',
      { class: 'menu' },
      h('div', { class: 'menu-title' }, t('addPhoto')),
      item('image', t('photoOnFrame'), () => void placePhoto(ed, placer)),
      item('images', t('photoAsFrames'), () => void addPhotoFrames(ed, onBusy)),
      h('p', { class: 'muted small menu-text' }, t('photoAsFramesHint')),
    ),
    { side: settings.leftHanded ? 'left' : 'right' },
  );
}

/** Picks one photo and starts placing it on the current frame. */
export async function placePhoto(ed: Editor, placer: Placer): Promise<void> {
  const blocker = ed.editBlocker();
  if (blocker) {
    ed.events.emit('notice', blocker);
    return;
  }
  const file = await pickFile(PHOTO_ACCEPT);
  if (!file) return;
  const { width, height } = ed.project;
  let content: PhotoContent;
  try {
    content = await PhotoContent.load(file, 2 * Math.max(width, height));
  } catch (err) {
    console.warn(err);
    toast(t('photoOpenFailed'), { kind: 'error' });
    return;
  }
  const scale = Math.min((width * 0.6) / content.width, (height * 0.6) / content.height);
  placer.start(content, { scale });
}

/** Picks photos and inserts each as a new frame after the current one. */
export async function addPhotoFrames(ed: Editor, onBusy: (busy: boolean) => void): Promise<void> {
  const blocker = ed.editBlocker();
  if (blocker) {
    ed.events.emit('notice', blocker);
    return;
  }
  let files = await pickFiles(PHOTO_ACCEPT, true);
  if (files.length === 0) return;
  const tooMany = files.length > MAX_PHOTO_FRAMES;
  files = files.slice(0, MAX_PHOTO_FRAMES);
  const mode = await chooseFit(files.length, ed.layer.name);
  if (!mode) return;

  onBusy(true);
  const progress = h('div', { class: 'progress-toast' }, t('photoAdding', { done: 0, total: files.length }));
  document.body.append(progress);
  try {
    const layerId = ed.layerId;
    const { frames, failed } = await photosToFrames(files, ed.project, layerId, mode, (done, total) => {
      progress.textContent = t('photoAdding', { done, total });
    });
    // The layer may have been deleted while decoding.
    if (frames.length && ed.project.layers.some((l) => l.id === layerId)) {
      ed.insertFrames(frames);
      toast(t('photoAdded', { n: frames.length }));
    }
    if (failed) toast(t('photoFailed', { n: failed }), { kind: 'error' });
    if (tooMany) toast(t('photoTooMany', { n: MAX_PHOTO_FRAMES }));
  } finally {
    progress.remove();
    onBusy(false);
  }
}

function chooseFit(count: number, layerName: string): Promise<FitMode | null> {
  return new Promise((resolve) => {
    let mode: FitMode = settings.photoFit;
    let chosen = false;
    openDialog({
      title: t('photoFramesTitle', { n: count }),
      body: [
        segmented(
          [
            { value: 'cover', label: t('photoFitCover') },
            { value: 'contain', label: t('photoFitContain') },
          ],
          mode,
          (v) => (mode = v as FitMode),
        ),
        h('p', { class: 'muted small' }, t('photoFramesLayerHint', { layer: layerName })),
      ],
      actions: [
        { label: t('cancel') },
        {
          label: t('photoAdd'),
          kind: 'primary',
          run: () => {
            chosen = true;
            settings.photoFit = mode;
            saveSettings();
          },
        },
      ],
      onClose: () => resolve(chosen ? mode : null),
    });
  });
}
