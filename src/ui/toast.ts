import { h } from './dom';

let host: HTMLElement | null = null;

export interface ToastOptions {
  action?: { label: string; run: () => void };
  duration?: number;
  kind?: 'info' | 'error';
}

export function toast(message: string, opts: ToastOptions = {}): void {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast ${opts.kind === 'error' ? 'toast-error' : ''}` }, h('span', null, message));
  const close = () => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 250);
  };
  if (opts.action) {
    const { label, run } = opts.action;
    el.append(
      h('button', {
        class: 'toast-action',
        onclick: () => {
          close();
          run();
        },
      }, label),
    );
  }
  host.append(el);
  const duration = opts.duration ?? (opts.action ? 8000 : 2600);
  if (duration > 0) setTimeout(close, duration);
}
