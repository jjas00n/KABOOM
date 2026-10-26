// 층 슬래브 부재
import type { Aabb } from '../../fracture/polyhedron';
import { box, type Member } from '../Member';

/** 평면 범위 footprint(min/max의 x, z만 사용)를 덮는 슬래브, y0 ~ y1 */
export function slab(footprint: Aabb, y0: number, y1: number): Member {
  const { min, max } = footprint;
  return { kind: 'slab', box: box(min.x, y0, min.z, max.x, y1, max.z), anchor: false };
}
