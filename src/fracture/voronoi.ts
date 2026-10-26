// 3D 보로노이 분할: 볼록 다면체를 이등분 평면 반공간 클리핑
// 셀 i = 원본 ∩ { x : |x - s_i| <= |x - s_j| ∀j }.
// 가까운 시드부터 균일 그리드 링 단위로 검사하고, 셀의 최대 반경 R에 대해
// 2R보다 먼 시드는 셀을 자를 수 없으므로 거기서 멈춘다 (security radius).
import {
  clipPolyhedron,
  containsPoint,
  polyhedronBounds,
  polygonArea,
  volumeAndCentroid,
  type Polyhedron,
  type Vec3Like,
} from './polyhedron';
import { FRACTURE } from '../config';

export interface VoronoiCell {
  /** 입력 seeds 배열에서의 시드 번호 */
  seedIndex: number;
  poly: Polyhedron;
  volume: number;
  centroid: Vec3Like;
  /** 이웃 셀 인덱스(결과 배열 기준) → 공유 면적 m^2 */
  neighbors: Map<number, number>;
}

export type ProgressFn = (done: number, total: number) => void;

/**
 * 다면체 domain을 seeds(xyz 평탄화)로 보로노이 분할한다.
 * 도메인 밖이거나 중복인 시드는 무시한다. 결과 셀의 neighbors는 결과 배열 인덱스를 가리킨다.
 */
export function voronoiCells(
  domain: Polyhedron,
  seeds: ArrayLike<number>,
  onProgress?: ProgressFn,
): VoronoiCell[] {
  const grid = new SeedGrid(domain, seeds);
  const n = grid.count;
  const polys: (Polyhedron | null)[] = [];
  for (let i = 0; i < n; i++) {
    polys.push(computeCell(domain, grid, i));
    if (onProgress && (i + 1) % FRACTURE.progressEvery === 0) onProgress(i + 1, n);
  }
  onProgress?.(n, n);

  // 퇴화로 사라진 셀이 있으면 인덱스를 다시 매긴다
  const remap = new Int32Array(n).fill(-1);
  let next = 0;
  for (let i = 0; i < n; i++) if (polys[i]) remap[i] = next++;

  const cells: VoronoiCell[] = [];
  for (let i = 0; i < n; i++) {
    const poly = polys[i];
    if (!poly) continue;
    const neighbors = new Map<number, number>();
    for (const face of poly.faces) {
      if (face.neighbor < 0) continue;
      const j = remap[face.neighbor]!;
      if (j < 0) continue;
      const area = polygonArea(face.verts, face.nx, face.ny, face.nz);
      neighbors.set(j, (neighbors.get(j) ?? 0) + area);
      face.neighbor = j;
    }
    const { volume, centroid } = volumeAndCentroid(poly);
    cells.push({ seedIndex: grid.seedIndex[i]!, poly, volume, centroid, neighbors });
  }
  return cells;
}

function computeCell(domain: Polyhedron, grid: SeedGrid, i: number): Polyhedron | null {
  const p = grid.points;
  const sx = p[i * 3]!;
  const sy = p[i * 3 + 1]!;
  const sz = p[i * 3 + 2]!;
  let cell: Polyhedron | null = domain;
  let reach = 2 * maxDistance(domain, sx, sy, sz); // 이보다 먼 시드는 셀을 못 자른다

  const home = grid.cellOf(sx, sy, sz);
  const candidates: { j: number; d2: number }[] = [];
  for (let ring = 0; ring <= grid.maxRing; ring++) {
    // ring 칸의 점은 시드에서 최소 (ring-1)·h 떨어져 있다
    if ((ring - 1) * grid.cellSize > reach) break;

    candidates.length = 0;
    grid.forEachInRing(home, ring, (j) => {
      if (j === i) return;
      const dx = p[j * 3]! - sx;
      const dy = p[j * 3 + 1]! - sy;
      const dz = p[j * 3 + 2]! - sz;
      candidates.push({ j, d2: dx * dx + dy * dy + dz * dz });
    });
    candidates.sort((a, b) => a.d2 - b.d2);

    for (const { j, d2 } of candidates) {
      const dist = Math.sqrt(d2);
      if (dist > reach) break;
      const jx = p[j * 3]!;
      const jy = p[j * 3 + 1]!;
      const jz = p[j * 3 + 2]!;
      const nx = (jx - sx) / dist;
      const ny = (jy - sy) / dist;
      const nz = (jz - sz) / dist;
      const d = (nx * (sx + jx) + ny * (sy + jy) + nz * (sz + jz)) / 2;
      const clipped: Polyhedron | null = clipPolyhedron(cell, nx, ny, nz, d, j);
      if (!clipped) return null;
      if (clipped !== cell) {
        cell = clipped;
        reach = 2 * maxDistance(cell, sx, sy, sz);
      }
    }
  }
  return cell;
}

function maxDistance(poly: Polyhedron, x: number, y: number, z: number): number {
  let max2 = 0;
  for (const face of poly.faces) {
    const v = face.verts;
    for (let k = 0; k < v.length; k += 3) {
      const dx = v[k]! - x;
      const dy = v[k + 1]! - y;
      const dz = v[k + 2]! - z;
      max2 = Math.max(max2, dx * dx + dy * dy + dz * dz);
    }
  }
  return Math.sqrt(max2);
}

/** 시드 공간 해시: 균일 그리드 + CSR(칸별 시작 오프셋) */
class SeedGrid {
  readonly points: Float64Array;
  readonly seedIndex: Int32Array;
  readonly count: number;
  readonly cellSize: number;
  readonly maxRing: number;
  private readonly min: Vec3Like;
  private readonly dims: [number, number, number];
  private readonly cellStart: Int32Array;
  private readonly items: Int32Array;

  constructor(domain: Polyhedron, seeds: ArrayLike<number>) {
    const { min, max } = polyhedronBounds(domain);
    const sizeX = max.x - min.x;
    const sizeY = max.y - min.y;
    const sizeZ = max.z - min.z;
    const total = Math.max(Math.floor(seeds.length / 3), 1);
    // 칸 하나에 시드 ~1개
    const h = Math.cbrt((sizeX * sizeY * sizeZ) / total) || Math.max(sizeX, sizeY, sizeZ, 1);
    this.min = min;
    this.cellSize = h;
    this.dims = [
      Math.max(1, Math.ceil(sizeX / h)),
      Math.max(1, Math.ceil(sizeY / h)),
      Math.max(1, Math.ceil(sizeZ / h)),
    ];
    this.maxRing = Math.max(...this.dims);

    // 도메인 안 + 중복 아닌 시드만 남긴다
    const pts: number[] = [];
    const idx: number[] = [];
    const seen = new Map<number, number[]>();
    const weld2 = FRACTURE.weldEpsilon * FRACTURE.weldEpsilon;
    for (let s = 0; s + 2 < seeds.length; s += 3) {
      const x = seeds[s]!;
      const y = seeds[s + 1]!;
      const z = seeds[s + 2]!;
      if (!containsPoint(domain, x, y, z)) continue;
      const c = this.cellOf(x, y, z);
      const bucket = seen.get(c) ?? [];
      let dup = false;
      for (const k of bucket) {
        const dx = pts[k * 3]! - x;
        const dy = pts[k * 3 + 1]! - y;
        const dz = pts[k * 3 + 2]! - z;
        if (dx * dx + dy * dy + dz * dz <= weld2) dup = true;
      }
      if (dup) continue;
      bucket.push(idx.length);
      seen.set(c, bucket);
      pts.push(x, y, z);
      idx.push(s / 3);
    }
    this.points = Float64Array.from(pts);
    this.seedIndex = Int32Array.from(idx);
    this.count = idx.length;

    // 카운팅 정렬로 CSR 구성
    const cellCount = this.dims[0] * this.dims[1] * this.dims[2];
    this.cellStart = new Int32Array(cellCount + 1);
    const cellOfPoint = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const c = this.cellOf(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!);
      cellOfPoint[i] = c;
      this.cellStart[c + 1]!++;
    }
    for (let c = 0; c < cellCount; c++) this.cellStart[c + 1]! += this.cellStart[c]!;
    const fill = this.cellStart.slice(0, cellCount);
    this.items = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) this.items[fill[cellOfPoint[i]!]!++] = i;
  }

  cellOf(x: number, y: number, z: number): number {
    const [nx, ny, nz] = this.dims;
    const ix = clampInt(Math.floor((x - this.min.x) / this.cellSize), nx);
    const iy = clampInt(Math.floor((y - this.min.y) / this.cellSize), ny);
    const iz = clampInt(Math.floor((z - this.min.z) / this.cellSize), nz);
    return ix + nx * (iy + ny * iz);
  }

  /** home 칸에서 체비셰프 거리가 정확히 ring인 칸들의 시드 */
  forEachInRing(home: number, ring: number, fn: (j: number) => void): void {
    const [nx, ny, nz] = this.dims;
    const hx = home % nx;
    const hy = Math.floor(home / nx) % ny;
    const hz = Math.floor(home / (nx * ny));
    for (let z = Math.max(hz - ring, 0); z <= Math.min(hz + ring, nz - 1); z++) {
      for (let y = Math.max(hy - ring, 0); y <= Math.min(hy + ring, ny - 1); y++) {
        const onShellZY = Math.abs(z - hz) === ring || Math.abs(y - hy) === ring;
        // 껍질 위가 아니면 x는 양 끝 두 칸만
        const step = onShellZY || ring === 0 ? 1 : 2 * ring;
        for (let x = hx - ring; x <= hx + ring; x += step) {
          if (x < 0 || x >= nx) continue;
          const c = x + nx * (y + ny * z);
          for (let k = this.cellStart[c]!; k < this.cellStart[c + 1]!; k++) fn(this.items[k]!);
        }
      }
    }
  }
}

function clampInt(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}
