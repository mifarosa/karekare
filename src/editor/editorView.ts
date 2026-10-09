import { AudioEngine } from '../audio/audio';
import { CellEncoder } from '../core/encoder';
import { t } from '../i18n';
import { frameStartTick } from '../model/project';
import type { Project } from '../model/types';
import { saveSettings, settings } from '../settings';
import type { ProjectRepo } from '../storage/repo';
import { projectToZip } from '../storage/zip';
import { downloadBlob, h, safeFileName } from '../ui/dom';
import { promptDialog } from '../ui/dialog';
import { icon, type IconName } from '../ui/icons';
import { closePopover, popover } from '../ui/popover';
import { toast } from '../ui/toast';
import { AutoSaver, type SaveState } from './autosave';
import { openAudioPopover, openHelpDialog, openSettingsDialog } from './dialogs';
import { Editor, type Notice, type ToolId } from './editor';
import { openExportDialog } from './exportDialog';
import { photoMenu, startText } from './insert';
import { LayersPanel } from './layersPanel';
import { Placer } from './placer';
import { Player } from './player';
import { Stage } from './stage';
import { Timeline } from './timeline';
import { OptionsBar, Toolbar, setColor } from './toolbar';

const NOTICE_TEXT: Record<Notice, Parameters<typeof t>[0]> = {
  layerHidden: 'noticeLayerHidden',
  layerLocked: 'noticeLayerLocked',
  lastFrame: 'noticeLastFrame',
  lastLayer: 'noticeLastLayer',
};

/** The full editor screen for one project. */
export class EditorView {
  readonly el: HTMLElement;
  readonly ed: Editor;
  private stage: Stage;
  private timeline: Timeline;
  private layers: LayersPanel;
  private toolbar: Toolbar;
  private placer!: Placer;
  private options: OptionsBar;
  private saver: AutoSaver;
  private player: Player;
  private audio = new AudioEngine();
  private encoder = new CellEncoder();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private onionBtn: HTMLButtonElement;
  private saveDot: HTMLElement;
  private titleBtn: HTMLButtonElement;
  private zoomLabel: HTMLElement;
  private loading: HTMLElement;
  private offs: (() => void)[] = [];
  private prevTool: ToolId = 'brush';
  private closed = false;

  constructor(
    private repo: ProjectRepo,
    project: Project,
    private onExit: () => void,
  ) {
    const ed = (this.ed = new Editor(project, {
      color: settings.color,
      brush: settings.brush,
      eraser: settings.eraser,
      fill: settings.fill,
      onion: settings.onion,
      layerBaseName: t('layer'),
    }));
    this.saver = new AutoSaver(ed, repo, this.encoder);
    this.player = new Player(ed, this.audio);
    this.stage = new Stage(ed);
    this.timeline = new Timeline(ed, this.player, this.audio, {
      onAudio: (anchor) => openAudioPopover(anchor, ed, this.audio),
      onScrub: (i) => this.scrub(i),
    });
    this.layers = new LayersPanel(ed);
    this.toolbar = new Toolbar(ed, {
      onText: () => this.addText(),
      onPhoto: (anchor) => photoMenu(anchor, ed, this.placer, (busy) => this.loading.classList.toggle('show', busy)),
    });
    this.options = new OptionsBar(ed);

    const btn = (name: IconName, label: string, onclick: (e: Event) => void, cls = '') =>
      h('button', { class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick }, icon(name));

    this.undoBtn = btn('undo', `${t('undo')} (Ctrl+Z)`, () => this.undo());
    this.redoBtn = btn('redo', `${t('redo')} (Ctrl+Shift+Z)`, () => this.redo());
    this.onionBtn = btn('onion', `${t('onionSkin')} (O)`, () => this.toggleOnion());
    this.saveDot = h('span', { class: 'save-state' });
    this.titleBtn = h('button', { class: 'title-btn', title: t('rename'), onclick: () => void this.rename() }, project.name);
    this.zoomLabel = h('button', { class: 'zoom-label', title: t('fitScreen'), onclick: () => this.stage.fit() });
    this.loading = h('div', { class: 'loading-badge' }, t('loading'));

    const topbar = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'topbar-group' },
        btn('home', t('home'), () => this.onExit()),
        this.titleBtn,
        this.saveDot,
      ),
      h('div', { class: 'topbar-group' }, this.undoBtn, this.redoBtn),
      h(
        'div',
        { class: 'topbar-group' },
        this.onionBtn,
        btn('layers', t('layers'), () => this.toggleLayers(), 'layers-toggle'),
        btn('more', t('more'), (e) => this.moreMenu(e.currentTarget as HTMLElement)),
        btn('help', t('help'), () => openHelpDialog(), 'help-btn'),
        h('button', { class: 'btn btn-primary export-btn', onclick: () => this.export() }, icon('download', 18), h('span', null, t('export'))),
      ),
    );

    const canvasArea = h(
      'main',
      { class: 'canvas-area' },
      this.stage.el,
      h(
        'div',
        { class: 'zoom-controls' },
        btn('zoomOut', t('zoomOut'), () => this.stage.zoomBy(1 / 1.25)),
        this.zoomLabel,
        btn('zoomIn', t('zoomIn'), () => this.stage.zoomBy(1.25)),
        btn('fit', t('fitScreen'), () => this.stage.fit()),
      ),
      this.loading,
    );
    this.placer = new Placer(ed, this.stage, this.options.el);

    this.el = h(
      'div',
      { class: 'editor' },
      topbar,
      this.options.el,
      this.toolbar.el,
      canvasArea,
      this.layers.el,
      this.timeline.el,
    );
    this.applyAppSettings();

    // Wiring
    this.stage.onPick = (color, final) => {
      setColor(ed, color, final);
      // Return to the painting tool used before picking.
      if (final) ed.setTool(this.prevTool === 'eraser' || this.prevTool === 'hand' ? 'brush' : this.prevTool);
    };
    this.stage.onUndo = () => this.undo();
    this.stage.onRedo = () => this.redo();
    this.stage.onZoom = () => {
      this.zoomLabel.textContent = `${Math.round(this.stage.zoom * 100)}%`;
    };
    this.player.onLoading = (on) => this.loading.classList.toggle('show', on);
    this.saver.onState = (s) => this.renderSaveState(s);

    const ev = ed.events;
    this.offs.push(
      ev.on('dirty', () => this.saver.schedule()),
      ev.on('history', () => this.updateHistory()),
      ev.on('onion', () => this.onionBtn.classList.toggle('active', ed.onion.enabled)),
      ev.on('project', () => {
        this.titleBtn.textContent = ed.project.name;
      }),
      ev.on('notice', (n) => toast(t(NOTICE_TEXT[n]))),
      ev.on('tool', () => {
        if (ed.tool !== 'eyedropper') this.prevTool = ed.tool;
      }),
    );
    this.onionBtn.classList.toggle('active', ed.onion.enabled);
    this.updateHistory();
    this.renderSaveState('saved');

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    if (!repo.persistent) {
      toast(t('noStorageWarning'), { duration: 9000 });
    }
    if (project.audio) void this.audio.load(project.audio.blob).catch(() => {});
    void ed.activate();
  }

  /** Called once the element is in the document. */
  mounted(): void {
    this.stage.fit();
  }

  private applyAppSettings(): void {
    this.el.classList.toggle('left-handed', settings.leftHanded);
    this.el.classList.toggle('no-layers', !settings.showLayers);
  }

  private toggleLayers(): void {
    if (matchMedia('(max-width: 760px)').matches) {
      // Narrow screens show the panel as a temporary overlay.
      this.el.classList.toggle('layers-open');
      return;
    }
    settings.showLayers = !settings.showLayers;
    saveSettings();
    this.applyAppSettings();
    requestAnimationFrame(() => this.stage.fit());
  }

  private toggleOnion(): void {
    const enabled = !this.ed.onion.enabled;
    this.ed.setOnion({ enabled });
    settings.onion = { ...this.ed.onion };
    saveSettings();
  }

  private addText(): void {
    if (this.ed.playing) this.player.stop();
    startText(this.ed, this.placer);
  }

  private undo(): void {
    // Undo while placing just drops the object being placed.
    if (this.placer.active) {
      this.placer.cancel();
      return;
    }
    if (this.ed.playing) this.player.stop();
    this.stage.cancelDraw();
    void this.ed.history.undo();
  }

  private redo(): void {
    if (this.placer.active) this.placer.commit();
    if (this.ed.playing) this.player.stop();
    this.stage.cancelDraw();
    void this.ed.history.redo();
  }

  private updateHistory(): void {
    this.undoBtn.disabled = !this.ed.history.canUndo;
    this.redoBtn.disabled = !this.ed.history.canRedo;
  }

  private renderSaveState(s: SaveState): void {
    const text: Record<SaveState, string> = {
      saved: this.repo.persistent ? t('saved') : t('notSaved'),
      pending: t('saving'),
      saving: t('saving'),
      error: t('saveError'),
    };
    this.saveDot.textContent = text[s];
    this.saveDot.dataset.state = this.repo.persistent ? s : 'memory';
    if (s === 'error') toast(t('saveErrorLong'), { kind: 'error', duration: 8000 });
  }

  private scrub(index: number): void {
    const p = this.ed.project;
    if (!settings.scrubAudio || !p.audio || this.ed.playing) return;
    this.audio.scrub(frameStartTick(p.frames, index) / p.fps, p.frames[index].hold / p.fps, p.audio, p.fps);
  }

  private async rename(): Promise<void> {
    const name = await promptDialog(t('renameProject'), this.ed.project.name, t('save'));
    if (name) this.ed.setProjectProps({ name });
  }

  private export(): void {
    if (this.placer.active) this.placer.commit();
    if (this.ed.playing) this.player.stop();
    openExportDialog(this.ed, this.saver, this.audio);
  }

  private moreMenu(anchor: HTMLElement): void {
    const item = (name: IconName, label: string, run: () => void) =>
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
        item('settings', t('settings'), () =>
          openSettingsDialog(this.ed, () => {
            this.applyAppSettings();
            requestAnimationFrame(() => this.stage.fit());
          }),
        ),
        item('download', t('saveProjectFile'), () => void this.saveZip()),
        item('music', t('sound'), () => openAudioPopover(anchor, this.ed, this.audio)),
        item('eraser', t('clearLayerOnFrame'), () => this.ed.clearCell()),
        item('help', t('help'), () => openHelpDialog()),
      ),
      { side: 'bottom' },
    );
  }

  private async saveZip(): Promise<void> {
    try {
      if (this.placer.active) this.placer.commit();
      this.ed.commitLive();
      await this.saver.flush();
      const thumb = await this.repo.readThumb(this.ed.project.id);
      const blob = await projectToZip(this.ed.project, thumb);
      downloadBlob(blob, `${safeFileName(this.ed.project.name)}.karekare.zip`);
    } catch (err) {
      console.error(err);
      toast(t('exportFailed'), { kind: 'error' });
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (document.querySelector('.dialog-backdrop:not(.dialog-out)')) return;
    const ed = this.ed;
    if (this.placer.active && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') this.placer.commit();
      else this.placer.cancel();
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z') {
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') this.redo();
    else if (mod && key === 's') void this.saver.flush();
    else if (mod || e.altKey) handled = false;
    else if (e.key === ' ') {
      if (!this.stage.spaceDown) {
        this.stage.spaceDown = true;
        this.stage.el.classList.add('space-pan');
      }
    } else if (key === 'b') ed.setTool('brush');
    else if (key === 'e') ed.setTool('eraser');
    else if (key === 'g') ed.setTool('fill');
    else if (key === 'i') ed.setTool('eyedropper');
    else if (key === 'h') ed.setTool('hand');
    else if (key === 'o') this.toggleOnion();
    else if (key === 'n') ed.addFrame();
    else if (key === 'd') ed.duplicateFrame();
    else if (key === 't') this.addText();
    else if (e.key === 'Enter') this.player.toggle();
    else if (e.key === 'ArrowLeft' || e.key === ',') this.stepFrame(-1);
    else if (e.key === 'ArrowRight' || e.key === '.') this.stepFrame(1);
    else if (e.key === '[' || e.key === ']') this.resize(e.key === ']' ? 1 : -1);
    else if (e.key === '0') this.stage.fit();
    else if (e.key === '+' || e.key === '=') this.stage.zoomBy(1.25);
    else if (e.key === '-') this.stage.zoomBy(1 / 1.25);
    else if (e.key === 'Escape') closePopover();
    else handled = false;
    if (handled) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.stage.spaceDown = false;
      this.stage.el.classList.remove('space-pan');
    }
  };

  private stepFrame(d: number): void {
    const ed = this.ed;
    if (ed.playing) this.player.stop();
    const n = ed.project.frames.length;
    const i = (ed.frameIndex + d + n) % n;
    ed.goToFrame(i);
    this.scrub(i);
  }

  private resize(dir: number): void {
    const ed = this.ed;
    const step = (v: number) => Math.max(1, Math.round(v * (dir > 0 ? 1.2 : 1 / 1.2) + dir));
    if (ed.tool === 'eraser') ed.eraser.size = Math.min(200, step(ed.eraser.size));
    else ed.brush.size = Math.min(120, step(ed.brush.size));
    settings.brush = { ...ed.brush };
    settings.eraser = { ...ed.eraser };
    saveSettings();
    ed.events.emit('tool');
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.ed.commitLive();
      void this.saver.flush();
    }
  };

  private onPageHide = (): void => {
    void this.saver.flush();
  };

  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.repo.persistent && this.saver.state !== 'saved') {
      void this.saver.flush();
      e.preventDefault();
    }
  };

  /** Saves and tears down. Navigation is the router's job. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.player.stop();
    this.stage.cancelDraw();
    closePopover();
    if (this.placer.active) this.placer.commit();
    this.ed.commitLive();
    await this.saver.flush();
    this.dispose();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    for (const off of this.offs) off();
    this.saver.dispose();
    this.player.dispose();
    this.placer.dispose();
    this.stage.dispose();
    this.timeline.dispose();
    this.layers.dispose();
    this.toolbar.dispose();
    this.options.dispose();
    this.audio.dispose();
    this.encoder.dispose();
    this.ed.dispose();
    this.el.remove();
  }
}
