// 볼록 부재 모양 도우미 (7-4 입문 건물): 박스 + 반공간 평면 목록을 만든다.
// 맞닿는 두 부재의 접촉면은 같은 평면이어야 이웃으로 이어진다 (contacts.findPlaneContacts):
// 평면 좌표를 같은 식으로 계산해 넘긴다 (예: 성벽 끝 = n각 탑 면의 apothem).
import { clippedBox, polyhedronBounds, type Aabb, type Plane } from '../fracture/polyhedron';
import type { MaterialName } from '../config';
import type { Grain, Member, MemberKind } from './Member';

/** 법선 (정규화 전) + 평면 위 한 점 → 반공간 n·x <= d */
export function plane(
  nx: number,
  ny: number,
  nz: number,
  px: number,
  py: number,
  pz: number,
): Plane {
  const len = Math.hypot(nx, ny, nz);
  const x = nx / len;
  const y = ny / len;
  const z = nz / len;
  return { nx: x, ny: y, nz: z, d: x * px + y * py + z * pz };
}

export interface MemberOptions {
  anchor?: boolean;
  grain?: Grain;
}

/** 박스 부재 */
export function boxMember(
  kind: MemberKind,
  material: MaterialName,
  b: Aabb,
  options: MemberOptions = {},
): Member {
  return { kind, material, box: b, anchor: options.anchor ?? false, grain: options.grain };
}

/** 볼록 부재: box를 planes로 자른 모양. 박스는 모양에 꼭 맞게 줄인다 */
export function convexMember(
  kind: MemberKind,
  material: MaterialName,
  b: Aabb,
  planes: Plane[],
  options: MemberOptions = {},
): Member {
  const tight = polyhedronBounds(clippedBox(b, planes));
  return { ...boxMember(kind, material, tight, options), planes };
}

/**
 * Y축 n각 기둥. 면 하나가 +x를 향한다 (n이 4의 배수면 ±x, ±z 면이 평평: 벽이 붙을 수 있다).
 * apothem = 중심에서 면까지 거리
 */
export function ngonColumn(
  kind: MemberKind,
  material: MaterialName,
  cx: number,
  cz: number,
  apothem: number,
  y0: number,
  y1: number,
  sides: number,
  options: MemberOptions = {},
): Member {
  const r = apothem / Math.cos(Math.PI / sides);
  const planes: Plane[] = [];
  for (let k = 0; k < sides; k++) {
    const a = (2 * Math.PI * k) / sides;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    planes.push(plane(nx, 0, nz, cx + nx * apothem, y0, cz + nz * apothem));
  }
  const b = {
    min: { x: cx - r, y: y0, z: cz - r },
    max: { x: cx + r, y: y1, z: cz + r },
  };
  return convexMember(kind, material, b, planes, options);
}

/**
 * Y축 테이퍼 기둥 (사각뿔대): 아래 반폭 (bx, bz) → 위 반폭 (tx, tz).
 * 위·아래 면은 수평이라 위아래 부재와 그대로 맞닿는다.
 */
export function taperedColumn(
  kind: MemberKind,
  material: MaterialName,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  bottom: readonly [number, number],
  top: readonly [number, number],
  options: MemberOptions = {},
): Member {
  const h = y1 - y0;
  const [bx, bz] = bottom;
  const [tx, tz] = top;
  const planes = [
    plane(h, -(tx - bx), 0, cx + bx, y0, cz),
    plane(-h, -(tx - bx), 0, cx - bx, y0, cz),
    plane(0, -(tz - bz), h, cx, y0, cz + bz),
    plane(0, -(tz - bz), -h, cx, y0, cz - bz),
  ];
  const mx = Math.max(bx, tx);
  const mz = Math.max(bz, tz);
  const b = { min: { x: cx - mx, y: y0, z: cz - mz }, max: { x: cx + mx, y: y1, z: cz + mz } };
  return convexMember(kind, material, b, planes, options);
}

/**
 * 박공(삼각 프리즘): 바닥 [x0, x1] × [z0, z1] 높이 y0, 용마루 높이 y1.
 * ridge 'x' = 용마루가 x축 방향 (경사면이 ±z를 향한다)
 */
export function gable(
  kind: MemberKind,
  material: MaterialName,
  b: Aabb,
  ridge: 'x' | 'z',
  options: MemberOptions = {},
): Member {
  const { min, max } = b;
  const h = max.y - min.y;
  const planes =
    ridge === 'x'
      ? [
          plane(0, (max.z - min.z) / 2, h, 0, min.y, max.z),
          plane(0, (max.z - min.z) / 2, -h, 0, min.y, min.z),
        ]
      : [
          plane(h, (max.x - min.x) / 2, 0, max.x, min.y, 0),
          plane(-h, (max.x - min.x) / 2, 0, min.x, min.y, 0),
        ];
  return convexMember(kind, material, b, planes, options);
}

/**
 * 경사판 (지붕 판자): 바닥 박스를 위아래 두 평행 경사면으로 자른다.
 * ridge 'x'면 z 방향으로 기울어진다: z0에서 높이 y0, z1에서 y1 (두께 t는 수직 방향).
 */
export function slopedSlab(
  kind: MemberKind,
  material: MaterialName,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  t: number,
  options: MemberOptions = {},
): Member {
  const dz = z1 - z0;
  const dy = y1 - y0;
  // 아래 면: (z0, y0)–(z1, y1) 선, 바깥 = 아래쪽. 위 면: t만큼 위, 바깥 = 위쪽
  const sgn = Math.sign(dz);
  const planes = [
    plane(0, -sgn * dz, sgn * dy, 0, y0, z0),
    plane(0, sgn * dz, -sgn * dy, 0, y0 + t, z0),
  ];
  const b = {
    min: { x: x0, y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: x1, y: Math.max(y0, y1) + t, z: Math.max(z0, z1) },
  };
  return convexMember(kind, material, b, planes, options);
}
