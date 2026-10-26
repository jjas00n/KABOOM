// 건물 부재: 축 정렬 박스 하나 = 부재 하나. 부재끼리는 겹치지 않고 면으로만 맞닿는다.
import type { FRACTURE } from '../config';
import type { Aabb } from '../fracture/polyhedron';

export type MemberKind = keyof typeof FRACTURE.seedDensity;

export interface Member {
  kind: MemberKind;
  box: Aabb;
  /** 지면에 고정된 부재 (구조 그래프의 앵커, 항상 fixed) */
  anchor: boolean;
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

export function boxVolume(b: Aabb): number {
  return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
}
