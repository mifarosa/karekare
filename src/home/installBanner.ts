import { t } from '../i18n';
import { installHint, onInstallChange, promptInstall } from '../pwa';
import { clear, h } from '../ui/dom';
import { openDialog } from '../ui/dialog';
import { icon } from '../ui/icons';

const DISMISS_KEY = 'karekare.installHintDismissed';
/** A dismissed hint comes back after this long. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Ignore blocked storage.
  }
}

/** Step-by-step "Add to Home Screen" guide for iPad and iPhone. */
export function openIosInstallGuide(): void {
  const step = (n: number, glyph: Parameters<typeof icon>[0], text: string) =>
    h('li', { class: 'install-step' }, h('span', { class: 'install-step-num' }, String(n)), h('span', { class: 'install-step-icon' }, icon(glyph, 22)), h('span', null, text));
  openDialog({
    title: t('installIosTitle'),
    body: [
      h('p', null, t('installIosWhy')),
      h(
        'ol',
        { class: 'install-steps' },
        step(1, 'iosShare', t('installIosStep1')),
        step(2, 'addToHome', t('installIosStep2')),
        step(3, 'check', t('installIosStep3')),
      ),
      h('p', { class: 'install-note' }, t('installIosNote')),
    ],
    actions: [{ label: t('done'), kind: 'primary' }],
  });
}

/** Opens the right install flow for this device. */
export async function startInstall(): Promise<void> {
  if (installHint() === 'prompt') await promptInstall();
  else openIosInstallGuide();
}

/**
 * Banner on the home screen that asks to add Kare Kare to the home screen.
 * On iOS it is a warning, because Safari may delete data of sites that are
 * not on the home screen.
 */
export class InstallBanner {
  readonly el = h('div', { class: 'install-banner', role: 'note' });
  private off: () => void;

  constructor(private onChange: () => void = () => {}) {
    this.off = onInstallChange(() => this.render());
    this.render();
  }

  private render(): void {
    clear(this.el);
    const hint = installHint();
    if (!hint || snoozed()) {
      this.el.hidden = true;
      this.onChange();
      return;
    }
    const ios = hint === 'ios';
    this.el.hidden = false;
    this.el.classList.toggle('install-banner-warn', ios);
    this.el.append(
      h('span', { class: 'install-banner-icon' }, icon(ios ? 'warning' : 'install', 28)),
      h(
        'div',
        { class: 'install-banner-text' },
        h('strong', null, ios ? t('installBannerIosTitle') : t('installBannerTitle')),
        h('span', null, ios ? t('installBannerIosText') : t('installBannerText')),
      ),
      h(
        'div',
        { class: 'install-banner-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => void startInstall() }, icon('addToHome', 18), ios ? t('installHow') : t('installNow')),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              snooze();
              this.render();
            },
          },
          t('installLater'),
        ),
      ),
    );
    this.onChange();
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  dispose(): void {
    this.off();
  }
}
