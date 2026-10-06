import { t } from './i18n';
import { toast } from './ui/toast';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() {
          toast(t('updateReady'), { action: { label: t('updateNow'), run: () => void update(true) }, duration: 0 });
        },
        onOfflineReady() {
          toast(t('offlineReady'));
        },
      });
    });
  }
}

export function installAvailable(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  listeners.forEach((fn) => fn());
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/**
 * What to suggest about installing: iOS needs manual "Add to Home Screen"
 * (and Safari may otherwise clear site data), others may offer a prompt.
 */
export function installHint(): 'ios' | 'prompt' | null {
  if (isStandalone()) return null;
  if (isIos()) return 'ios';
  if (installAvailable()) return 'prompt';
  return null;
}
