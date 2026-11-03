// 분할 파이프라인: 박스 여러 개(부재)를 각각 보로노이 분할 → 부재 간 접촉 이웃 추가 → 조각 생성.
// 워커와 테스트가 같이 쓴다 (DOM/three 의존 없음).
import { FRACTURE } from '../config';
import { addContactNeighbors, findBoxContacts, findPlaneContacts } from './contacts';
import { buildFragment, MATERIAL, type Fragment, type MaterialId } from './Fragment';
import {
  clippedBox,
  polygonArea,
  scalePolyhedron,
  volumeAndCentroid,
  type Aabb,
  type Plane,
  type Polyhedron,
} from './polyhedron';
import { voronoiCells, type VoronoiCell } from './voronoi';

export interface FractureJob {
  /** 부재 박스 (볼록 부재면 바운딩 박스). UV 원점 = box.min */
  box: Aabb;
  /** 볼록 부재: 박스를 이 반공간들로 자른 모양 (없으면 박스) */
  planes?: readonly Plane[];
  /**
   * 나뭇결: 이 축을 stretch배 줄인 공간에서 분할한 뒤 되돌린다 → 결 방향으로 길쭉한 조각.
   * (보로노이는 유클리드 거리라 시드 간격만 늘려서는 셀이 길어지지 않는다)
   */
  grain?: { axis: 0 | 1 | 2; stretch: number };
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
  const polys = jobs.map((job) => clippedBox(job.box, job.planes));
  jobs.forEach((job, k) => {
    const local = job.grain
      ? grainCells(polys[k]!, job.seeds, job.grain, (d) => report(done + d))
      : voronoiCells(polys[k]!, job.seeds, (d) => report(done + d));
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
    // 박스끼리는 축 정렬 접촉 (office는 전부 이 경로), 볼록 부재가 낀 쌍은 평면 접촉
    const convex = jobs.map((j) => (j.planes?.length ?? 0) > 0);
    const boxes = jobs.map((j) => j.box);
    const boxContacts = findBoxContacts(boxes).filter((c) => !convex[c.lo] && !convex[c.hi]);
    const planeContacts = convex.some(Boolean) ? findPlaneContacts(polys, boxes, convex) : [];
    addContactNeighbors(cells, memberCells, boxContacts, planeContacts);
  }
  onProgress?.(total, total);

  return cells.map((cell, i) => {
    const member = cellMember[i]!;
    const job = jobs[member]!;
    return buildFragment(cell, uvScale, member, job.material ?? MATERIAL.concrete, job.box.min);
  });
}

/** 결 방향 축을 1/stretch로 줄인 공간에서 보로노이 → 셀을 원래 공간으로 늘리고 부피·중심·공유 면적을 다시 잰다 */
function grainCells(
  domain: Polyhedron,
  seeds: Float64Array,
  grain: { axis: 0 | 1 | 2; stretch: number },
  onProgress: (done: number) => void,
): VoronoiCell[] {
  const shrink: [number, number, number] = [1, 1, 1];
  shrink[grain.axis] = 1 / grain.stretch;
  const scaled = Float64Array.from(seeds, (v, k) => v * shrink[k % 3]!);
  const cells = voronoiCells(
    scalePolyhedron(domain, shrink[0], shrink[1], shrink[2]),
    scaled,
    onProgress,
  );
  const [gx, gy, gz] = shrink.map((s) => 1 / s) as [number, number, number];
  return cells.map((cell) => {
    const poly = scalePolyhedron(cell.poly, gx, gy, gz);
    const { volume, centroid } = volumeAndCentroid(poly);
    const neighbors = new Map<number, number>();
    for (const f of poly.faces) {
      if (f.neighbor < 0 || !cell.neighbors.has(f.neighbor)) continue; // 퇴화로 빠진 셀 제외
      const area = polygonArea(f.verts, f.nx, f.ny, f.nz);
      neighbors.set(f.neighbor, (neighbors.get(f.neighbor) ?? 0) + area);
    }
    return { seedIndex: cell.seedIndex, poly, volume, centroid, neighbors };
  });
}
