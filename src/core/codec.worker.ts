/// <reference lib="webworker" />
import type { Rect } from '../model/types';
import { trimAndEncode } from './cellCodec';

interface EncodeRequest {
  id: number;
  bitmap: ImageBitmap;
  rect: Rect;
}

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, rect } = e.data;
  try {
    const result = await trimAndEncode(bitmap, rect);
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  } finally {
    bitmap.close();
  }
};
