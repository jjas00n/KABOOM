// 외벽 패널 부재 (창문 구멍 포함)
// 구멍 난 판은 볼록이 아니므로 창대/인방/좌·우 문설주 4개의 볼록 박스로 나눠 만든다.
import { BUILDING } from '../../config';
import type { Aabb } from '../../fracture/polyhedron';
import { box, type Member } from '../Member';

/**
 * 외벽 한 면의 좌표계: u = 벽을 따라가는 축(x 또는 z), y = 높이, t = 벽 두께 축.
 * t0 ~ t1 이 패널 두께 범위.
 */
export interface FacadeFrame {
  t0: number;
  t1: number;
  box(u0: number, u1: number, y0: number, y1: number, t0: number, t1: number): Aabb;
}

export function facadeFrame(alongX: boolean, t0: number, t1: number): FacadeFrame {
  return {
    t0,
    t1,
    box: (u0, u1, y0, y1, a, b) => (alongX ? box(u0, y0, a, u1, y1, b) : box(a, y0, u0, b, y1, u1)),
  };
}

/** 패널 사각형 (u0~u1, y0~y1)의 창 구멍 범위. windowRatio가 0이면 null. */
export function windowOpening(
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  windowRatio: number,
): { u0: number; u1: number; y0: number; y1: number } | null {
  if (windowRatio <= 0) return null;
  const width = (u1 - u0) * windowRatio;
  const height = (y1 - y0) * windowRatio;
  const left = u0 + (u1 - u0 - width) / 2;
  const sill = y0 + (y1 - y0 - height) * BUILDING.sillFraction;
  return { u0: left, u1: left + width, y0: sill, y1: sill + height };
}

/** 창 구멍이 있으면 콘크리트 박스 4개, 없으면 1개 */
export function wallPanel(
  frame: FacadeFrame,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  windowRatio: number,
): Member[] {
  const { t0, t1 } = frame;
  const panel = (a: number, b: number, c: number, d: number): Member => ({
    kind: 'wallPanel',
    box: frame.box(a, b, c, d, t0, t1),
    anchor: false,
  });
  const w = windowOpening(u0, u1, y0, y1, windowRatio);
  if (!w) return [panel(u0, u1, y0, y1)];
  return [
    panel(u0, u1, y0, w.y0), // 창대
    panel(u0, u1, w.y1, y1), // 인방
    panel(u0, w.u0, w.y0, w.y1), // 왼쪽 문설주
    panel(w.u1, u1, w.y0, w.y1), // 오른쪽 문설주
  ];
}
