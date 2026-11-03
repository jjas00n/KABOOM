// 건물 부재: 박스 하나(또는 박스를 반공간으로 자른 볼록 다면체) = 부재 하나.
// 부재끼리는 겹치지 않고 면으로만 맞닿는다.
import type { FRACTURE, MaterialName } from '../config';
import {
  clippedBox,
  volumeAndCentroid,
  type Aabb,
  type Plane,
  type Polyhedron,
} from '../fracture/polyhedron';

export type MemberKind = keyof typeof FRACTURE.seedDensity;

/** 나뭇결: 이 축 방향으로 시드 칸을 stretch배 길게 (판자가 길이 방향으로 쪼개진다) */
export interface Grain {
  axis: 0 | 1 | 2;
  stretch: number;
}

export interface Member {
  kind: MemberKind;
  /** 재질 (물성·렌더·단가). 생성기가 정한다 (종류로 추론하지 않는다) */
  material: MaterialName;
  /** 부재 박스. 볼록 부재면 바운딩 박스 (UV 원점 = min) */
  box: Aabb;
  /** 볼록 부재: box를 이 반공간들로 자른 모양 (박공·n각 기둥·테이퍼). 없으면 박스 */
  planes?: Plane[];
  grain?: Grain;
  /** 지면에 고정된 부재 (구조 그래프의 앵커, 항상 fixed) */
  anchor: boolean;
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

export function boxVolume(b: Aabb): number {
  return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
}

export function isConvexMember(m: Member): boolean {
  return (m.planes?.length ?? 0) > 0;
}

/** 부재 모양 다면체 (박스면 박스) */
export function memberPolyhedron(m: Member): Polyhedron {
  return clippedBox(m.box, m.planes);
}

/** 부재 부피 (볼록 부재는 잘린 모양 기준) */
export function memberVolume(m: Member): number {
  return isConvexMember(m) ? volumeAndCentroid(memberPolyhedron(m)).volume : boxVolume(m.box);
}
