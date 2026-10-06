export interface Command {
  /** Approximate memory held by the command, for the history budget. */
  bytes?: number;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export interface HistoryOptions {
  maxSteps?: number;
  maxBytes?: number;
}

/** Linear undo/redo stack. Undo and redo calls are serialized. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private queue: Promise<void> = Promise.resolve();
  private bytes = 0;
  private readonly maxSteps: number;
  private readonly maxBytes: number;
  onChange: () => void = () => {};

  constructor(opts: HistoryOptions = {}) {
    this.maxSteps = opts.maxSteps ?? 60;
    this.maxBytes = opts.maxBytes ?? 160 * 1024 * 1024;
  }

  /** Records a command whose effect has already been applied. */
  push(cmd: Command): void {
    for (const c of this.redoStack) this.bytes -= c.bytes ?? 0;
    this.redoStack = [];
    this.undoStack.push(cmd);
    this.bytes += cmd.bytes ?? 0;
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.maxSteps || this.bytes > this.maxBytes)
    ) {
      const dropped = this.undoStack.shift()!;
      this.bytes -= dropped.bytes ?? 0;
    }
    this.onChange();
  }

  /** Applies a command and records it. */
  async exec(cmd: Command): Promise<void> {
    await this.enqueue(async () => {
      await cmd.redo();
    });
    this.push(cmd);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      const cmd = this.undoStack.pop();
      if (!cmd) return;
      try {
        await cmd.undo();
        this.redoStack.push(cmd);
      } catch (err) {
        console.error('Undo failed', err);
        this.bytes -= cmd.bytes ?? 0;
      }
      this.onChange();
    });
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      const cmd = this.redoStack.pop();
      if (!cmd) return;
      try {
        await cmd.redo();
        this.undoStack.push(cmd);
      } catch (err) {
        console.error('Redo failed', err);
        this.bytes -= cmd.bytes ?? 0;
      }
      this.onChange();
    });
  }

  /** Resolves when all queued undo/redo operations are done. */
  idle(): Promise<void> {
    return this.queue;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange();
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
}
