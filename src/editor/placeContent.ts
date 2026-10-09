import { createCanvas, ctx2d, parseColor, releaseCanvas, type AnyCanvas, type Ctx2D } from '../core/canvas';

/** Something that can be placed on the canvas: drawn at (0,0)-(width,height). */
export interface PlaceContent {
  readonly width: number;
  readonly height: number;
  draw(ctx: Ctx2D): void;
  dispose(): void;
}

export type TextFont = 'rounded' | 'hand' | 'serif';

export interface TextStyle {
  text: string;
  font: TextFont;
  color: string;
  outline: boolean;
}

export const FONT_FAMILIES: Record<TextFont, string> = {
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif',
  hand: '"Chalkboard SE", "Comic Sans MS", "Marker Felt", "Comic Neue", cursive',
  serif: 'Georgia, "Times New Roman", serif',
};

/** Font size at scale 1; placing scales it, and committing draws it as vectors. */
export const TEXT_BASE_SIZE = 100;

let measurer: Ctx2D | null = null;

/** Multi-line text with an optional outline in a contrasting color. */
export class TextContent implements PlaceContent {
  width = 1;
  height = 1;
  private lines: string[] = [];
  private pad = 0;
  private lineHeight = 0;

  constructor(readonly style: TextStyle) {
    this.layout();
  }

  update(props: Partial<TextStyle>): void {
    Object.assign(this.style, props);
    this.layout();
  }

  get isEmpty(): boolean {
    return this.style.text.trim() === '';
  }

  private font(): string {
    return `700 ${TEXT_BASE_SIZE}px ${FONT_FAMILIES[this.style.font]}`;
  }

  private layout(): void {
    measurer ??= ctx2d(createCanvas(1, 1));
    measurer.font = this.font();
    this.lines = (this.style.text || ' ').split('\n');
    const widest = Math.max(...this.lines.map((l) => measurer!.measureText(l).width), TEXT_BASE_SIZE * 0.3);
    this.lineHeight = TEXT_BASE_SIZE * 1.2;
    this.pad = TEXT_BASE_SIZE * (this.style.outline ? 0.14 : 0.06);
    this.width = Math.ceil(widest + this.pad * 2);
    this.height = Math.ceil(this.lineHeight * this.lines.length + this.pad * 2);
  }

  draw(ctx: Ctx2D): void {
    const { color, outline } = this.style;
    ctx.font = this.font();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = this.width / 2;
    this.lines.forEach((line, i) => {
      const y = this.pad + this.lineHeight * (i + 0.5);
      if (outline) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = TEXT_BASE_SIZE * 0.16;
        ctx.strokeStyle = contrastColor(color);
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(line, x, y);
    });
  }

  dispose(): void {}
}

/** Dark outline for light colors, white outline for dark ones. */
export function contrastColor(hex: string): string {
  const [r, g, b] = parseColor(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2430' : '#ffffff';
}

/** A decoded photo, downscaled so it is never much bigger than the canvas. */
export class PhotoContent implements PlaceContent {
  readonly width: number;
  readonly height: number;

  private constructor(private image: AnyCanvas | ImageBitmap) {
    this.width = image.width;
    this.height = image.height;
  }

  static async load(file: Blob, maxSide: number): Promise<PhotoContent> {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (s >= 1) return new PhotoContent(bmp);
    const c = createCanvas(bmp.width * s, bmp.height * s);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return new PhotoContent(c);
  }

  draw(ctx: Ctx2D): void {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.image, 0, 0);
  }

  dispose(): void {
    if ('close' in this.image) this.image.close();
    else releaseCanvas(this.image);
  }
}
