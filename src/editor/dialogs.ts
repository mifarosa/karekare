import { audioSupported, type AudioEngine } from '../audio/audio';
import { lang, setLang, t } from '../i18n';
import { uid } from '../model/ids';
import { saveSettings, settings } from '../settings';
import { h, pickFile } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { icon } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import type { Editor } from './editor';
import { segmented, slider, toggle } from './toolbar';

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;

export function openSettingsDialog(ed: Editor, onAppChange: () => void): void {
  const p = ed.project;
  const name = h('input', { class: 'input', type: 'text', value: p.name, maxlength: 80 });
  name.addEventListener('change', () => ed.setProjectProps({ name: name.value }));
  const bg = h('input', { class: 'color-input', type: 'color', value: p.background });
  bg.addEventListener('input', () => ed.setProjectProps({ background: bg.value }));
  const fps = h('input', { class: 'input input-num', type: 'number', min: 1, max: 60, value: String(p.fps) });
  fps.addEventListener('change', () => {
    ed.setProjectProps({ fps: Number(fps.value) });
    fps.value = String(ed.project.fps);
  });

  const o = ed.onion;
  const onion = h(
    'div',
    { class: 'settings-group' },
    h('h3', null, t('onionSkin')),
    toggle(t('onionEnabled'), o.enabled, (v) => setOnion({ enabled: v })),
    slider(t('onionBefore'), 0, 3, o.before, (v) => setOnion({ before: v }), String),
    slider(t('onionAfter'), 0, 3, o.after, (v) => setOnion({ after: v }), String),
    slider(t('onionOpacity'), 5, 80, Math.round(o.opacity * 100), (v) => setOnion({ opacity: v / 100 }), (v) => `${v}%`),
  );
  function setOnion(props: Partial<typeof o>): void {
    ed.setOnion(props);
    settings.onion = { ...ed.onion };
    saveSettings();
  }

  const app = h(
    'div',
    { class: 'settings-group' },
    h('h3', null, t('appSettings')),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'opt-label' }, t('language')),
      segmented(
        [
          { value: 'tr', label: 'Türkçe' },
          { value: 'en', label: 'English' },
        ],
        lang(),
        (v) => {
          setLang(v as 'tr' | 'en');
          toast(t('languageChanged'));
          onAppChange();
        },
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'opt-label' }, t('penMode')),
      segmented(
        [
          { value: 'auto', label: t('penAuto') },
          { value: 'pen', label: t('penOnly') },
          { value: 'any', label: t('penAny') },
        ],
        settings.penMode,
        (v) => {
          settings.penMode = v as typeof settings.penMode;
          saveSettings();
        },
      ),
    ),
    h('p', { class: 'muted small' }, t('penModeHint')),
    toggle(t('leftHanded'), settings.leftHanded, (v) => {
      settings.leftHanded = v;
      saveSettings();
      onAppChange();
    }),
    toggle(t('scrubAudio'), settings.scrubAudio, (v) => {
      settings.scrubAudio = v;
      saveSettings();
    }),
  );

  openDialog({
    title: t('settings'),
    wide: true,
    body: [
      h(
        'div',
        { class: 'settings-group' },
        h('h3', null, t('projectSettings')),
        h('label', { class: 'field' }, h('span', { class: 'opt-label' }, t('projectName')), name),
        h('label', { class: 'field' }, h('span', { class: 'opt-label' }, t('fpsTitle')), fps),
        h('label', { class: 'field' }, h('span', { class: 'opt-label' }, t('background')), bg),
        h('p', { class: 'muted small' }, t('canvasSizeInfo', { w: p.width, h: p.height })),
      ),
      onion,
      app,
    ],
    actions: [{ label: t('done'), kind: 'primary' }],
  });
}

export function openHelpDialog(): void {
  const rows: [string, string][] = [
    [t('helpDraw'), t('helpDrawKeys')],
    [t('helpPinch'), t('helpPinchKeys')],
    [t('helpUndoTap'), t('helpUndoTapKeys')],
    [t('helpRedoTap'), t('helpRedoTapKeys')],
    [t('helpFrames'), t('helpFramesKeys')],
    [t('helpPlay'), t('helpPlayKeys')],
    [t('helpTools'), t('helpToolsKeys')],
    [t('helpSize'), t('helpSizeKeys')],
    [t('helpOnion'), t('helpOnionKeys')],
    [t('helpReorder'), t('helpReorderKeys')],
    [t('helpHold'), t('helpHoldKeys')],
  ];
  openDialog({
    title: t('help'),
    wide: true,
    body: [
      h('p', null, t('helpIntro')),
      h('table', { class: 'help-table' }, h('tbody', null, ...rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b))))),
      h('p', { class: 'muted small' }, t('helpSaving')),
    ],
    actions: [{ label: t('done'), kind: 'primary' }],
  });
}

/** Sound clip controls, shown next to the timeline's sound button. */
export function openAudioPopover(anchor: HTMLElement, ed: Editor, audio: AudioEngine): void {
  const p = ed.project;
  const add = async () => {
    closePopover();
    if (!audioSupported()) {
      toast(t('audioUnsupported'), { kind: 'error' });
      return;
    }
    const file = await pickFile('audio/*,.mp3,.wav,.m4a,.ogg,.aac');
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) {
      toast(t('audioTooBig'), { kind: 'error' });
      return;
    }
    const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
    try {
      await audio.load(blob);
    } catch {
      toast(t('audioDecodeFailed'), { kind: 'error' });
      return;
    }
    ed.setAudio({ id: uid(), name: file.name, blob, mime: blob.type, offset: 0, volume: 1, file: null });
    toast(t('audioAdded'));
  };

  if (!p.audio) {
    popover(
      anchor,
      h(
        'div',
        { class: 'menu' },
        h('div', { class: 'menu-title' }, t('sound')),
        h('p', { class: 'muted small menu-text' }, t('soundHint')),
        h('button', { class: 'menu-item', onclick: () => void add() }, icon('music', 18), t('addSound')),
      ),
      { side: 'top' },
    );
    return;
  }

  const a = p.audio;
  const offset = h('input', { class: 'input input-num', type: 'number', value: String(a.offset), step: 1 });
  offset.addEventListener('change', () => ed.setAudioProps({ offset: Number(offset.value) || 0 }));
  popover(
    anchor,
    h(
      'div',
      { class: 'menu' },
      h('div', { class: 'menu-title' }, a.name),
      h('label', { class: 'menu-slider' }, h('span', null, t('soundOffset')), offset, h('span', { class: 'muted small' }, t('framesUnit'))),
      slider(t('volume'), 0, 100, Math.round(a.volume * 100), (v) => ed.setAudioProps({ volume: v / 100 }), (v) => `${v}%`),
      h('p', { class: 'muted small menu-text' }, t('soundDragHint')),
      h('button', { class: 'menu-item', onclick: () => void add() }, icon('upload', 18), t('replaceSound')),
      h(
        'button',
        {
          class: 'menu-item danger',
          onclick: () => {
            closePopover();
            audio.unload();
            ed.setAudio(null);
          },
        },
        icon('trash', 18),
        t('removeSound'),
      ),
    ),
    { side: 'top' },
  );
}
