import { describe, expect, it } from 'vitest';
import { createProject, newCell, newFrame, newLayer } from '../src/model/project';
import type { Cell, Project } from '../src/model/types';
import { MemoryFileStore } from '../src/storage/fileStore';
import { ProjectRepo } from '../src/storage/repo';
import { projectFromZip, projectToZip } from '../src/storage/zip';

function encodedCell(bytes: number[], rect = { x: 1, y: 2, w: 3, h: 4 }): Cell {
  const c = newCell();
  c.enc = { blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), rect, version: c.version };
  return c;
}

function sample(): Project {
  const p = createProject({ name: 'Test', width: 64, height: 48, fps: 8, background: '#fafafa' }, 'L1');
  const l2 = newLayer('L2');
  p.layers.push(l2);
  p.frames[0].cells[p.layers[0].id] = encodedCell([1, 2, 3]);
  const f2 = newFrame(3);
  f2.cells[l2.id] = encodedCell([4, 5], { x: 0, y: 0, w: 10, h: 10 });
  p.frames.push(f2);
  p.audio = {
    id: 'aud1',
    name: 'voice.wav',
    blob: new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/wav' }),
    mime: 'audio/wav',
    offset: 2,
    volume: 0.5,
    file: null,
  };
  return p;
}

async function bytesOf(b: Blob | null | undefined): Promise<number[]> {
  return b ? Array.from(new Uint8Array(await b.arrayBuffer())) : [];
}

describe('ProjectRepo', () => {
  it('round-trips a project', async () => {
    const fs = new MemoryFileStore();
    const repo = new ProjectRepo(fs);
    const p = sample();
    await repo.save(p);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.id, name: 'Test', frames: 2, fps: 8 });

    const { project, missing } = await new ProjectRepo(fs).load(p.id);
    expect(missing).toBe(0);
    expect(project.layers.map((l) => l.name)).toEqual(['L1', 'L2']);
    expect(project.frames.map((f) => f.hold)).toEqual([1, 3]);
    const c1 = project.frames[0].cells[p.layers[0].id];
    expect(c1.enc!.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(await bytesOf(c1.enc!.blob)).toEqual([1, 2, 3]);
    expect(project.audio).toMatchObject({ name: 'voice.wav', offset: 2, volume: 0.5 });
    expect(await bytesOf(project.audio!.blob)).toEqual([9, 9, 9]);
  });

  it('only rewrites changed cells and removes unused files', async () => {
    const fs = new MemoryFileStore();
    const repo = new ProjectRepo(fs);
    const p = sample();
    await repo.save(p);
    const dir = `projects/${p.id}/cells`;
    const before = await fs.list(dir);
    expect(before).toHaveLength(2);

    // Change one cell and delete the other frame.
    const cell = p.frames[0].cells[p.layers[0].id];
    cell.version++;
    cell.enc = { blob: new Blob([new Uint8Array([7])]), rect: { x: 0, y: 0, w: 1, h: 1 }, version: cell.version };
    p.frames.pop();
    await repo.save(p);
    const after = await fs.list(dir);
    expect(after).toEqual([`${cell.id}-${cell.version}.png`]);
  });

  it('falls back to the other manifest when one is corrupt', async () => {
    const fs = new MemoryFileStore();
    const repo = new ProjectRepo(fs);
    const p = sample();
    await repo.save(p); // seq 1 -> slot b
    p.name = 'Renamed';
    await repo.save(p); // seq 2 -> slot a
    await fs.write(`projects/${p.id}/project-a.json`, '{"format":"kare'); // torn write
    const { project } = await new ProjectRepo(fs).load(p.id);
    expect(project.name).toBe('Test');
    expect(project.frames).toHaveLength(2);
  });

  it('assigns a new id when inserting a duplicate', async () => {
    const repo = new ProjectRepo(new MemoryFileStore());
    const p = sample();
    await repo.insert(p);
    const id = p.id;
    const copy = await repo.duplicate(id, 'Copy');
    expect(copy).not.toBe(id);
    expect((await repo.list()).map((s) => s.name).sort()).toEqual(['Copy', 'Test']);
  });
});

describe('zip project files', () => {
  it('round-trips through a zip', async () => {
    const p = sample();
    const zip = await projectToZip(p, null);
    const { project, missing } = await projectFromZip(zip);
    expect(missing).toBe(0);
    expect(project.name).toBe('Test');
    expect(project.frames[1].hold).toBe(3);
    const l2 = project.layers[1].id;
    expect(await bytesOf(project.frames[1].cells[l2].enc!.blob)).toEqual([4, 5]);
    expect(project.frames[1].cells[l2].file).toBeNull();
    expect(project.audio!.mime).toBe('audio/wav');
    expect(project.audio!.blob.type).toBe('audio/wav');
  });

  it('rejects files that are not projects', async () => {
    await expect(projectFromZip(new Blob(['hello']))).rejects.toThrow();
  });

  it('drops cells with invalid geometry', async () => {
    const p = sample();
    p.frames[0].cells[p.layers[0].id].enc!.rect = { x: 60, y: 0, w: 10, h: 10 }; // outside 64x48
    const { project } = await projectFromZip(await projectToZip(p, null));
    expect(Object.keys(project.frames[0].cells)).toHaveLength(0);
  });
});
