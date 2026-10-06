import type { AudioEngine } from '../audio/audio';
import { t } from '../i18n';
import { buildJob, runExport, videoSupported, type ExportOptions } from '../export/run';
import { ExportError, type ExportFormat, type ExportResult } from '../export/types';
import { append, canShareFiles, clear, downloadBlob, h, safeFileName, shareFile } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import type { AutoSaver } from './autosave';
import type { Editor } from './editor';
import { segmented, toggle } from './toolbar';

const last: ExportOptions = {
  format: 'gif',
  scale: 1,
  transparent: false,
  loop: true,
  expandHolds: true,
  includeAudio: true,
};

export function openExportDialog(ed: Editor, saver: AutoSaver, audio: AudioEngine): void {
  const opts: ExportOptions = { ...last };
  if (opts.format === 'video' && !videoSupported()) opts.format = 'gif';
  const p = ed.project;

  const body = h('div', { class: 'export' });
  const footer = h('div', { class: 'dialog-actions' });
  const d = openDialog({ title: t('exportTitle'), body: [body, footer], wide: true });

  const formats: { id: ExportFormat; title: string; desc: string; disabled?: boolean }[] = [
    { id: 'gif', title: 'GIF', desc: t('exportGifDesc') },
    { id: 'video', title: 'MP4', desc: videoSupported() ? t('exportVideoDesc') : t('exportVideoUnsupported'), disabled: !videoSupported() },
    { id: 'png', title: 'PNG', desc: p.frames.length > 1 ? t('exportPngDesc') : t('exportPngSingle') },
  ];

  function renderOptions(): void {
    clear(body);
    clear(footer);
    const cards = h('div', { class: 'format-cards', role: 'radiogroup' });
    for (const f of formats) {
      cards.append(
        h(
          'button',
          {
            class: `format-card ${opts.format === f.id ? 'active' : ''}`,
            role: 'radio',
            'aria-checked': String(opts.format === f.id),
            disabled: !!f.disabled,
            onclick: () => {
              opts.format = f.id;
              renderOptions();
            },
          },
          h('strong', null, f.title),
          h('span', null, f.desc),
        ),
      );
    }
    const w = Math.round(p.width * opts.scale);
    const hgt = Math.round(p.height * opts.scale);
    const extra: HTMLElement[] = [];
    if (opts.format === 'gif') extra.push(toggle(t('loopForever'), opts.loop, (v) => (opts.loop = v)));
    if (opts.format === 'png') {
      extra.push(toggle(t('transparentBg'), opts.transparent, (v) => (opts.transparent = v)));
      if (p.frames.length > 1) extra.push(toggle(t('expandHolds'), opts.expandHolds, (v) => (opts.expandHolds = v)));
    }
    if (opts.format === 'video' && p.audio) extra.push(toggle(t('includeSound'), opts.includeAudio, (v) => (opts.includeAudio = v)));

    body.append(
      cards,
      h(
        'div',
        { class: 'export-row' },
        h('span', { class: 'opt-label' }, t('exportSize')),
        segmented(
          [
            { value: '0.5', label: '50%' },
            { value: '1', label: '100%' },
            { value: '2', label: '200%' },
          ],
          String(opts.scale),
          (v) => {
            opts.scale = Number(v);
            renderOptions();
          },
        ),
        h('span', { class: 'muted' }, `${w} × ${hgt}`),
      ),
      ...extra.map((e) => h('div', { class: 'export-row' }, e)),
      h('p', { class: 'muted small' }, t('noWatermark')),
    );
    footer.append(
      h('button', { class: 'btn', onclick: () => d.close() }, t('cancel')),
      h('button', { class: 'btn btn-primary', onclick: () => void start() }, icon('download', 18), t('exportStart')),
    );
  }

  async function start(): Promise<void> {
    Object.assign(last, opts);
    clear(body);
    clear(footer);
    const bar = h('div', { class: 'progress-fill' });
    const label = h('div', { class: 'muted' }, t('exportPreparing'));
    body.append(h('div', { class: 'progress' }, bar), label);
    let cancelled = false;
    let cancel = () => {
      cancelled = true;
    };
    footer.append(h('button', { class: 'btn', onclick: () => cancel() }, t('cancel')));
    try {
      ed.commitLive();
      await saver.encodeAll();
      if (cancelled) return renderOptions();
      const job = await buildJob(p, opts, audio);
      if (cancelled) return renderOptions();
      const run = runExport(job, (done, total) => {
        bar.style.width = `${(done / total) * 100}%`;
        label.textContent = t('exportProgress', { done, total });
      });
      cancel = run.cancel;
      const result = await run.promise;
      showResult(result);
    } catch (err) {
      if (err instanceof ExportError && err.code === 'cancelled') {
        renderOptions();
        return;
      }
      console.error(err);
      clear(body);
      clear(footer);
      const msg = err instanceof ExportError && err.code === 'noVideo' ? t('exportVideoUnsupported') : t('exportFailed');
      body.append(h('p', { class: 'error-text' }, msg), h('p', { class: 'muted small' }, String((err as Error)?.message ?? err)));
      footer.append(h('button', { class: 'btn', onclick: () => renderOptions() }, t('back')));
    }
  }

  function showResult(r: ExportResult): void {
    clear(body);
    clear(footer);
    const filename = `${safeFileName(p.name)}.${r.ext}`;
    const url = URL.createObjectURL(r.blob);
    d.closed.then(() => URL.revokeObjectURL(url));
    let preview: HTMLElement;
    if (r.ext === 'gif' || r.ext === 'png') preview = h('img', { src: url, alt: filename, class: 'export-preview' });
    else if (r.ext === 'mp4' || r.ext === 'webm')
      preview = h('video', { src: url, controls: true, loop: true, playsinline: true, class: 'export-preview' });
    else preview = h('div', { class: 'export-file' }, icon('download', 32), h('span', null, filename));
    append(
      body,
      [
        preview,
        h('p', { class: 'muted small' }, `${filename} · ${formatBytes(r.blob.size)}`),
        r.container === 'webm' ? h('p', { class: 'muted small' }, t('exportWebmNote')) : null,
        opts.format === 'video' && p.audio && opts.includeAudio && !r.audioIncluded
          ? h('p', { class: 'muted small' }, t('exportNoAudioNote'))
          : null,
      ],
    );
    footer.append(h('button', { class: 'btn', onclick: () => renderOptions() }, t('back')));
    if (canShareFiles()) {
      footer.append(
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              if (!(await shareFile(r.blob, filename))) toast(t('shareFailed'));
            },
          },
          icon('share', 18),
          t('share'),
        ),
      );
    }
    footer.append(
      h('button', { class: 'btn btn-primary', onclick: () => downloadBlob(r.blob, filename) }, icon('download', 18), t('download')),
    );
  }

  renderOptions();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
