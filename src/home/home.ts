import { lang, setLang, t } from '../i18n';
import type { ProjectSummary } from '../model/types';
import { installAvailable, promptInstall, isIos, isStandalone, onInstallChange } from '../pwa';
import type { ProjectRepo } from '../storage/repo';
import { FormatError } from '../storage/serialize';
import { projectFromZip, projectToZip } from '../storage/zip';
import { clear, downloadBlob, h, pickFile, safeFileName } from '../ui/dom';
import { confirmDialog, openDialog, promptDialog } from '../ui/dialog';
import { icon } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { newProjectDialog } from './newProject';

const REPO_URL = 'https://github.com/mifarosa/karekare';

/** Project gallery: create, open, import and manage animations. */
export class HomeView {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private installBtn: HTMLButtonElement;
  private urls: string[] = [];
  private offInstall: () => void;

  constructor(
    private repo: ProjectRepo,
    private open: (id: string) => void,
    private onLangChange: () => void,
  ) {
    this.grid = h('div', { class: 'project-grid' });
    this.installBtn = h('button', { class: 'btn', onclick: () => this.install() }, icon('install', 18), t('installApp'));
    this.el = h(
      'div',
      { class: 'home' },
      h(
        'header',
        { class: 'home-header' },
        h(
          'div',
          { class: 'brand' },
          h('img', { src: 'icons/icon.svg', alt: '', class: 'brand-logo', width: 44, height: 44 }),
          h('div', null, h('h1', null, 'Kare Kare'), h('p', { class: 'tagline' }, t('tagline'))),
        ),
        h(
          'div',
          { class: 'home-header-actions' },
          this.installBtn,
          h(
            'button',
            {
              class: 'btn',
              title: t('language'),
              onclick: () => {
                setLang(lang() === 'tr' ? 'en' : 'tr');
                this.onLangChange();
              },
            },
            lang() === 'tr' ? 'English' : 'Türkçe',
          ),
        ),
      ),
      repo.persistent ? null : h('div', { class: 'banner' }, t('noStorageWarning')),
      h(
        'div',
        { class: 'home-actions' },
        h('button', { class: 'big-btn primary', onclick: () => void this.create() }, icon('plus', 28), h('span', null, t('newAnimation'))),
        h('button', { class: 'big-btn', onclick: () => void this.importZip() }, icon('open', 26), h('span', null, t('openProjectFile'))),
      ),
      h('h2', { class: 'section-title' }, t('myAnimations')),
      this.grid,
      h(
        'footer',
        { class: 'home-footer' },
        h('span', null, t('footerBadges')),
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, t('sourceCode')),
      ),
    );
    this.offInstall = onInstallChange(() => this.updateInstall());
    this.updateInstall();
    void this.refresh();
  }

  private updateInstall(): void {
    this.installBtn.hidden = isStandalone() || (!installAvailable() && !isIos());
  }

  private async install(): Promise<void> {
    if (installAvailable()) {
      await promptInstall();
      return;
    }
    openDialog({
      title: t('installApp'),
      body: h('p', null, t('installIos')),
      actions: [{ label: t('done'), kind: 'primary' }],
    });
  }

  async refresh(): Promise<void> {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    let list: ProjectSummary[] = [];
    try {
      list = await this.repo.list();
    } catch (err) {
      console.error(err);
    }
    clear(this.grid);
    if (list.length === 0) {
      this.grid.append(
        h('div', { class: 'empty' }, h('div', { class: 'empty-art', 'aria-hidden': 'true' }, '✏️'), h('p', null, t('emptyProjects'))),
      );
      return;
    }
    for (const p of list) this.grid.append(this.card(p));
  }

  private card(p: ProjectSummary): HTMLElement {
    const img = h('img', { class: 'card-thumb', alt: '', loading: 'lazy' });
    void this.repo.readThumb(p.id).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      this.urls.push(url);
      img.src = url;
    });
    const thumbBox = h('div', { class: 'card-thumb-box', style: { aspectRatio: `${p.width} / ${p.height}` } }, img);
    const more = h(
      'button',
      {
        class: 'icon-btn card-more',
        title: t('more'),
        'aria-label': t('more'),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.cardMenu(more, p);
        },
      },
      icon('more', 20),
    );
    return h(
      'div',
      { class: 'project-card' },
      h(
        'button',
        { class: 'card-open', onclick: () => this.open(p.id), 'aria-label': `${t('open')} ${p.name}` },
        h('div', { class: 'card-thumb-wrap' }, thumbBox),
        h(
          'div',
          { class: 'card-info' },
          h('strong', null, p.name),
          h('small', null, `${t('framesCount', { n: p.frames })} · ${p.fps} fps · ${relativeTime(p.modified)}`),
        ),
      ),
      more,
    );
  }

  private cardMenu(anchor: HTMLElement, p: ProjectSummary): void {
    const item = (name: Parameters<typeof icon>[0], label: string, run: () => void, danger = false) =>
      h(
        'button',
        {
          class: `menu-item ${danger ? 'danger' : ''}`,
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
        item('open', t('open'), () => this.open(p.id)),
        item('palette', t('rename'), async () => {
          const name = await promptDialog(t('renameProject'), p.name, t('save'));
          if (!name) return;
          await this.repo.rename(p.id, name);
          void this.refresh();
        }),
        item('copy', t('duplicate'), async () => {
          try {
            await this.repo.duplicate(p.id, `${p.name} ${t('copySuffix')}`);
            void this.refresh();
          } catch (err) {
            console.error(err);
            toast(t('saveError'), { kind: 'error' });
          }
        }),
        item('download', t('saveProjectFile'), async () => {
          try {
            const { project } = await this.repo.load(p.id);
            const blob = await projectToZip(project, await this.repo.readThumb(p.id));
            downloadBlob(blob, `${safeFileName(p.name)}.karekare.zip`);
          } catch (err) {
            console.error(err);
            toast(t('exportFailed'), { kind: 'error' });
          }
        }),
        item(
          'trash',
          t('delete'),
          async () => {
            if (await confirmDialog(t('deleteProjectTitle'), t('deleteProjectText', { name: p.name }), t('delete'), true)) {
              await this.repo.delete(p.id);
              void this.refresh();
            }
          },
          true,
        ),
      ),
      { side: 'bottom' },
    );
  }

  private async create(): Promise<void> {
    const count = (await this.repo.list().catch(() => [])).length;
    const project = await newProjectDialog(`${t('defaultProjectName')} ${count + 1}`);
    if (!project) return;
    try {
      await this.repo.insert(project);
      this.open(project.id);
    } catch (err) {
      console.error(err);
      toast(t('saveError'), { kind: 'error' });
    }
  }

  private async importZip(): Promise<void> {
    const file = await pickFile('.zip,application/zip');
    if (!file) return;
    try {
      const { project, missing } = await projectFromZip(file);
      project.modified = Date.now();
      await this.repo.insert(project);
      if (missing) toast(t('importMissing', { n: missing }));
      this.open(project.id);
    } catch (err) {
      console.error(err);
      toast(err instanceof FormatError ? t('importInvalid') : t('importFailed'), { kind: 'error' });
    }
  }

  dispose(): void {
    this.offInstall();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.el.remove();
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  if (min < 1) return t('justNow');
  if (min < 60) return rtf.format(-min, 'minute');
  const hours = Math.round(min / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Date(ms).toLocaleDateString(lang());
}
