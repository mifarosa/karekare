import { describe, expect, it } from 'vitest';
import { History } from '../src/core/history';

describe('History', () => {
  it('undoes and redoes in order', async () => {
    const h = new History();
    const log: string[] = [];
    let value = 0;
    for (const n of [1, 2, 3]) {
      const before = value;
      value = n;
      h.push({ undo: () => void (value = before, log.push(`u${n}`)), redo: () => void (value = n, log.push(`r${n}`)) });
    }
    await h.undo();
    await h.undo();
    expect(value).toBe(1);
    await h.redo();
    expect(value).toBe(2);
    expect(log).toEqual(['u3', 'u2', 'r2']);
    expect(h.canRedo).toBe(true);
  });

  it('drops redo steps after a new command', async () => {
    const h = new History();
    h.push({ undo() {}, redo() {} });
    await h.undo();
    h.push({ undo() {}, redo() {} });
    expect(h.canRedo).toBe(false);
  });

  it('enforces step and memory limits', async () => {
    const countUndos = async (h: History) => {
      let n = 0;
      while (h.canUndo && n < 10) {
        await h.undo();
        n++;
      }
      return n;
    };
    const bySteps = new History({ maxSteps: 3, maxBytes: 100 });
    for (let i = 0; i < 5; i++) bySteps.push({ undo() {}, redo() {}, bytes: 10 });
    expect(await countUndos(bySteps)).toBe(3);

    const byBytes = new History({ maxSteps: 50, maxBytes: 100 });
    for (let i = 0; i < 5; i++) byBytes.push({ undo() {}, redo() {}, bytes: 60 });
    // The newest step is always kept even when it alone exceeds the budget.
    expect(await countUndos(byBytes)).toBe(1);
  });

  it('serializes async undo operations', async () => {
    const h = new History();
    const order: string[] = [];
    const slow = (name: string) => ({
      undo: () => new Promise<void>((r) => setTimeout(() => (order.push(name), r()), 10)),
      redo() {},
    });
    h.push(slow('a'));
    h.push(slow('b'));
    void h.undo();
    void h.undo();
    await h.idle();
    expect(order).toEqual(['b', 'a']);
  });
});
