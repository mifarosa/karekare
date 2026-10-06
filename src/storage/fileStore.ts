/** Minimal hierarchical file storage used for projects. Paths use "/". */
export interface FileStore {
  /** False when data is lost on reload (no OPFS available). */
  readonly persistent: boolean;
  read(path: string): Promise<Blob | null>;
  write(path: string, data: Blob | string): Promise<void>;
  /** Removes a file or a directory (recursively). Missing paths are ignored. */
  remove(path: string): Promise<void>;
  /** Entry names inside a directory; empty when it does not exist. */
  list(dir: string): Promise<string[]>;
}

/** In-memory store, used when OPFS is unavailable and in tests. */
export class MemoryFileStore implements FileStore {
  readonly persistent = false;
  private files = new Map<string, Blob>();

  async read(path: string): Promise<Blob | null> {
    return this.files.get(norm(path)) ?? null;
  }

  async write(path: string, data: Blob | string): Promise<void> {
    this.files.set(norm(path), typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data);
  }

  async remove(path: string): Promise<void> {
    const p = norm(path);
    this.files.delete(p);
    for (const key of [...this.files.keys()]) if (key.startsWith(p + '/')) this.files.delete(key);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = norm(dir) + '/';
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  }
}

export function norm(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}
