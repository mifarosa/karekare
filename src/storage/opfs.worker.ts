/// <reference lib="webworker" />
// Writes files into the Origin Private File System. Sync access handles are
// only available in workers and are supported by more browsers than
// createWritable(), so all writes go through here, one at a time.

interface WriteRequest {
  id: number;
  path: string;
  data: Blob | string;
}

interface SyncHandle {
  truncate(size: number): void | Promise<void>;
  write(buf: Uint8Array, opts: { at: number }): number;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<WriteRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      await writeFile(req.path, req.data);
      self.postMessage({ id: req.id, ok: true });
    } catch (err) {
      const name = err instanceof Error || err instanceof DOMException ? err.name : 'Error';
      self.postMessage({ id: req.id, ok: false, name, error: String(err) });
    }
  });
};

async function writeFile(path: string, data: Blob | string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());

  const createSync = (fh as unknown as { createSyncAccessHandle?: () => Promise<SyncHandle> }).createSyncAccessHandle;
  if (createSync) {
    const h = await createSync.call(fh);
    try {
      await h.truncate(0);
      let at = 0;
      while (at < bytes.length) {
        const n = h.write(bytes.subarray(at), { at });
        if (!n) throw new Error('Short write');
        at += n;
      }
      await h.flush();
    } finally {
      await h.close();
    }
    return;
  }
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}
