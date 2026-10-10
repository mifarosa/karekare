import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Project } from '../model/types';
import { FILE_DIRS, FormatError, audioFileName, cellFileName, fromJSON, referenceFileName, toJSON } from './serialize';

const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_TOTAL = 1536 * 1024 * 1024;

async function bytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

/** Packs a project into a portable .zip. All cells must be encoded. */
export async function projectToZip(p: Project, thumb: Blob | null): Promise<Blob> {
  const files: Zippable = {};
  for (const f of p.frames) {
    for (const id in f.cells) {
      const c = f.cells[id];
      const name = cellFileName(c);
      if (name) files[`cells/${name}`] = [await bytes(c.enc!.blob!), { level: 0 }];
    }
  }
  const audioName = p.audio ? audioFileName(p.audio) : null;
  if (p.audio && audioName) files[`audio/${audioName}`] = [await bytes(p.audio.blob), { level: 0 }];
  const refName = p.reference ? referenceFileName(p.reference) : null;
  if (p.reference && refName) files[`ref/${refName}`] = [await bytes(p.reference.blob), { level: 0 }];
  if (thumb) files['thumb.png'] = [await bytes(thumb), { level: 0 }];
  const json = toJSON(p, cellFileName, audioName, refName);
  files['project.json'] = [strToU8(JSON.stringify(json, null, 1)), { level: 6 }];
  const out = zipSync(files);
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Reads a project .zip. The returned project is not persisted yet. */
export async function projectFromZip(blob: Blob): Promise<{ project: Project; missing: number }> {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(await bytes(blob), {
      filter: (f) => {
        const wanted = f.name === 'project.json' || /^(cells|audio|ref)\/[^/]+$/.test(f.name);
        if (!wanted) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY || total > MAX_TOTAL) throw new FormatError('Archive too large');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('Not a zip file');
  }
  const manifest = entries['project.json'];
  if (!manifest) throw new FormatError('project.json missing');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifest));
  } catch {
    throw new FormatError('project.json is invalid');
  }
  const { project, missing } = await fromJSON(raw, async (name, kind) => {
    const data = entries[`${FILE_DIRS[kind]}/${name}`];
    if (!data) return null;
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: kind === 'cell' ? 'image/png' : '' });
  });
  if (project.audio && !project.audio.blob.type) {
    project.audio.blob = new Blob([project.audio.blob], { type: project.audio.mime });
  }
  for (const f of project.frames) for (const id in f.cells) f.cells[id].file = null;
  if (project.audio) project.audio.file = null;
  if (project.reference) project.reference.file = null;
  return { project, missing };
}
