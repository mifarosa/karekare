/// <reference lib="webworker" />
import { runExportJob } from './exporter';
import { ExportError, type ExportJob, type ExportMessage } from './types';

const post = (m: ExportMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<ExportJob>) => {
  try {
    let last = 0;
    const result = await runExportJob(e.data, (done, total) => {
      const now = performance.now();
      if (now - last > 80 || done === total) {
        last = now;
        post({ type: 'progress', done, total });
      }
    });
    post({ type: 'done', result });
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: err instanceof ExportError ? err.code : undefined,
    });
  }
};
