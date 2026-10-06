import { MemoryFileStore, type FileStore } from './fileStore';

interface Pending {
  resolve: () => void;
  reject: (e: Error) => void;
}

export class StorageError extends Error {
  constructor(message: string, readonly quota: boolean) {
    super(message);
  }
}

/** FileStore on the Origin Private File System. */
export class OpfsFileStore implements FileStore {
  readonly persistent = true;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private constructor(private root: FileSystemDirectoryHandle) {
    this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, ok, name, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve();
      else p.reject(new StorageError(error, name === 'QuotaExceededError'));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new StorageError(e.message || 'Storage worker failed', false));
      this.pending.clear();
    };
  }

  static async open(): Promise<OpfsFileStore | null> {
    try {
      if (!navigator.storage?.getDirectory) return null;
      const root = await navigator.storage.getDirectory();
      const store = new OpfsFileStore(root);
      // Probe: some browsers expose OPFS but fail on write (e.g. private mode).
      await store.write('.probe', 'ok');
      const back = await store.read('.probe');
      if (!back || (await back.text()) !== 'ok') return null;
      await store.remove('.probe');
      return store;
    } catch (err) {
      console.warn('OPFS unavailable', err);
      return null;
    }
  }

  write(path: string, data: Blob | string): Promise<void> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, path, data });
    });
  }

  async read(path: string): Promise<Blob | null> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    try {
      const dir = await this.dir(parts, false);
      if (!dir) return null;
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      // Copy into memory so the blob stays readable after the file changes.
      return new Blob([await file.arrayBuffer()], { type: file.type });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    try {
      const dir = await this.dir(parts, false);
      await dir?.removeEntry(name, { recursive: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async list(path: string): Promise<string[]> {
    const dir = await this.dir(path.split('/').filter(Boolean), false);
    if (!dir) return [];
    const names: string[] = [];
    const iter = (dir as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const name of iter) names.push(name);
    return names;
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = this.root;
    try {
      for (const p of parts) d = await d.getDirectoryHandle(p, { create });
      return d;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');
}

/** Opens persistent storage, falling back to memory. */
export async function openFileStore(): Promise<FileStore> {
  const opfs = await OpfsFileStore.open();
  if (opfs) {
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage.persist?.().catch(() => {});
    return opfs;
  }
  return new MemoryFileStore();
}
