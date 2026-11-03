// 부재 간 연결: 맞닿은 부재 쌍을 찾고, 접촉면 위 양쪽 조각의 외부면이 겹치는 면적만큼 이웃으로 잇는다.
// 같은 부재 안 이웃은 voronoi가 이미 기록하므로, 여기서는 부재 경계를 넘는 엣지만 추가한다.
// 박스끼리는 축 정렬 접촉(findBoxContacts), 볼록 부재가 낀 쌍은 임의 방향 평면 접촉(findPlaneContacts).
import { FRACTURE } from '../config';
import { EXTERIOR, type Aabb, type Face, type Polyhedron } from './polyhedron';
import type { VoronoiCell } from './voronoi';

/** 임의 방향 접촉면: lo의 외부면 (n, d), hi의 외부면 (-n, -d) */
export interface PlaneContact {
  lo: number;
  hi: number;
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface BoxContact {
  /** 접촉면이 lo의 max면, hi의 min면 */
  lo: number;
  hi: number;
  axis: 0 | 1 | 2;
  coord: number;
}

const AXES = [0, 1, 2] as const;

function get(v: { x: number; y: number; z: number }, axis: number): number {
  return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
}

/** 면으로 맞닿은(접촉 면적 > 0) 박스 쌍. 부재 수백 개 규모라 O(n²)로 충분. */
export function findBoxContacts(boxes: readonly Aabb[]): BoxContact[] {
  const eps = FRACTURE.contactEpsilon;
  const out: BoxContact[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      for (const axis of AXES) {
        const [p, q] = [(axis + 1) % 3, (axis + 2) % 3];
        const overlapP =
          Math.min(get(a.max, p), get(b.max, p)) - Math.max(get(a.min, p), get(b.min, p));
        const overlapQ =
          Math.min(get(a.max, q), get(b.max, q)) - Math.max(get(a.min, q), get(b.min, q));
        if (overlapP <= eps || overlapQ <= eps) continue;
        if (Math.abs(get(a.max, axis) - get(b.min, axis)) <= eps) {
          out.push({ lo: i, hi: j, axis, coord: get(a.max, axis) });
        } else if (Math.abs(get(b.max, axis) - get(a.min, axis)) <= eps) {
          out.push({ lo: j, hi: i, axis, coord: get(b.max, axis) });
        }
      }
    }
  }
  return out;
}

/**
 * 볼록 부재가 하나라도 낀 쌍(convex[i] || convex[j])의 접촉면: 바운딩 박스가 닿는 쌍에서
 * 법선이 반대이고 같은 평면에 놓인 외부면 쌍. 박스끼리 쌍은 findBoxContacts가 맡는다.
 */
export function findPlaneContacts(
  polys: readonly Polyhedron[],
  boxes: readonly Aabb[],
  convex: readonly boolean[],
): PlaneContact[] {
  const eps = FRACTURE.contactEpsilon;
  const out: PlaneContact[] = [];
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (!convex[i] && !convex[j]) continue;
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (
        a.max.x < b.min.x - eps ||
        b.max.x < a.min.x - eps ||
        a.max.y < b.min.y - eps ||
        b.max.y < a.min.y - eps ||
        a.max.z < b.min.z - eps ||
        b.max.z < a.min.z - eps
      ) {
        continue;
      }
      for (const fa of polys[i]!.faces) {
        if (fa.neighbor !== EXTERIOR) continue;
        for (const fb of polys[j]!.faces) {
          if (fb.neighbor !== EXTERIOR) continue;
          const dot = fa.nx * fb.nx + fa.ny * fb.ny + fa.nz * fb.nz;
          if (dot > -1 + eps || Math.abs(fa.d + fb.d) > eps) continue;
          out.push({ lo: i, hi: j, nx: fa.nx, ny: fa.ny, nz: fa.nz, d: fa.d });
        }
      }
    }
  }
  return out;
}

interface PlanarFace {
  cell: number;
  /** 접촉면에 투영한 2D 볼록 다각형 (반시계) */
  poly: number[];
  minP: number;
  maxP: number;
  minQ: number;
  maxQ: number;
}

/**
 * contacts의 각 접촉면에서 lo 쪽 조각과 hi 쪽 조각의 외부면 다각형 겹침 면적을 구해
 * 양쪽 cell.neighbors에 대칭으로 더한다. memberCells[m] = 부재 m 셀들의 [start, end).
 */
export function addContactNeighbors(
  cells: readonly VoronoiCell[],
  memberCells: readonly (readonly [number, number])[],
  contacts: readonly BoxContact[],
  planeContacts: readonly PlaneContact[] = [],
): void {
  for (const { lo, hi, axis, coord } of contacts) {
    const below = facesOnPlane(cells, memberCells[lo]!, axis, 1, coord);
    const above = facesOnPlane(cells, memberCells[hi]!, axis, -1, coord);
    connectFaces(cells, below, above);
  }
  for (const c of planeContacts) {
    const basis = planeBasis(c.nx, c.ny, c.nz);
    const below = facesOnGeneralPlane(cells, memberCells[c.lo]!, c, 1, basis);
    const above = facesOnGeneralPlane(cells, memberCells[c.hi]!, c, -1, basis);
    connectFaces(cells, below, above);
  }
}

/** 접촉면 양쪽 외부면 다각형의 겹침 면적을 양쪽 셀 이웃에 대칭으로 더한다 */
function connectFaces(
  cells: readonly VoronoiCell[],
  below: readonly PlanarFace[],
  above: readonly PlanarFace[],
): void {
  for (const a of below) {
    for (const b of above) {
      if (a.maxP <= b.minP || b.maxP <= a.minP || a.maxQ <= b.minQ || b.maxQ <= a.minQ) continue;
      const area = convexIntersectionArea(a.poly, b.poly);
      if (area <= FRACTURE.minFaceArea) continue;
      const ca = cells[a.cell]!;
      const cb = cells[b.cell]!;
      ca.neighbors.set(b.cell, (ca.neighbors.get(b.cell) ?? 0) + area);
      cb.neighbors.set(a.cell, (cb.neighbors.get(a.cell) ?? 0) + area);
    }
  }
}

type Basis = [number, number, number, number, number, number];

/** 법선 n에 수직인 직교 기저 (u, v) */
function planeBasis(nx: number, ny: number, nz: number): Basis {
  // n과 가장 덜 평행한 축과 외적
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const [tx, ty, tz] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  let ux = ny * tz - nz * ty;
  let uy = nz * tx - nx * tz;
  let uz = nx * ty - ny * tx;
  const len = Math.hypot(ux, uy, uz);
  ux /= len;
  uy /= len;
  uz /= len;
  return [ux, uy, uz, ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux];
}

/** [start, end) 셀들 중 법선이 sign·n이고 평면 n·x = d 위에 놓인 외부면 (기저 (u, v)로 2D 투영) */
function facesOnGeneralPlane(
  cells: readonly VoronoiCell[],
  [start, end]: readonly [number, number],
  plane: PlaneContact,
  sign: 1 | -1,
  [ux, uy, uz, vx, vy, vz]: Basis,
): PlanarFace[] {
  const eps = FRACTURE.contactEpsilon;
  const out: PlanarFace[] = [];
  for (let c = start; c < end; c++) {
    for (const face of cells[c]!.poly.faces) {
      if (face.neighbor !== EXTERIOR) continue;
      const dot = face.nx * plane.nx + face.ny * plane.ny + face.nz * plane.nz;
      if (dot * sign < 1 - eps) continue;
      if (Math.abs(face.d - sign * plane.d) > eps) continue;
      const v = face.verts;
      const poly: number[] = [];
      let minP = Infinity;
      let maxP = -Infinity;
      let minQ = Infinity;
      let maxQ = -Infinity;
      for (let k = 0; k < v.length; k += 3) {
        const pp = v[k]! * ux + v[k + 1]! * uy + v[k + 2]! * uz;
        const qq = v[k]! * vx + v[k + 1]! * vy + v[k + 2]! * vz;
        poly.push(pp, qq);
        minP = Math.min(minP, pp);
        maxP = Math.max(maxP, pp);
        minQ = Math.min(minQ, qq);
        maxQ = Math.max(maxQ, qq);
      }
      if (signedArea2(poly) < 0) reverse2(poly);
      out.push({ cell: c, poly, minP, maxP, minQ, maxQ });
    }
  }
  return out;
}

/** [start, end) 셀들 중 법선이 sign·axis이고 좌표 coord 평면에 놓인 외부면 */
function facesOnPlane(
  cells: readonly VoronoiCell[],
  [start, end]: readonly [number, number],
  axis: number,
  sign: 1 | -1,
  coord: number,
): PlanarFace[] {
  const eps = FRACTURE.contactEpsilon;
  const p = (axis + 1) % 3;
  const q = (axis + 2) % 3;
  const out: PlanarFace[] = [];
  for (let c = start; c < end; c++) {
    for (const face of cells[c]!.poly.faces) {
      if (face.neighbor !== EXTERIOR) continue;
      if (normalComponent(face, axis) * sign < 1 - eps) continue;
      if (Math.abs(face.d - sign * coord) > eps) continue;
      const v = face.verts;
      const poly: number[] = [];
      let minP = Infinity;
      let maxP = -Infinity;
      let minQ = Infinity;
      let maxQ = -Infinity;
      for (let k = 0; k < v.length; k += 3) {
        const pp = v[k + p]!;
        const qq = v[k + q]!;
        poly.push(pp, qq);
        minP = Math.min(minP, pp);
        maxP = Math.max(maxP, pp);
        minQ = Math.min(minQ, qq);
        maxQ = Math.max(maxQ, qq);
      }
      // (p, q) 평면에서 법선 +axis 면은 반시계, -axis 면은 시계 → 반시계로 통일
      if (signedArea2(poly) < 0) reverse2(poly);
      out.push({ cell: c, poly, minP, maxP, minQ, maxQ });
    }
  }
  return out;
}

function normalComponent(f: Face, axis: number): number {
  return axis === 0 ? f.nx : axis === 1 ? f.ny : f.nz;
}

/** 두 볼록 다각형(2D, 반시계, xy 평탄화) 교집합 면적. Sutherland–Hodgman. */
export function convexIntersectionArea(
  subject: readonly number[],
  clip: readonly number[],
): number {
  let out: number[] = subject.slice();
  const n = clip.length / 2;
  for (let e = 0; e < n && out.length >= 6; e++) {
    const ax = clip[e * 2]!;
    const ay = clip[e * 2 + 1]!;
    const bx = clip[((e + 1) % n) * 2]!;
    const by = clip[((e + 1) % n) * 2 + 1]!;
    // 반시계 다각형의 안쪽 = 모서리 왼쪽 (cross >= 0)
    const side = (x: number, y: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const input = out;
    out = [];
    const m = input.length / 2;
    for (let i = 0; i < m; i++) {
      const px = input[i * 2]!;
      const py = input[i * 2 + 1]!;
      const qx = input[((i + 1) % m) * 2]!;
      const qy = input[((i + 1) % m) * 2 + 1]!;
      const sp = side(px, py);
      const sq = side(qx, qy);
      if (sp >= 0) out.push(px, py);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push(px + (qx - px) * t, py + (qy - py) * t);
      }
    }
  }
  return out.length >= 6 ? Math.abs(signedArea2(out)) / 2 : 0;
}

/** 2 × 부호 있는 면적 */
function signedArea2(v: readonly number[]): number {
  let s = 0;
  const n = v.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += v[i * 2]! * v[j * 2 + 1]! - v[j * 2]! * v[i * 2 + 1]!;
  }
  return s;
}

function reverse2(v: number[]): void {
  const n = v.length / 2;
  for (let i = 0; i < n / 2; i++) {
    const j = n - 1 - i;
    [v[i * 2], v[j * 2]] = [v[j * 2]!, v[i * 2]!];
    [v[i * 2 + 1], v[j * 2 + 1]] = [v[j * 2 + 1]!, v[i * 2 + 1]!];
  }
}
