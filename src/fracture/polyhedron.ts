// 볼록 다면체: 면(볼록 다각형) 목록 표현 + 평면 반공간 클리핑
// three 의존 없음 (워커/테스트에서 그대로 사용). 좌표는 double(number) 그대로 다룬다.
import { FRACTURE } from '../config';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 원래 외부면 표시. 절단 단면은 대신 이웃 셀 인덱스(>= 0)를 갖는다. */
export const EXTERIOR = -1;

export interface Face {
  /** 볼록 다각형 정점 xyz 평탄화. 바깥(법선 쪽)에서 볼 때 반시계 방향. */
  verts: number[];
  /** 바깥 방향 단위 법선, 평면식 n·x = d */
  nx: number;
  ny: number;
  nz: number;
  d: number;
  /** EXTERIOR 또는 이 면을 공유하는 이웃 셀 인덱스 */
  neighbor: number;
}

export interface Polyhedron {
  faces: Face[];
}

export interface Aabb {
  min: Vec3Like;
  max: Vec3Like;
}

/** 축 정렬 박스 다면체 */
export function boxPolyhedron(min: Vec3Like, max: Vec3Like): Polyhedron {
  const corners: number[][] = [];
  for (let i = 0; i < 8; i++) {
    corners.push([i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z]);
  }
  const faces: Face[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1]) {
      const n = [0, 0, 0];
      n[axis] = side ? 1 : -1;
      const bit = 1 << axis;
      const verts: number[] = [];
      for (let i = 0; i < 8; i++) {
        if (((i & bit) !== 0) === (side === 1)) verts.push(...corners[i]!);
      }
      const plane = side ? [max.x, max.y, max.z][axis]! : -[min.x, min.y, min.z][axis]!;
      orderOnPlane(verts, n[0]!, n[1]!, n[2]!);
      faces.push({ verts, nx: n[0]!, ny: n[1]!, nz: n[2]!, d: plane, neighbor: EXTERIOR });
    }
  }
  return { faces };
}

/**
 * 다면체를 반공간 n·x <= d 로 자른다. 잘린 자리에 neighbor 태그를 단 새 면(cap)을 만든다.
 * - 전혀 잘리지 않으면 입력을 그대로 반환
 * - 전부 잘려 나가면 null
 */
export function clipPolyhedron(
  poly: Polyhedron,
  nx: number,
  ny: number,
  nz: number,
  d: number,
  neighbor: number,
): Polyhedron | null {
  const eps = FRACTURE.planeEpsilon;

  let anyOut = false;
  let anyIn = false;
  for (const face of poly.faces) {
    const v = face.verts;
    for (let i = 0; i < v.length; i += 3) {
      if (nx * v[i]! + ny * v[i + 1]! + nz * v[i + 2]! - d > eps) anyOut = true;
      else anyIn = true;
    }
  }
  if (!anyOut) return poly;
  if (!anyIn) return null;

  const faces: Face[] = [];
  const cap: number[] = [];
  for (const face of poly.faces) {
    const v = face.verts;
    const n = v.length / 3;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      const b = ((i + 1) % n) * 3;
      const da = nx * v[a]! + ny * v[a + 1]! + nz * v[a + 2]! - d;
      const db = nx * v[b]! + ny * v[b + 1]! + nz * v[b + 2]! - d;
      const aIn = da <= eps;
      const bIn = db <= eps;
      if (aIn) {
        out.push(v[a]!, v[a + 1]!, v[a + 2]!);
        if (da >= -eps) cap.push(v[a]!, v[a + 1]!, v[a + 2]!); // 평면 위 정점
      }
      if (aIn !== bIn) {
        // 교점은 항상 '안쪽 정점 → 바깥 정점' 순서로 계산한다.
        // 같은 모서리를 공유하는 두 면이 비트 단위로 같은 교점을 얻어야 틈이 생기지 않는다.
        const p = aIn ? a : b;
        const q = aIn ? b : a;
        const dp = aIn ? da : db;
        const dq = aIn ? db : da;
        if (dp < -eps) {
          const t = dp / (dp - dq);
          const x = v[p]! + (v[q]! - v[p]!) * t;
          const y = v[p + 1]! + (v[q + 1]! - v[p + 1]!) * t;
          const z = v[p + 2]! + (v[q + 2]! - v[p + 2]!) * t;
          out.push(x, y, z);
          cap.push(x, y, z);
        }
        // dp가 평면 위(|dp| <= eps)면 그 정점 자체가 이미 출력/cap에 들어간다
      }
    }
    const cleaned = removeConsecutiveDuplicates(out);
    if (
      cleaned.length >= 9 &&
      polygonArea(cleaned, face.nx, face.ny, face.nz) > FRACTURE.minFaceArea
    ) {
      faces.push({ ...face, verts: cleaned });
    }
  }

  const capVerts = weld(cap);
  if (capVerts.length >= 9) {
    orderOnPlane(capVerts, nx, ny, nz);
    if (polygonArea(capVerts, nx, ny, nz) > FRACTURE.minFaceArea) {
      faces.push({ verts: capVerts, nx, ny, nz, d, neighbor });
    }
  }

  return faces.length >= 4 ? { faces } : null;
}

/** 모든 면 정점의 중복 제거 목록 (xyz 평탄화) */
export function uniqueVertices(poly: Polyhedron): number[] {
  const all: number[] = [];
  for (const face of poly.faces) all.push(...face.verts);
  return weld(all);
}

/** 기준점에서 세운 사면체들로 부피와 질량중심 계산 */
export function volumeAndCentroid(poly: Polyhedron): { volume: number; centroid: Vec3Like } {
  const r = poly.faces[0]!.verts;
  const rx = r[0]!;
  const ry = r[1]!;
  const rz = r[2]!;
  let volume = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const face of poly.faces) {
    const v = face.verts;
    for (let i = 3; i + 5 < v.length; i += 3) {
      const ax = v[0]! - rx,
        ay = v[1]! - ry,
        az = v[2]! - rz;
      const bx = v[i]! - rx,
        by = v[i + 1]! - ry,
        bz = v[i + 2]! - rz;
      const qx = v[i + 3]! - rx,
        qy = v[i + 4]! - ry,
        qz = v[i + 5]! - rz;
      const vol =
        (ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx)) / 6;
      volume += vol;
      // 사면체 질량중심 = (r + a + b + c) / 4, r 기준 상대좌표로 누적
      cx += vol * (ax + bx + qx) * 0.25;
      cy += vol * (ay + by + qy) * 0.25;
      cz += vol * (az + bz + qz) * 0.25;
    }
  }
  const inv = volume !== 0 ? 1 / volume : 0;
  return { volume, centroid: { x: rx + cx * inv, y: ry + cy * inv, z: rz + cz * inv } };
}

/** 볼록 다각형 면적 (법선 방향 기준) */
export function polygonArea(v: readonly number[], nx: number, ny: number, nz: number): number {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const x0 = v[0]!,
    y0 = v[1]!,
    z0 = v[2]!;
  for (let i = 3; i + 5 < v.length; i += 3) {
    const ax = v[i]! - x0,
      ay = v[i + 1]! - y0,
      az = v[i + 2]! - z0;
    const bx = v[i + 3]! - x0,
      by = v[i + 4]! - y0,
      bz = v[i + 5]! - z0;
    sx += ay * bz - az * by;
    sy += az * bx - ax * bz;
    sz += ax * by - ay * bx;
  }
  return Math.abs(sx * nx + sy * ny + sz * nz) / 2;
}

export function polyhedronBounds(poly: Polyhedron): Aabb {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const face of poly.faces) {
    const v = face.verts;
    for (let i = 0; i < v.length; i += 3) {
      min.x = Math.min(min.x, v[i]!);
      min.y = Math.min(min.y, v[i + 1]!);
      min.z = Math.min(min.z, v[i + 2]!);
      max.x = Math.max(max.x, v[i]!);
      max.y = Math.max(max.y, v[i + 1]!);
      max.z = Math.max(max.z, v[i + 2]!);
    }
  }
  return { min, max };
}

/** 점이 다면체 안(경계 포함)에 있는지 */
export function containsPoint(poly: Polyhedron, x: number, y: number, z: number): boolean {
  for (const f of poly.faces) {
    if (f.nx * x + f.ny * y + f.nz * z - f.d > FRACTURE.planeEpsilon) return false;
  }
  return true;
}

/** 평면 위 점들을 법선 기준 반시계 순서로 제자리 정렬 */
function orderOnPlane(v: number[], nx: number, ny: number, nz: number): void {
  const n = v.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < v.length; i += 3) {
    cx += v[i]!;
    cy += v[i + 1]!;
    cz += v[i + 2]!;
  }
  cx /= n;
  cy /= n;
  cz /= n;

  // 평면 기저 u, w = n × u. u→w 방향 각도가 법선 기준 반시계.
  let ux: number, uy: number, uz: number;
  if (Math.abs(nx) < 0.9) [ux, uy, uz] = [0, nz, -ny];
  else [ux, uy, uz] = [-nz, 0, nx];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;

  const items: { a: number; x: number; y: number; z: number }[] = [];
  for (let i = 0; i < v.length; i += 3) {
    const px = v[i]! - cx,
      py = v[i + 1]! - cy,
      pz = v[i + 2]! - cz;
    items.push({
      a: Math.atan2(px * wx + py * wy + pz * wz, px * ux + py * uy + pz * uz),
      x: v[i]!,
      y: v[i + 1]!,
      z: v[i + 2]!,
    });
  }
  items.sort((p, q) => p.a - q.a);
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    v[i * 3] = it.x;
    v[i * 3 + 1] = it.y;
    v[i * 3 + 2] = it.z;
  }
}

/** weldEpsilon 이내의 중복 점 제거 (점 수가 적어 O(n²)로 충분) */
function weld(v: readonly number[]): number[] {
  const eps2 = FRACTURE.weldEpsilon * FRACTURE.weldEpsilon;
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i]!,
      y = v[i + 1]!,
      z = v[i + 2]!;
    let dup = false;
    for (let j = 0; j < out.length; j += 3) {
      const dx = out[j]! - x,
        dy = out[j + 1]! - y,
        dz = out[j + 2]! - z;
      if (dx * dx + dy * dy + dz * dz <= eps2) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(x, y, z);
  }
  return out;
}

/** 다각형에서 연속(마지막→처음 포함)으로 겹친 정점 제거 */
function removeConsecutiveDuplicates(v: number[]): number[] {
  const eps2 = FRACTURE.weldEpsilon * FRACTURE.weldEpsilon;
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 3) {
    const k = out.length;
    if (k >= 3) {
      const dx = out[k - 3]! - v[i]!,
        dy = out[k - 2]! - v[i + 1]!,
        dz = out[k - 1]! - v[i + 2]!;
      if (dx * dx + dy * dy + dz * dz <= eps2) continue;
    }
    out.push(v[i]!, v[i + 1]!, v[i + 2]!);
  }
  while (out.length >= 6) {
    const k = out.length;
    const dx = out[k - 3]! - out[0]!,
      dy = out[k - 2]! - out[1]!,
      dz = out[k - 1]! - out[2]!;
    if (dx * dx + dy * dy + dz * dz > eps2) break;
    out.length = k - 3;
  }
  return out;
}
