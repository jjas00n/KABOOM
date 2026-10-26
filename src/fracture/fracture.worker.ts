// 분할 계산 Web Worker (Transferable 버퍼 전달)
import { packFragments, transferablesOf } from './Fragment';
import type { FractureMessage } from './FractureJob';
import { runFracture, type FractureRequest } from './pipeline';

const post = (msg: FractureMessage, transfer: Transferable[] = []) =>
  self.postMessage(msg, { transfer });

self.onmessage = (e: MessageEvent<FractureRequest>) => {
  try {
    const frags = runFracture(e.data, (done, total) => post({ type: 'progress', done, total }));
    const result = packFragments(frags);
    post({ type: 'done', result }, transferablesOf(result));
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
