import { createCanvas, ctx2d } from '../core/canvas';
import { CellStore } from '../core/cellStore';
import { Emitter } from '../core/emitter';
import { History, type Command } from '../core/history';
import type { BrushKind } from '../core/brushes';
import { uid } from '../model/ids';
import {
  LIMITS,
  clamp,
  clampInt,
  cloneCell,
  newCell,
  newFrame,
  newLayer,
  nextLayerName,
  visibleCells,
} from '../model/project';
import { clip, union } from '../model/rect';
import type { AudioClip, Cell, Frame, Layer, Project, Rect, Reference } from '../model/types';

export type ToolId = 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'hand';

export interface BrushSettings {
  kind: BrushKind;
  size: number;
  opacity: number;
  smoothing: number;
}

export interface EraserSettings {
  size: number;
}

export interface FillSettings {
  /** 0..100 */
  tolerance: number;
  /** Pixels to grow the fill under line edges. */
  expand: number;
  /** Detect regions using all visible layers instead of the current one. */
  sampleAll: boolean;
}

export interface OnionSettings {
  enabled: boolean;
  before: number;
  after: number;
  opacity: number;
  /** Red/green tint (keeping detail) instead of the frames' real colors. */
  colored: boolean;
}

export type ReferenceProps = Partial<Pick<Reference, 'opacity' | 'visible' | 'above'>>;

export type Notice = 'layerHidden' | 'layerLocked' | 'lastFrame' | 'lastLayer';

export interface EditorEvents {
  /** Frames or layers were added, removed, reordered or retimed. */
  structure: void;
  /** Current frame or layer changed. */
  current: void;
  /** The live canvas now shows the current cell; composites can be redrawn. */
  live: void;
  /** Layer properties changed (visibility, opacity, name, lock). */
  layers: void;
  /** Pixels of a cell changed. */
  content: { frameId: string; layerId: string };
  tool: void;
  history: void;
  /** Name, fps, background or audio changed. */
  project: void;
  onion: void;
  /** The reference photo was added, moved, changed or removed. */
  reference: void;
  playback: void;
  /** Frame index shown during playback. */
  playhead: number;
  /** Something that should be saved changed. */
  dirty: void;
  notice: Notice;
}

interface LiveState {
  frameId: string;
  layerId: string;
  cell: Cell | null;
  /** Conservative bounds of the pixels on the live canvas. */
  bounds: Rect | null;
  /** Live canvas differs from `cell.img`. */
  changed: boolean;
  ready: boolean;
}

export interface EditorPrefs {
  color: string;
  brush: BrushSettings;
  eraser: EraserSettings;
  fill: FillSettings;
  onion: OnionSettings;
  layerBaseName: string;
}

/**
 * Document model of an open project: current position, tools, the live
 * canvas being edited, undoable operations and change events.
 */
export class Editor {
  readonly events = new Emitter<EditorEvents>();
  readonly history = new History();
  readonly store = new CellStore();
  readonly liveCanvas: HTMLCanvasElement;
  readonly liveCtx: CanvasRenderingContext2D;

  frameIndex: number;
  layerId: string;
  tool: ToolId = 'brush';
  color: string;
  brush: BrushSettings;
  eraser: EraserSettings;
  fill: FillSettings;
  onion: OnionSettings;
  playing = false;
  loop = true;
  /** True while a tool is modifying the live canvas. */
  editing = false;

  private live: LiveState;
  private actToken = 0;
  private leaveHooks = new Set<() => void>();
  private activation: Promise<void> = Promise.resolve();
  private layerBaseName: string;

  constructor(readonly project: Project, prefs: EditorPrefs) {
    this.color = prefs.color;
    this.brush = { ...prefs.brush };
    this.eraser = { ...prefs.eraser };
    this.fill = { ...prefs.fill };
    this.onion = { ...prefs.onion };
    this.layerBaseName = prefs.layerBaseName;
    this.frameIndex = clampInt(project.lastFrame, 0, project.frames.length - 1);
    const last = project.layers.find((l) => l.id === project.lastLayer);
    this.layerId = (last ?? project.layers[project.layers.length - 1]).id;

    this.liveCanvas = createCanvas(project.width, project.height) as HTMLCanvasElement;
    this.liveCtx = ctx2d(this.liveCanvas, true) as CanvasRenderingContext2D;
    this.live = { frameId: '', layerId: '', cell: null, bounds: null, changed: false, ready: false };
    this.history.onChange = () => this.events.emit('history');
  }

  // -------------------------------------------------------------------------
  // Accessors

  get frame(): Frame {
    return this.project.frames[this.frameIndex];
  }

  get layer(): Layer {
    return this.project.layers.find((l) => l.id === this.layerId) ?? this.project.layers[0];
  }

  get layerIndex(): number {
    return this.project.layers.findIndex((l) => l.id === this.layerId);
  }

  get liveReady(): boolean {
    return this.live.ready;
  }

  get liveBounds(): Rect | null {
    return this.live.bounds;
  }

  get liveCell(): Cell | null {
    return this.live.cell;
  }

  /**
   * Registers a hook that runs right before the editor moves away from the
   * current cell (navigation, structure changes, playback), while the live
   * canvas still belongs to it. Used to finish pending placements.
   */
  onLeave(fn: () => void): () => void {
    this.leaveHooks.add(fn);
    return () => this.leaveHooks.delete(fn);
  }

  private leave(): void {
    for (const fn of [...this.leaveHooks]) fn();
  }

  /** Resolves once the live canvas matches the current position. */
  whenReady(): Promise<void> {
    return this.activation;
  }

  // -------------------------------------------------------------------------
  // Navigation

  goToFrame(index: number): void {
    if (this.editing) return;
    index = clampInt(index, 0, this.project.frames.length - 1);
    if (index === this.frameIndex && this.live.ready) return;
    this.leave();
    this.commitLive();
    this.frameIndex = index;
    this.project.lastFrame = index;
    this.events.emit('current');
    void this.activate();
  }

  selectLayer(id: string): void {
    if (this.editing || id === this.layerId || !this.project.layers.some((l) => l.id === id)) return;
    this.leave();
    this.commitLive();
    this.layerId = id;
    this.project.lastLayer = id;
    this.events.emit('current');
    void this.activate();
  }

  setTool(tool: ToolId): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.events.emit('tool');
  }

  /** Cells needed to display the current frame and its onion skins. */
  neededCells(): Cell[] {
    const out: Cell[] = [];
    const frames = this.project.frames;
    const add = (i: number) => {
      const f = frames[i];
      if (f) for (const { cell } of visibleCells(this.project, f)) out.push(cell);
    };
    add(this.frameIndex);
    const cur = this.frame.cells[this.layerId];
    if (cur && !out.includes(cur)) out.push(cur);
    if (this.onion.enabled && !this.playing) {
      // Onion skin shows the current layer only.
      const addOnion = (i: number) => {
        const c = frames[i]?.cells[this.layerId];
        if (c) out.push(c);
      };
      for (let k = 1; k <= this.onion.before; k++) addOnion(this.frameIndex - k);
      for (let k = 1; k <= this.onion.after; k++) addOnion(this.frameIndex + k);
    }
    return out;
  }

  /** Loads the current cell onto the live canvas. */
  activate(): Promise<void> {
    const token = ++this.actToken;
    const frame = this.frame;
    const layerId = this.layerId;
    this.live = { frameId: frame.id, layerId, cell: null, bounds: null, changed: false, ready: false };
    this.store.setLive(null, null, 0, 0);
    this.activation = (async () => {
      await this.store.ensure(this.neededCells());
      if (token !== this.actToken) return;
      const cell = frame.cells[layerId] ?? null;
      if (cell && !this.store.isReady(cell)) await this.store.ensure([cell]);
      if (token !== this.actToken) return;
      const { width, height } = this.project;
      this.liveCtx.clearRect(0, 0, width, height);
      const img = cell?.img ?? null;
      if (img) this.liveCtx.drawImage(img.src, img.rect.x, img.rect.y);
      this.live = { frameId: frame.id, layerId, cell, bounds: img ? { ...img.rect } : null, changed: false, ready: true };
      this.store.setLive(cell, this.liveCanvas, width, height);
      this.events.emit('live');
      this.prefetch();
    })();
    return this.activation;
  }

  private prefetch(): void {
    const frames = this.project.frames;
    const cells: Cell[] = [];
    for (const d of [1, -1, 2]) {
      const f = frames[this.frameIndex + d];
      if (f) for (const { cell } of visibleCells(this.project, f)) cells.push(cell);
    }
    void this.store.ensure(cells);
  }

  /** Stores live canvas pixels back into the cell's image. */
  commitLive(): void {
    const l = this.live;
    if (!l.ready || !l.cell || !l.changed) return;
    const cell = l.cell;
    const b = l.bounds ? clip(l.bounds, this.project.width, this.project.height) : null;
    if (!b) {
      this.store.setImage(cell, null);
      cell.enc = { blob: null, rect: null, version: cell.version };
    } else {
      const c = createCanvas(b.w, b.h);
      ctx2d(c).drawImage(this.liveCanvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      this.store.setImage(cell, { src: c, rect: b });
    }
    l.changed = false;
  }

  // -------------------------------------------------------------------------
  // Pixel editing (used by tools)

  /** Starts modifying the live canvas. Returns false when not allowed. */
  /** Why the current layer cannot be drawn on, or null when it can. */
  editBlocker(): Notice | null {
    const layer = this.layer;
    if (!layer.visible) return 'layerHidden';
    if (layer.locked) return 'layerLocked';
    return null;
  }

  beginEdit(): boolean {
    if (!this.live.ready || this.editing || this.playing) return false;
    const blocker = this.editBlocker();
    if (blocker) {
      this.events.emit('notice', blocker);
      return false;
    }
    this.ensureLiveCell();
    this.editing = true;
    return true;
  }

  endEdit(): void {
    this.editing = false;
  }

  private ensureLiveCell(): Cell {
    const l = this.live;
    if (l.cell) return l.cell;
    const frame = this.project.frames.find((f) => f.id === l.frameId)!;
    const cell = newCell();
    cell.enc = { blob: null, rect: null, version: 0 };
    frame.cells[l.layerId] = cell;
    l.cell = cell;
    this.store.setLive(cell, this.liveCanvas, this.project.width, this.project.height);
    return cell;
  }

  /**
   * Records that live pixels changed. `rect` grows the content bounds;
   * `clear` resets them (the canvas is now empty).
   */
  liveChanged(rect: Rect | null, clear = false): void {
    const l = this.live;
    const cell = this.ensureLiveCell();
    cell.version++;
    l.changed = true;
    l.bounds = clear ? null : rect ? clip(union(l.bounds, rect)!, this.project.width, this.project.height) : l.bounds;
    this.project.modified = Date.now();
    this.events.emit('content', { frameId: l.frameId, layerId: l.layerId });
    this.events.emit('dirty');
  }

  /** Adds an undo step that swaps pixels of `rect` on the live cell. */
  pushPatch(rect: Rect, before: ImageData, after: ImageData): void {
    const { frameId, layerId } = this.live;
    this.history.push({
      bytes: rect.w * rect.h * 8,
      undo: () => this.applyPatch(frameId, layerId, rect, before),
      redo: () => this.applyPatch(frameId, layerId, rect, after),
    });
  }

  private async applyPatch(frameId: string, layerId: string, rect: Rect, data: ImageData): Promise<void> {
    const fi = this.project.frames.findIndex((f) => f.id === frameId);
    if (fi < 0 || !this.project.layers.some((l) => l.id === layerId)) return;
    if (this.live.frameId !== frameId || this.live.layerId !== layerId || !this.live.ready) {
      this.commitLive();
      this.frameIndex = fi;
      this.layerId = layerId;
      this.events.emit('current');
      await this.activate();
      if (this.live.frameId !== frameId || this.live.layerId !== layerId || !this.live.ready) return;
    }
    this.liveCtx.putImageData(data, rect.x, rect.y);
    this.liveChanged(rect);
  }

  /** Erases the current cell. */
  clearCell(): void {
    const b = this.live.bounds;
    if (!b || !this.beginEdit()) return;
    try {
      const before = this.liveCtx.getImageData(b.x, b.y, b.w, b.h);
      this.liveCtx.clearRect(b.x, b.y, b.w, b.h);
      const after = new ImageData(b.w, b.h);
      this.liveChanged(null, true);
      this.pushPatch(b, before, after);
    } finally {
      this.endEdit();
    }
  }

  /**
   * Draws onto the current cell as one undo step. `rect` must cover every
   * pixel `draw` touches. Returns false when the layer cannot be edited.
   */
  drawOnLive(rect: Rect, draw: (ctx: CanvasRenderingContext2D) => void): boolean {
    const r = clip(rect, this.project.width, this.project.height);
    if (!r || !this.beginEdit()) return false;
    const ctx = this.liveCtx;
    try {
      const before = ctx.getImageData(r.x, r.y, r.w, r.h);
      ctx.save();
      try {
        draw(ctx);
      } finally {
        ctx.restore();
      }
      const after = ctx.getImageData(r.x, r.y, r.w, r.h);
      this.liveChanged(r);
      this.pushPatch(r, before, after);
      return true;
    } finally {
      this.endEdit();
    }
  }

  // -------------------------------------------------------------------------
  // Undoable structure operations

  private structural(apply: () => void, revert: () => void): void {
    // Never restructure underneath an in-progress stroke.
    if (this.editing) return;
    this.leave();
    const cmd: Command = {
      undo: () => {
        this.commitLive();
        revert();
        this.afterStructure();
      },
      redo: () => {
        this.commitLive();
        apply();
        this.afterStructure();
      },
    };
    void cmd.redo();
    this.history.push(cmd);
  }

  private afterStructure(): void {
    const p = this.project;
    this.frameIndex = clampInt(this.frameIndex, 0, p.frames.length - 1);
    if (!p.layers.some((l) => l.id === this.layerId)) this.layerId = p.layers[p.layers.length - 1].id;
    p.lastFrame = this.frameIndex;
    p.lastLayer = this.layerId;
    p.modified = Date.now();
    this.events.emit('structure');
    this.events.emit('current');
    this.events.emit('dirty');
    void this.activate();
  }

  addFrame(): void {
    const frames = this.project.frames;
    const f = newFrame();
    const at = this.frameIndex + 1;
    const prev = this.frameIndex;
    this.structural(
      () => {
        frames.splice(at, 0, f);
        this.frameIndex = at;
      },
      () => {
        frames.splice(frames.indexOf(f), 1);
        this.frameIndex = prev;
      },
    );
  }

  /** Inserts ready-made frames after the current one as a single undo step. */
  insertFrames(newFrames: Frame[]): void {
    if (newFrames.length === 0) return;
    const frames = this.project.frames;
    const at = this.frameIndex + 1;
    const prev = this.frameIndex;
    this.structural(
      () => {
        frames.splice(at, 0, ...newFrames);
        this.frameIndex = at + newFrames.length - 1;
      },
      () => {
        for (const f of newFrames) {
          frames.splice(frames.indexOf(f), 1);
          forgetFiles(f);
        }
        this.frameIndex = prev;
      },
    );
  }

  duplicateFrame(): void {
    const frames = this.project.frames;
    const src = this.frame;
    const at = this.frameIndex + 1;
    const prev = this.frameIndex;
    let copy: Frame | null = null;
    this.structural(
      () => {
        if (!copy) {
          copy = { id: uid(), hold: src.hold, cells: {} };
          for (const id in src.cells) copy.cells[id] = cloneCell(src.cells[id]);
        }
        frames.splice(at, 0, copy);
        this.frameIndex = at;
      },
      () => {
        frames.splice(frames.indexOf(copy!), 1);
        forgetFiles(copy!);
        this.frameIndex = prev;
      },
    );
  }

  deleteFrame(): void {
    const frames = this.project.frames;
    if (frames.length <= 1) {
      this.events.emit('notice', 'lastFrame');
      return;
    }
    const idx = this.frameIndex;
    const f = frames[idx];
    this.structural(
      () => {
        frames.splice(frames.indexOf(f), 1);
        forgetFiles(f);
        this.frameIndex = Math.min(idx, frames.length - 1);
      },
      () => {
        frames.splice(idx, 0, f);
        this.frameIndex = idx;
      },
    );
  }

  moveFrame(from: number, to: number): void {
    const frames = this.project.frames;
    to = clampInt(to, 0, frames.length - 1);
    if (from === to || !frames[from]) return;
    const f = frames[from];
    this.structural(
      () => {
        frames.splice(frames.indexOf(f), 1);
        frames.splice(to, 0, f);
        this.frameIndex = to;
      },
      () => {
        frames.splice(frames.indexOf(f), 1);
        frames.splice(from, 0, f);
        this.frameIndex = from;
      },
    );
  }

  setHold(index: number, hold: number): void {
    const f = this.project.frames[index];
    hold = clampInt(hold, 1, LIMITS.maxHold);
    if (!f || f.hold === hold) return;
    const old = f.hold;
    this.structural(
      () => {
        f.hold = hold;
      },
      () => {
        f.hold = old;
      },
    );
  }

  addLayer(): void {
    const layers = this.project.layers;
    const layer = newLayer(nextLayerName(this.project, this.layerBaseName));
    const at = this.layerIndex + 1;
    const prev = this.layerId;
    this.structural(
      () => {
        layers.splice(at, 0, layer);
        this.layerId = layer.id;
      },
      () => {
        layers.splice(layers.indexOf(layer), 1);
        this.layerId = prev;
      },
    );
  }

  duplicateLayer(copySuffix: string): void {
    const p = this.project;
    const src = this.layer;
    const layer: Layer = { ...src, id: uid(), name: `${src.name} ${copySuffix}` };
    const at = this.layerIndex + 1;
    const prev = this.layerId;
    let cells: Map<Frame, Cell> | null = null;
    this.structural(
      () => {
        if (!cells) {
          cells = new Map();
          for (const f of p.frames) {
            const c = f.cells[src.id];
            if (c) cells.set(f, cloneCell(c));
          }
        }
        p.layers.splice(at, 0, layer);
        for (const [f, c] of cells) f.cells[layer.id] = c;
        this.layerId = layer.id;
      },
      () => {
        p.layers.splice(p.layers.indexOf(layer), 1);
        for (const [f, c] of cells!) {
          delete f.cells[layer.id];
          c.file = null;
        }
        this.layerId = prev;
      },
    );
  }

  deleteLayer(): void {
    const p = this.project;
    if (p.layers.length <= 1) {
      this.events.emit('notice', 'lastLayer');
      return;
    }
    const layer = this.layer;
    const idx = this.layerIndex;
    const removed = new Map<Frame, Cell>();
    this.structural(
      () => {
        p.layers.splice(p.layers.indexOf(layer), 1);
        for (const f of p.frames) {
          const c = f.cells[layer.id];
          if (!c) continue;
          removed.set(f, c);
          delete f.cells[layer.id];
          c.file = null;
        }
        this.layerId = p.layers[Math.max(0, idx - 1)].id;
      },
      () => {
        p.layers.splice(idx, 0, layer);
        for (const [f, c] of removed) f.cells[layer.id] = c;
        removed.clear();
        this.layerId = layer.id;
      },
    );
  }

  /** Moves a layer up (+1) or down (-1) in the stack. */
  moveLayer(id: string, dir: 1 | -1): void {
    const layers = this.project.layers;
    const from = layers.findIndex((l) => l.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= layers.length) return;
    // Swapping two slots is its own inverse.
    const swap = () => {
      [layers[from], layers[to]] = [layers[to], layers[from]];
    };
    this.structural(swap, swap);
  }

  /** Non-undoable layer property changes. */
  setLayerProps(id: string, props: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity'>>): void {
    const layer = this.project.layers.find((l) => l.id === id);
    if (!layer) return;
    if (props.name !== undefined) layer.name = props.name.trim().slice(0, 60) || layer.name;
    if (props.visible !== undefined) layer.visible = props.visible;
    if (props.locked !== undefined) layer.locked = props.locked;
    if (props.opacity !== undefined) layer.opacity = clamp(props.opacity, 0, 1);
    this.events.emit('layers');
    this.events.emit('dirty');
    if (props.visible) {
      // Newly visible cells may need decoding before they can be drawn.
      void this.store.ensure(this.neededCells()).then(() => this.events.emit('layers'));
    }
  }

  // -------------------------------------------------------------------------
  // Project settings

  setProjectProps(props: Partial<Pick<Project, 'name' | 'fps' | 'background'>>): void {
    const p = this.project;
    if (props.name !== undefined) p.name = props.name.trim().slice(0, 80) || p.name;
    if (props.fps !== undefined) p.fps = clampInt(props.fps, LIMITS.minFps, LIMITS.maxFps);
    if (props.background !== undefined) p.background = props.background;
    p.modified = Date.now();
    this.events.emit('project');
    this.events.emit('dirty');
  }

  setAudio(clip: AudioClip | null): void {
    this.project.audio = clip;
    this.project.modified = Date.now();
    this.events.emit('project');
    this.events.emit('dirty');
  }

  setAudioProps(props: Partial<Pick<AudioClip, 'offset' | 'volume'>>): void {
    const a = this.project.audio;
    if (!a) return;
    if (props.offset !== undefined) a.offset = Math.round(props.offset);
    if (props.volume !== undefined) a.volume = clamp(props.volume, 0, 1);
    this.events.emit('project');
    this.events.emit('dirty');
  }

  /**
   * Adds, replaces, moves or removes the reference photo as one undo step.
   * Display settings (opacity, visibility, position in the stack) are not
   * undone, so undoing a move never flips them back.
   */
  setReference(next: Reference | null): void {
    const prev = this.project.reference;
    if (next === prev) return;
    const apply = (r: Reference | null) => {
      const cur = this.project.reference;
      this.project.reference =
        r && cur && r.id === cur.id && r !== cur ? { ...r, opacity: cur.opacity, visible: cur.visible, above: cur.above } : r;
      this.project.modified = Date.now();
      this.events.emit('reference');
      this.events.emit('dirty');
    };
    apply(next);
    this.history.push({ undo: () => apply(prev), redo: () => apply(next) });
  }

  setReferenceProps(props: ReferenceProps): void {
    const r = this.project.reference;
    if (!r) return;
    if (props.opacity !== undefined) r.opacity = clamp(props.opacity, 0.05, 1);
    if (props.visible !== undefined) r.visible = props.visible;
    if (props.above !== undefined) r.above = props.above;
    this.events.emit('reference');
    this.events.emit('dirty');
  }

  setOnion(props: Partial<OnionSettings>): void {
    Object.assign(this.onion, props);
    this.events.emit('onion');
    void this.store.ensure(this.neededCells()).then(() => this.events.emit('onion'));
  }

  setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    if (playing) this.leave();
    this.playing = playing;
    this.events.emit('playback');
  }

  /** Snapshot of the live cell for background encoding, or null if busy. */
  liveSnapshot(): { cell: Cell; version: number; rect: Rect | null; bitmap: Promise<ImageBitmap> | null } | null {
    const l = this.live;
    if (!l.ready || !l.cell || this.editing) return null;
    const rect = l.bounds ? clip(l.bounds, this.project.width, this.project.height) : null;
    const bitmap = rect ? createImageBitmap(this.liveCanvas, rect.x, rect.y, rect.w, rect.h) : null;
    return { cell: l.cell, version: l.cell.version, rect, bitmap };
  }

  dispose(): void {
    this.actToken++;
    this.events.clear();
    this.store.clear();
    this.history.clear();
  }
}

/** Removed cells must be rewritten if they come back after their files were collected. */
function forgetFiles(f: Frame): void {
  for (const id in f.cells) f.cells[id].file = null;
}
