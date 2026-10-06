import { h } from './dom';

let openPop: { el: HTMLElement; close: () => void } | null = null;

export interface PopoverOptions {
  /** Preferred side relative to the anchor. */
  side?: 'right' | 'bottom' | 'top' | 'left';
  className?: string;
  onClose?: () => void;
}

/** Shows a floating panel next to `anchor`; closes on outside tap or Escape. */
export function popover(anchor: HTMLElement, content: Node, opts: PopoverOptions = {}): () => void {
  closePopover();
  const el = h('div', { class: `popover ${opts.className ?? ''}`, role: 'dialog' }, content);
  document.body.append(el);
  position(el, anchor, opts.side ?? 'bottom');

  const onDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!el.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const onResize = () => close();
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
    if (openPop?.el === el) openPop = null;
    opts.onClose?.();
  }
  openPop = { el, close };
  return close;
}

export function closePopover(): void {
  openPop?.close();
}

export function isPopoverOpen(anchorContent?: HTMLElement): boolean {
  return !!openPop && (!anchorContent || openPop.el.contains(anchorContent));
}

function position(el: HTMLElement, anchor: HTMLElement, side: string): void {
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 8;
  let x: number;
  let y: number;
  if (side === 'right') {
    x = a.right + m;
    y = a.top;
    if (x + r.width > vw - m) x = a.left - r.width - m;
  } else if (side === 'left') {
    x = a.left - r.width - m;
    y = a.top;
    if (x < m) x = a.right + m;
  } else if (side === 'top') {
    x = a.left + a.width / 2 - r.width / 2;
    y = a.top - r.height - m;
    if (y < m) y = a.bottom + m;
  } else {
    x = a.left + a.width / 2 - r.width / 2;
    y = a.bottom + m;
    if (y + r.height > vh - m) y = a.top - r.height - m;
  }
  x = Math.max(m, Math.min(x, vw - r.width - m));
  y = Math.max(m, Math.min(y, vh - r.height - m));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
