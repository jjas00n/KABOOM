// 유리창 부재
import { BUILDING } from '../../config';
import type { Member } from '../Member';
import type { FacadeFrame } from './WallPanel';

/** 창 구멍(u0~u1, y0~y1) 안에 패널 두께 가운데로 끼우는 얇은 유리판 */
export function windowGlass(
  frame: FacadeFrame,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
): Member {
  const mid = (frame.t0 + frame.t1) / 2;
  const half = BUILDING.glassThickness / 2;
  return { kind: 'glass', box: frame.box(u0, u1, y0, y1, mid - half, mid + half), anchor: false };
}
