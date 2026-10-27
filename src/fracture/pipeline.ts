// 분할 파이프라인: 박스 여러 개(부재)를 각각 보로노이 분할 → 부재 간 접촉 이웃 추가 → 조각 생성.
// 워커와 테스트가 같이 쓴다 (DOM/three 의존 없음).
import { FRACTURE } from '../config';
import { addContactNeighbors, findBoxContacts } from './contacts';
import { buildFragment, MATERIAL, type Fragment, type MaterialId } from './Fragment';
import { boxPolyhedron, type Aabb } from './polyhedron';
import { voronoiCells, type VoronoiCell } from './voronoi';

export interface FractureJob {
  box: Aabb;
  /** xyz 평탄화 시드. 워커로 보내면 호출 쪽에서는 비워진다(Transferable). */
  seeds: Float64Array;
  material?: MaterialId;
}

export interface FractureRequest {
  jobs: FractureJob[];
  uvScale?: number;
  /** 맞닿은 부재끼리 이웃 엣지를 만들지 (기본 true) */
  connectJobs?: boolean;
}

/**
 * 반환 조각 순서 = 작업 순서대로 이어 붙인 셀 순서. 조각의 member = 작업 인덱스.
 * 이웃 인덱스는 전체 조각 배열 기준.
 */
export function runFracture(
  request: FractureRequest,
  onProgress?: (done: number, total: number) => void,
): Fragment[] {
  const { jobs, uvScale = FRACTURE.uvScale, connectJobs = true } = request;
  const total = jobs.reduce((s, j) => s + j.seeds.length / 3, 0);
  let done = 0;
  let reported = 0;
  const report = (n: number) => {
    if (!onProgress || n - reported < FRACTURE.progressEvery) return;
    reported = n;
    onProgress(n, total);
  };

  const cells: VoronoiCell[] = [];
  const cellMember: number[] = [];
  const memberCells: [number, number][] = [];
  jobs.forEach((job, k) => {
    const local = voronoiCells(boxPolyhedron(job.box.min, job.box.max), job.seeds, (d) =>
      report(done + d),
    );
    const offset = cells.length;
    for (const cell of local) {
      // 부재 안 이웃 인덱스를 전체 인덱스로
      const neighbors = new Map<number, number>();
      for (const [j, area] of cell.neighbors) neighbors.set(j + offset, area);
      cells.push({ ...cell, neighbors });
      cellMember.push(k);
    }
    memberCells.push([offset, cells.length]);
    done += job.seeds.length / 3;
    report(done);
  });

  if (connectJobs && jobs.length > 1) {
    addContactNeighbors(cells, memberCells, findBoxContacts(jobs.map((j) => j.box)));
  }
  onProgress?.(total, total);

  return cells.map((cell, i) => {
    const member = cellMember[i]!;
    const job = jobs[member]!;
    return buildFragment(cell, uvScale, member, job.material ?? MATERIAL.concrete, job.box.min);
  });
}
