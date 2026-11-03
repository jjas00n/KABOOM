// 메인 스레드 쪽: 분할 계산을 워커에 맡기고 결과 조각을 받는다
import { unpackFragments, type Fragment, type PackedFragments } from './Fragment';
import type { FractureRequest } from './pipeline';

export type { FractureJob, FractureRequest } from './pipeline';

export type FractureMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: PackedFragments }
  | { type: 'error'; message: string };

/** signal이 abort되면 워커를 바로 끝내고 이 에러로 reject한다 (건물 교체·포기) */
export class FractureAborted extends Error {
  constructor() {
    super('fracture aborted');
    this.name = 'FractureAborted';
  }
}

export function fractureInWorker(
  request: FractureRequest,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Fragment[]> {
  if (signal?.aborted) return Promise.reject(new FractureAborted());
  const worker = new Worker(new URL('./fracture.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Fragment[]>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new FractureAborted());
    };
    signal?.addEventListener('abort', abort);
    worker.onmessage = (e: MessageEvent<FractureMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total);
        return;
      }
      finish();
      if (msg.type === 'done') resolve(unpackFragments(msg.result));
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message));
    };
    worker.postMessage(
      request,
      request.jobs.map((j) => j.seeds.buffer),
    );
  });
}
