// 메인 스레드 쪽: 분할 계산을 워커에 맡기고 결과 조각을 받는다
import { unpackFragments, type Fragment, type PackedFragments } from './Fragment';
import type { FractureRequest } from './pipeline';

export type { FractureJob, FractureRequest } from './pipeline';

export type FractureMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: PackedFragments }
  | { type: 'error'; message: string };

export function fractureInWorker(
  request: FractureRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<Fragment[]> {
  const worker = new Worker(new URL('./fracture.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Fragment[]>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FractureMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total);
        return;
      }
      worker.terminate();
      if (msg.type === 'done') resolve(unpackFragments(msg.result));
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(
      request,
      request.jobs.map((j) => j.seeds.buffer),
    );
  });
}
