// 조각 데이터: 정점/인덱스/법선/UV, 면 플래그, 부피, 질량중심
// + 워커 ↔ 메인 전송용 패킹(조각 전부를 몇 개의 큰 TypedArray로 이어 붙여 Transferable로 넘김)
import { FRACTURE } from '../config';
import { EXTERIOR, uniqueVertices, type Vec3Like } from './polyhedron';
import type { VoronoiCell } from './voronoi';

export interface Fragment {
  /** 월드 좌표 질량중심. 아래 정점 좌표는 전부 이 점 기준 로컬 좌표. */
  centroid: Vec3Like;
  volume: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /**
   * 면 플래그 = 인덱스 순서. [0, exteriorIndexCount) 는 원래 외부면 삼각형,
   * 나머지는 절단 단면 삼각형. 재질 그룹을 이 경계로 나눈다.
   */
  indices: Uint32Array;
  exteriorIndexCount: number;
  /** 중복 없는 정점 (convexHull 콜라이더용, 로컬 좌표) */
  hull: Float32Array;
  /** 면을 공유하는 이웃 조각 인덱스와 공유 면적(m^2), 같은 순서 */
  neighbors: Uint32Array;
  neighborAreas: Float32Array;
}

export function buildFragments(
  cells: readonly VoronoiCell[],
  uvScale: number = FRACTURE.uvScale,
): Fragment[] {
  return cells.map((cell) => buildFragment(cell, uvScale));
}

export function buildFragment(cell: VoronoiCell, uvScale: number = FRACTURE.uvScale): Fragment {
  const { poly, centroid: c } = cell;
  // 외부면을 먼저 쌓아 인덱스 범위로 재질 그룹을 나눌 수 있게 한다
  const ordered = [
    ...poly.faces.filter((f) => f.neighbor === EXTERIOR),
    ...poly.faces.filter((f) => f.neighbor !== EXTERIOR),
  ];

  let vertexCount = 0;
  let indexCount = 0;
  for (const f of ordered) {
    const n = f.verts.length / 3;
    vertexCount += n;
    indexCount += (n - 2) * 3;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  let exteriorIndexCount = 0;
  let vi = 0;
  let ii = 0;
  for (const f of ordered) {
    const v = f.verts;
    const n = v.length / 3;
    // 법선의 주축으로 평면 투영 (월드 좌표 기준이라 조각 사이 텍스처가 이어진다)
    const ax = Math.abs(f.nx);
    const ay = Math.abs(f.ny);
    const az = Math.abs(f.nz);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const x = v[k * 3]!;
      const y = v[k * 3 + 1]!;
      const z = v[k * 3 + 2]!;
      positions[(vi + k) * 3] = x - c.x;
      positions[(vi + k) * 3 + 1] = y - c.y;
      positions[(vi + k) * 3 + 2] = z - c.z;
      normals[(vi + k) * 3] = f.nx;
      normals[(vi + k) * 3 + 1] = f.ny;
      normals[(vi + k) * 3 + 2] = f.nz;
      uvs[(vi + k) * 2] = (axis === 0 ? z : x) * uvScale;
      uvs[(vi + k) * 2 + 1] = (axis === 1 ? z : y) * uvScale;
    }
    for (let k = 1; k + 1 < n; k++) {
      indices[ii++] = vi;
      indices[ii++] = vi + k;
      indices[ii++] = vi + k + 1;
    }
    vi += n;
    if (f.neighbor === EXTERIOR) exteriorIndexCount = ii;
  }

  const unique = uniqueVertices(poly);
  const hull = new Float32Array(unique.length);
  for (let k = 0; k < unique.length; k += 3) {
    hull[k] = unique[k]! - c.x;
    hull[k + 1] = unique[k + 1]! - c.y;
    hull[k + 2] = unique[k + 2]! - c.z;
  }

  const neighbors = new Uint32Array(cell.neighbors.size);
  const neighborAreas = new Float32Array(cell.neighbors.size);
  let k = 0;
  for (const [j, area] of cell.neighbors) {
    neighbors[k] = j;
    neighborAreas[k] = area;
    k++;
  }

  return {
    centroid: { ...c },
    volume: cell.volume,
    positions,
    normals,
    uvs,
    indices,
    exteriorIndexCount,
    hull,
    neighbors,
    neighborAreas,
  };
}

/** 조각 묶음을 이어 붙인 형태. 모든 버퍼는 Transferable. */
export interface PackedFragments {
  count: number;
  /** 조각마다 RANGE_STRIDE개: 정점 수, 인덱스 수, 외부면 인덱스 수, hull 점 수, 이웃 수 */
  ranges: Uint32Array;
  centroids: Float64Array;
  volumes: Float64Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  hull: Float32Array;
  neighbors: Uint32Array;
  neighborAreas: Float32Array;
}

const RANGE_STRIDE = 5;

export function packFragments(frags: readonly Fragment[]): PackedFragments {
  const sum = (fn: (f: Fragment) => number) => frags.reduce((s, f) => s + fn(f), 0);
  const p: PackedFragments = {
    count: frags.length,
    ranges: new Uint32Array(frags.length * RANGE_STRIDE),
    centroids: new Float64Array(frags.length * 3),
    volumes: new Float64Array(frags.length),
    positions: new Float32Array(sum((f) => f.positions.length)),
    normals: new Float32Array(sum((f) => f.normals.length)),
    uvs: new Float32Array(sum((f) => f.uvs.length)),
    indices: new Uint32Array(sum((f) => f.indices.length)),
    hull: new Float32Array(sum((f) => f.hull.length)),
    neighbors: new Uint32Array(sum((f) => f.neighbors.length)),
    neighborAreas: new Float32Array(sum((f) => f.neighborAreas.length)),
  };
  let pos = 0;
  let uv = 0;
  let idx = 0;
  let hull = 0;
  let nb = 0;
  frags.forEach((f, i) => {
    p.ranges.set(
      [
        f.positions.length / 3,
        f.indices.length,
        f.exteriorIndexCount,
        f.hull.length / 3,
        f.neighbors.length,
      ],
      i * RANGE_STRIDE,
    );
    p.centroids.set([f.centroid.x, f.centroid.y, f.centroid.z], i * 3);
    p.volumes[i] = f.volume;
    p.positions.set(f.positions, pos);
    p.normals.set(f.normals, pos);
    p.uvs.set(f.uvs, uv);
    p.indices.set(f.indices, idx);
    p.hull.set(f.hull, hull);
    p.neighbors.set(f.neighbors, nb);
    p.neighborAreas.set(f.neighborAreas, nb);
    pos += f.positions.length;
    uv += f.uvs.length;
    idx += f.indices.length;
    hull += f.hull.length;
    nb += f.neighbors.length;
  });
  return p;
}

/** 패킹된 버퍼를 조각 배열로 되돌린다. 복사 없이 subarray 뷰를 쓴다. */
export function unpackFragments(p: PackedFragments): Fragment[] {
  const frags: Fragment[] = [];
  let pos = 0;
  let uv = 0;
  let idx = 0;
  let hull = 0;
  let nb = 0;
  for (let i = 0; i < p.count; i++) {
    const r = i * RANGE_STRIDE;
    const vertexCount = p.ranges[r]!;
    const indexCount = p.ranges[r + 1]!;
    const hullCount = p.ranges[r + 3]!;
    const neighborCount = p.ranges[r + 4]!;
    frags.push({
      centroid: { x: p.centroids[i * 3]!, y: p.centroids[i * 3 + 1]!, z: p.centroids[i * 3 + 2]! },
      volume: p.volumes[i]!,
      positions: p.positions.subarray(pos, pos + vertexCount * 3),
      normals: p.normals.subarray(pos, pos + vertexCount * 3),
      uvs: p.uvs.subarray(uv, uv + vertexCount * 2),
      indices: p.indices.subarray(idx, idx + indexCount),
      exteriorIndexCount: p.ranges[r + 2]!,
      hull: p.hull.subarray(hull, hull + hullCount * 3),
      neighbors: p.neighbors.subarray(nb, nb + neighborCount),
      neighborAreas: p.neighborAreas.subarray(nb, nb + neighborCount),
    });
    pos += vertexCount * 3;
    uv += vertexCount * 2;
    idx += indexCount;
    hull += hullCount * 3;
    nb += neighborCount;
  }
  return frags;
}

export function transferablesOf(p: PackedFragments): ArrayBuffer[] {
  return [
    p.ranges,
    p.centroids,
    p.volumes,
    p.positions,
    p.normals,
    p.uvs,
    p.indices,
    p.hull,
    p.neighbors,
    p.neighborAreas,
  ].map((a) => a.buffer as ArrayBuffer);
}
