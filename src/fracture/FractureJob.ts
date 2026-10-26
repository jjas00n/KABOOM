// 메인 스레드 쪽: 분할 계산을 워커에 맡기고 결과 조각을 받는다
import type { Aabb } from './polyhedron';
import { unpackFragments, type Fragment, type PackedFragments } from './Fragment';

export interface FractureRequest {
  /** 우선 박스 도메인만 지원 (Phase 3에서 일반 볼록 다면체로 확장 가능) */
  box: Aabb;
  /** xyz 평탄화 시드. 전송 후 호출 쪽에서는 비워진다(Transferable). */
  seeds: Float64Array;
  uvScale?: number;
}

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
    worker.postMessage(request, [request.seeds.buffer]);
  });
}
