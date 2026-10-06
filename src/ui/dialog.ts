import { t } from '../i18n';
import { h } from './dom';
import { icon } from './icons';

export interface DialogAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Return false to keep the dialog open. */
  run?: () => unknown;
}

export interface DialogHandle {
  el: HTMLElement;
  body: HTMLElement;
  close: () => void;
  closed: Promise<void>;
}

export interface DialogOptions {
  title: string;
  body: Node | Node[];
  actions?: DialogAction[];
  wide?: boolean;
  /** Clicking the backdrop / pressing Escape closes it (default true). */
  dismissable?: boolean;
  onClose?: () => void;
}

export function openDialog(opts: DialogOptions): DialogHandle {
  const dismissable = opts.dismissable ?? true;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  const body = h('div', { class: 'dialog-body' });
  for (const n of Array.isArray(opts.body) ? opts.body : [opts.body]) body.append(n);

  const footer = h('div', { class: 'dialog-actions' });
  const panel = h(
    'div',
    { class: `dialog ${opts.wide ? 'dialog-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    h(
      'header',
      { class: 'dialog-header' },
      h('h2', null, opts.title),
      dismissable ? h('button', { class: 'icon-btn', 'aria-label': t('close'), title: t('close'), onclick: () => close() }, icon('close')) : null,
    ),
    body,
    opts.actions?.length ? footer : null,
  );
  const backdrop = h('div', { class: 'dialog-backdrop' }, panel);
  if (dismissable) {
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  for (const a of opts.actions ?? []) {
    footer.append(
      h('button', {
        class: `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}`,
        onclick: async () => {
          const r = await a.run?.();
          if (r !== false) close();
        },
      }, a.label),
    );
  }

  let isClosed = false;
  function close() {
    if (isClosed) return;
    isClosed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('dialog-out');
    setTimeout(() => backdrop.remove(), 150);
    opts.onClose?.();
    resolveClosed();
  }

  document.body.append(backdrop);
  const focusable = panel.querySelector<HTMLElement>('input, select, textarea, .btn-primary');
  if (focusable && matchMedia('(pointer: fine)').matches) focusable.focus();
  return { el: panel, body, close, closed };
}

export function confirmDialog(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    openDialog({
      title,
      body: h('p', null, message),
      actions: [
        { label: t('cancel') },
        {
          label: okLabel,
          kind: danger ? 'danger' : 'primary',
          run: () => {
            ok = true;
          },
        },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function promptDialog(title: string, value: string, okLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h('input', { class: 'input', type: 'text', value, maxlength: 80 });
    const submit = () => {
      result = input.value.trim() || null;
    };
    const d = openDialog({
      title,
      body: input,
      actions: [{ label: t('cancel') }, { label: okLabel, kind: 'primary', run: submit }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submit();
        d.close();
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}
