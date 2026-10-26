// 분할 계산 Web Worker (Transferable 버퍼 전달)
import { buildFragments, packFragments, transferablesOf } from './Fragment';
import type { FractureMessage, FractureRequest } from './FractureJob';
import { boxPolyhedron } from './polyhedron';
import { voronoiCells } from './voronoi';

const post = (msg: FractureMessage, transfer: Transferable[] = []) =>
  self.postMessage(msg, { transfer });

self.onmessage = (e: MessageEvent<FractureRequest>) => {
  try {
    const { box, seeds, uvScale } = e.data;
    const cells = voronoiCells(boxPolyhedron(box.min, box.max), seeds, (done, total) =>
      post({ type: 'progress', done, total }),
    );
    const result = packFragments(buildFragments(cells, uvScale));
    post({ type: 'done', result }, transferablesOf(result));
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
