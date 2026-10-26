// 기둥 부재
import { box, type Member } from '../Member';

/** (x, z)를 중심으로 하는 정사각 단면 기둥, y0 ~ y1 */
export function column(x: number, z: number, y0: number, y1: number, size: number): Member {
  const h = size / 2;
  return { kind: 'column', box: box(x - h, y0, z - h, x + h, y1, z + h), anchor: false };
}
