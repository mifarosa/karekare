import type { Project, ProjectSummary } from '../model/types';
import { uid } from '../model/ids';
import type { FileStore } from './fileStore';
import { FORMAT, audioFileName, cellFileName, fromJSON, toJSON, type ProjectJSON } from './serialize';

const ROOT = 'projects';
const dirOf = (id: string) => `${ROOT}/${id}`;
const SLOTS = ['a', 'b'] as const;

/**
 * Projects stored as `projects/<id>/` with PNG cells, an audio file and two
 * alternating JSON manifests. A crash while writing one manifest leaves the
 * other (and every file it references) intact.
 */
export class ProjectRepo {
  private seqs = new Map<string, number>();

  constructor(readonly fs: FileStore) {}

  get persistent(): boolean {
    return this.fs.persistent;
  }

  async list(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const id of await this.fs.list(ROOT)) {
      const j = await this.readJSON(id);
      if (!j) continue;
      out.push({
        id,
        name: j.name,
        width: j.width,
        height: j.height,
        fps: j.fps,
        frames: Array.isArray(j.frames) ? j.frames.length : 0,
        modified: j.modified,
      });
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  private async readJSON(id: string): Promise<ProjectJSON | null> {
    let best: ProjectJSON | null = null;
    for (const slot of SLOTS) {
      const blob = await this.fs.read(`${dirOf(id)}/project-${slot}.json`);
      if (!blob) continue;
      try {
        const j = JSON.parse(await blob.text()) as ProjectJSON;
        if (j?.format === FORMAT && (!best || (j.seq ?? 0) > (best.seq ?? 0))) best = j;
      } catch {
        // Torn write; the other slot wins.
      }
    }
    if (best) this.seqs.set(id, Math.max(this.seqs.get(id) ?? 0, best.seq ?? 0));
    return best;
  }

  async load(id: string): Promise<{ project: Project; missing: number }> {
    const j = await this.readJSON(id);
    if (!j) throw new Error('Project not found');
    const dir = dirOf(id);
    const { project, missing } = await fromJSON(j, (name, kind) =>
      this.fs.read(`${dir}/${kind === 'cell' ? 'cells' : 'audio'}/${name}`),
    );
    project.id = id;
    return { project, missing };
  }

  /** Writes changed files, then the manifest, then removes unused files. */
  async save(p: Project): Promise<void> {
    const dir = dirOf(p.id);
    const keep = new Set<string>();
    for (const f of p.frames) {
      for (const layerId in f.cells) {
        const c = f.cells[layerId];
        const name = cellFileName(c);
        if (!name) continue;
        if (c.file !== name) {
          await this.fs.write(`${dir}/cells/${name}`, c.enc!.blob!);
          c.file = name;
        }
        keep.add(name);
      }
    }
    let audioFile: string | null = null;
    if (p.audio) {
      audioFile = audioFileName(p.audio);
      if (p.audio.file !== audioFile) {
        await this.fs.write(`${dir}/audio/${audioFile}`, p.audio.blob);
        p.audio.file = audioFile;
      }
    }

    const seq = (this.seqs.get(p.id) ?? 0) + 1;
    const json: ProjectJSON = { ...toJSON(p, (c) => c.file, audioFile), seq };
    await this.fs.write(`${dir}/project-${SLOTS[seq % 2]}.json`, JSON.stringify(json));
    this.seqs.set(p.id, seq);

    for (const name of await this.fs.list(`${dir}/cells`)) {
      if (!keep.has(name)) await this.fs.remove(`${dir}/cells/${name}`);
    }
    for (const name of await this.fs.list(`${dir}/audio`)) {
      if (name !== audioFile) await this.fs.remove(`${dir}/audio/${name}`);
    }
  }

  /** Stores a project that came from elsewhere (new, imported, duplicated). */
  async insert(p: Project): Promise<void> {
    const existing = await this.fs.list(ROOT);
    if (existing.includes(p.id)) p.id = uid();
    for (const f of p.frames) for (const id in f.cells) f.cells[id].file = null;
    if (p.audio) p.audio.file = null;
    await this.save(p);
  }

  async rename(id: string, name: string): Promise<void> {
    const j = await this.readJSON(id);
    if (!j) return;
    const seq = (this.seqs.get(id) ?? 0) + 1;
    const next: ProjectJSON = { ...j, name: name.trim().slice(0, 80) || j.name, modified: Date.now(), seq };
    await this.fs.write(`${dirOf(id)}/project-${SLOTS[seq % 2]}.json`, JSON.stringify(next));
    this.seqs.set(id, seq);
  }

  async duplicate(id: string, name: string): Promise<string> {
    const { project } = await this.load(id);
    project.id = uid();
    project.name = name;
    project.created = project.modified = Date.now();
    await this.insert(project);
    const thumb = await this.readThumb(id);
    if (thumb) await this.saveThumb(project.id, thumb);
    return project.id;
  }

  async delete(id: string): Promise<void> {
    await this.fs.remove(dirOf(id));
    this.seqs.delete(id);
  }

  saveThumb(id: string, blob: Blob): Promise<void> {
    return this.fs.write(`${dirOf(id)}/thumb.png`, blob);
  }

  readThumb(id: string): Promise<Blob | null> {
    return this.fs.read(`${dirOf(id)}/thumb.png`);
  }
}
